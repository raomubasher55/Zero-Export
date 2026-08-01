'use strict';

const logger = require('../config/logger');
const ERROR_CODES = require('../constants/error-codes');
const HTTP_STATUS = require('../constants/http-status');
const { REGISTER_TYPES } = require('../constants/modbus');
const DeviceRepository = require('../repositories/device.repository');
const LatestValueRepository = require('../repositories/latest-value.repository');
const {
  ZeroExportConfigurationRepository,
} = require('../repositories/zero-export-configuration.repository');
const { modbusConnectionManager } = require('../modbus/connection-manager');
const AppError = require('../utils/app-error');

const MAX_ACTIONS = 100;

function validationError(message, details = []) {
  return new AppError(message, {
    statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
    code: ERROR_CODES.VALIDATION_ERROR,
    details,
  });
}

/**
 * Zero-export / load-following controller.
 *
 * Every cycle it reads the grid power seen by the meter (positive = import,
 * negative = export) from the latest polled value, compares it against the
 * target grid power, and adjusts the inverter's active-power derating
 * register by one step. Import above target -> more solar; export -> less.
 *
 * Simulation mode replaces the meter reading with
 *   gridPower = loadKw - inverterActivePowerKw
 * so the whole loop can be exercised against the device simulators.
 *
 * Control state (derating, action log) is process-local; the configuration
 * is persisted in MongoDB.
 */
class ZeroExportService {
  constructor(options = {}) {
    this.configurationRepository =
      options.configurationRepository || new ZeroExportConfigurationRepository();
    this.deviceRepository = options.deviceRepository || new DeviceRepository();
    this.latestValueRepository = options.latestValueRepository || new LatestValueRepository();
    this.connectionManager = options.connectionManager || modbusConnectionManager;
    this.logger = options.logger || logger;

    this.timer = null;
    this.running = false;
    this.configuration = null;
    this.deratingRaw = null;
    this.lastGridKw = null;
    this.lastRunAt = null;
    this.lastError = null;
    this.consecutiveMisses = 0;
    this.failsafeWritten = false;
    this.actions = [];
    this.tickInProgress = false;
  }

  async initialize() {
    const configuration = await this.configurationRepository.getOrDefault();
    this.configuration = configuration;
    if (configuration.enabled) {
      this.start();
    }
    return this.getStatus();
  }

  start() {
    if (this.timer) {
      return this.getStatus();
    }
    this.running = true;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.error('Zero-export control cycle failed', {
          error: error.stack || error.message,
        });
      });
    }, this.configuration?.intervalMs || 5000);
    this.timer.unref?.();
    return this.getStatus();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    return this.getStatus();
  }

  async get() {
    const configuration = await this.configurationRepository.getOrDefault();
    return {
      configuration,
      status: this.getStatus(),
      actions: [...this.actions],
    };
  }

  async update(input) {
    const hydrated = await this.hydrate(input);
    const saved = await this.configurationRepository.save(hydrated);
    this.configuration = saved;
    if (saved.enabled) {
      this.start();
    } else {
      this.stop();
    }
    return {
      configuration: saved,
      status: this.getStatus(),
      actions: [...this.actions],
    };
  }

  async startControl() {
    const configuration = await this.configurationRepository.getOrDefault();
    if (!configuration.meterDeviceId || !configuration.inverterDeviceId) {
      throw validationError(
        'Select the grid meter and inverter devices and save before starting.',
        [
          {
            field: 'meterDeviceId',
            message: 'Grid meter device is not configured.',
            code: 'not_configured',
          },
          {
            field: 'inverterDeviceId',
            message: 'Inverter device is not configured.',
            code: 'not_configured',
          },
        ],
      );
    }
    const saved = await this.configurationRepository.save({ ...configuration, enabled: true });
    this.configuration = saved;
    this.start();
    return {
      configuration: saved,
      status: this.getStatus(),
      actions: [...this.actions],
    };
  }

  async stopControl() {
    await this.configurationRepository.setEnabled(false);
    this.stop();
    const configuration = await this.configurationRepository.getOrDefault();
    return {
      configuration,
      status: this.getStatus(),
      actions: [...this.actions],
    };
  }

  getStatus() {
    return {
      running: this.running,
      enabled: this.configuration?.enabled ?? false,
      lastRunAt: this.lastRunAt,
      lastGridKw: this.lastGridKw,
      lastDerating: this.deratingRaw,
      lastDeratingPercent:
        this.deratingRaw === null ? null : Math.round((this.deratingRaw / 10) * 10) / 10,
      consecutiveMisses: this.consecutiveMisses,
      lastError: this.lastError,
      actionCount: this.actions.length,
      simulation: this.configuration?.simulation?.enabled ?? false,
    };
  }

  /** Validate devices and register keys, derive the write address. */
  async hydrate(input) {
    const [meterDevice, inverterDevice] = await Promise.all([
      this.deviceRepository.findByIdForPolling(input.meterDeviceId),
      this.deviceRepository.findByIdForPolling(input.inverterDeviceId),
    ]);

    if (!meterDevice) {
      throw validationError('The selected grid meter device does not exist.', [
        { field: 'meterDeviceId', message: 'Meter device not found.', code: 'not_found' },
      ]);
    }
    if (!inverterDevice) {
      throw validationError('The selected inverter device does not exist.', [
        { field: 'inverterDeviceId', message: 'Inverter device not found.', code: 'not_found' },
      ]);
    }

    const meterRegister = meterDevice.registerProfile?.registers?.find(
      (register) => register.key === input.meterRegisterKey,
    );
    if (!meterRegister) {
      throw validationError('The meter register key is not in the meter device’s profile.', [
        { field: 'meterRegisterKey', message: 'Register not found in the meter profile.', code: 'not_found' },
      ]);
    }

    const inverterRegister = inverterDevice.registerProfile?.registers?.find(
      (register) => register.key === input.inverterRegisterKey,
    );
    if (!inverterRegister) {
      throw validationError('The inverter register key is not in the inverter device’s profile.', [
        { field: 'inverterRegisterKey', message: 'Register not found in the inverter profile.', code: 'not_found' },
      ]);
    }
    if (!inverterRegister.writable || inverterRegister.registerType !== REGISTER_TYPES.HOLDING) {
      throw validationError('The inverter control register must be a writable holding register.', [
        { field: 'inverterRegisterKey', message: 'Select a writable holding register.', code: 'read_only' },
      ]);
    }

    return {
      ...input,
      inverterRegisterAddress: inverterRegister.address,
      meterDeviceId: meterDevice._id,
      inverterDeviceId: inverterDevice._id,
      simulation: input.simulation ?? { enabled: false, loadKw: 100 },
    };
  }

  async tick() {
    if (this.tickInProgress) {
      return;
    }
    this.tickInProgress = true;
    try {
      const configuration = await this.configurationRepository.getOrDefault();
      this.configuration = configuration;
      if (!configuration.enabled) {
        return;
      }

      const now = new Date();
      this.lastRunAt = now;

      const reading = await this.readGridPower(configuration, now);
      if (!reading.ok) {
        await this.recordMiss(configuration, reading.reason);
        return;
      }

      const { gridKw, source } = reading;
      this.lastGridKw = gridKw;
      this.consecutiveMisses = 0;
      this.failsafeWritten = false;

      const targetKw = configuration.targetGridKw;
      const errorKw = gridKw - targetKw;

      if (Math.abs(errorKw) <= configuration.deadbandKw) {
        this.recordAction({
          at: now,
          source,
          gridKw,
          targetGridKw: targetKw,
          derating: this.deratingRaw,
          delta: 0,
          outcome: 'IN_BAND',
        });
        return;
      }

      const current = this.deratingRaw ?? 1000;
      const step = errorKw > 0 ? configuration.stepPerCycle : -configuration.stepPerCycle;
      const next = Math.min(
        configuration.maxDerating,
        Math.max(configuration.minDerating, current + step),
      );

      if (next === current) {
        this.recordAction({
          at: now,
          source,
          gridKw,
          targetGridKw: targetKw,
          derating: current,
          delta: 0,
          outcome: 'CLAMPED',
        });
        return;
      }

      const inverterDevice = await this.deviceRepository.findById(configuration.inverterDeviceId);
      if (!inverterDevice) {
        await this.recordMiss(configuration, 'Inverter device no longer exists.');
        return;
      }

      await this.connectionManager.execute(inverterDevice, 'zero-export', async (client) => {
        await client.writeRegister(configuration.inverterRegisterAddress, next);
      });

      this.deratingRaw = next;
      this.lastError = null;
      this.recordAction({
        at: now,
        source,
        gridKw,
        targetGridKw: targetKw,
        derating: next,
        delta: step,
        outcome: 'WRITTEN',
      });
      this.logger.info('Zero-export derating written', {
        gridKw,
        targetGridKw: targetKw,
        derating: next,
        source,
      });
    } catch (error) {
      this.lastError = {
        message: String(error.message || 'Zero-export cycle failed.').slice(0, 500),
        occurredAt: new Date(),
      };
      this.logger.error('Zero-export control cycle failed', {
        error: error.stack || error.message,
      });
    } finally {
      this.tickInProgress = false;
    }
  }

  async readGridPower(configuration, now) {
    const maxAgeMs = Math.max(configuration.intervalMs * 3, 15000);

    if (configuration.simulation?.enabled) {
      const inverterPower = await this.latestValueRepository.findByDeviceAndKey(
        configuration.inverterDeviceId,
        'active_power',
      );
      if (!inverterPower || new Date(inverterPower.sampledAt).getTime() < now.getTime() - maxAgeMs) {
        return { ok: false, reason: 'Simulated inverter output is stale or missing.' };
      }
      const loadKw = configuration.simulation.loadKw ?? 0;
      return {
        ok: true,
        gridKw: loadKw - Number(inverterPower.value),
        source: 'SIMULATION',
      };
    }

    const meterValue = await this.latestValueRepository.findByDeviceAndKey(
      configuration.meterDeviceId,
      configuration.meterRegisterKey,
    );
    if (!meterValue || new Date(meterValue.sampledAt).getTime() < now.getTime() - maxAgeMs) {
      return { ok: false, reason: 'Meter reading is stale or missing.' };
    }

    const unit = String(meterValue.unit || '').toLowerCase();
    const gridKw = unit === 'w' ? Number(meterValue.value) / 1000 : Number(meterValue.value);
    return { ok: true, gridKw, source: 'METER' };
  }

  async recordMiss(configuration, reason) {
    this.consecutiveMisses += 1;
    this.lastError = { message: reason, occurredAt: new Date() };

    if (
      this.consecutiveMisses >= configuration.failsafeAfterMisses &&
      !this.failsafeWritten &&
      configuration.failsafeDerating !== this.deratingRaw
    ) {
      try {
        await this.writeFailsafe(configuration);
      } catch (error) {
        this.logger.error('Zero-export failsafe write failed', {
          error: error.stack || error.message,
        });
      }
      this.failsafeWritten = true;
    }
  }

  async writeFailsafe(configuration) {
    const inverterDevice = await this.deviceRepository.findById(configuration.inverterDeviceId);
    if (!inverterDevice) {
      return;
    }
    await this.connectionManager.execute(inverterDevice, 'zero-export', async (client) => {
      await client.writeRegister(configuration.inverterRegisterAddress, configuration.failsafeDerating);
    });
    this.deratingRaw = configuration.failsafeDerating;
    this.recordAction({
      at: new Date(),
      source: 'FAILSAFE',
      gridKw: this.lastGridKw,
      targetGridKw: configuration.targetGridKw,
      derating: configuration.failsafeDerating,
      delta: 0,
      outcome: 'FAILSAFE',
    });
    this.logger.warn('Zero-export failsafe derating written', {
      derating: configuration.failsafeDerating,
    });
  }

  recordAction(action) {
    this.actions.unshift(action);
    if (this.actions.length > MAX_ACTIONS) {
      this.actions.length = MAX_ACTIONS;
    }
  }
}

const zeroExportService = new ZeroExportService();

module.exports = {
  MAX_ACTIONS,
  ZeroExportService,
  zeroExportService,
};
