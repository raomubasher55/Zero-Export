'use strict';

const ModbusRTU = require('modbus-serial');
const logger = require('../config/logger');
const { encodeRegister } = require('../modbus/register-encoder');
const { EM500_PROFILE } = require('../seed/em500.profile');

const SIMULATOR_STATES = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
});

const DEFAULT_CONFIGURATION = Object.freeze({
  deviceType: 'EM500',
  host: '0.0.0.0',
  port: 15020,
  unitId: 1,
  updateIntervalMs: 1000,
});

function modbusError(message, modbusErrorCode = 0x04) {
  const error = new Error(message);
  error.modbusErrorCode = modbusErrorCode;
  return error;
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function waitForServer(server, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error('Timed out while starting the meter simulator.')),
      timeoutMs,
    );
    timeout.unref?.();

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.removeListener('initialized', onInitialized);
      server.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onInitialized = () => finish();
    const onError = (error) => finish(error);

    server.once('initialized', onInitialized);
    server.once('error', onError);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drift(value, range, min, max) {
  return clamp(value + (Math.random() - 0.5) * range, min, max);
}

/**
 * Process-local Modbus TCP meter simulator.
 *
 * Serves the built-in Eastron EM500 register map (input registers, FC04) with
 * live, realistic values in exactly the raw format the EM500 profile decodes:
 * every register is encoded through the same encoder the gateway uses, so
 * byte/word order, scaling, and 64-bit energy counters match the profile.
 *
 * Intended for testing polls, the forwarding gateway, and the analyzer without
 * a physical meter. State is process-local and disappears on restart.
 */
class MeterSimulator {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.profile = options.profile || EM500_PROFILE;
    this.serverFactory =
      options.serverFactory ||
      ((vector, configuration) =>
        new ModbusRTU.ServerTCP(vector, {
          host: configuration.host,
          port: configuration.port,
          unitID: configuration.unitId,
        }));

    this.configuration = { ...DEFAULT_CONFIGURATION };
    this.server = null;
    this.memory = new Map(); // address -> raw 16-bit word
    this.values = new Map(); // registerKey -> latest decoded snapshot
    this.tickTimer = null;
    this.tickCount = 0;
    this.lastTickAt = null;
    this.lastRequestAt = null;
    this.lastError = null;
    this.state = SIMULATOR_STATES.STOPPED;
    this.startedAt = null;

    this.phase = {
      voltage: [232.4, 231.1, 230.2],
      current: [45.3, 48.7, 42.9],
      powerFactor: [0.932, 0.941, 0.925],
      frequency: 50.02,
    };

    // Accumulating energy counters (engineering units: kWh/kvarh/kVAh).
    this.energy = {
      totalImportActive: 12345.67,
      totalExportActive: 321.45,
      totalImportReactive: 5678.9,
      totalExportReactive: 98.7,
      totalApparent: 18888.88,
      partialImportActive: 0,
      partialExportActive: 0,
      partialImportReactive: 0,
      partialExportReactive: 0,
      partialApparent: 0,
      l1ImportActive: 4123.4,
      l2ImportActive: 4078.1,
      l3ImportActive: 4144.2,
      l1PartialApparent: 0,
      l2PartialApparent: 0,
      l3PartialApparent: 0,
    };
  }

  assertUnitId(unitId) {
    if (
      unitId !== undefined &&
      this.configuration.unitId !== undefined &&
      unitId !== 0 &&
      unitId !== this.configuration.unitId
    ) {
      throw modbusError(`Unexpected unit id ${unitId}.`, 0x02);
    }
  }

  configure(patch) {
    if (this.state === SIMULATOR_STATES.RUNNING || this.state === SIMULATOR_STATES.STARTING) {
      throw new Error('Stop the simulator before changing its configuration.');
    }
    this.configuration = { ...this.configuration, ...patch };
    return this.getStatus();
  }

  async start() {
    if (this.state === SIMULATOR_STATES.RUNNING || this.state === SIMULATOR_STATES.STARTING) {
      return this.getStatus();
    }

    this.state = SIMULATOR_STATES.STARTING;
    try {
      this.server = this.serverFactory(this.createVector(), this.configuration);
      await waitForServer(this.server);
      this.state = SIMULATOR_STATES.RUNNING;
      this.startedAt = new Date();
      this.lastError = null;

      this.tick();
      this.tickTimer = setInterval(() => {
        try {
          this.tick();
        } catch (error) {
          this.logger.error('Meter simulator tick failed', {
            error: error.stack || error.message,
          });
        }
      }, this.configuration.updateIntervalMs);
      this.tickTimer.unref?.();

      this.logger.info('Meter simulator started', {
        deviceType: this.configuration.deviceType,
        host: this.configuration.host,
        port: this.configuration.port,
        unitId: this.configuration.unitId,
        registerCount: this.profile.registers.length,
      });
      return this.getStatus();
    } catch (error) {
      await this.stop();
      this.state = SIMULATOR_STATES.ERROR;
      this.lastError = { message: error.message, occurredAt: new Date() };
      throw error;
    }
  }

  async stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    const server = this.server;
    this.server = null;
    await closeServer(server);
    this.state = SIMULATOR_STATES.STOPPED;
    this.startedAt = null;
    return this.getStatus();
  }

  createVector() {
    return {
      getCoil: (address, unitId) => this.unavailable('COIL', address, unitId),
      getDiscreteInput: (address, unitId) => this.unavailable('DISCRETE_INPUT', address, unitId),
      getHoldingRegister: (address, unitId) => this.unavailable('HOLDING_REGISTER', address, unitId),
      getInputRegister: (address, unitId) => this.getInputRegister(address, unitId),
      getMultipleInputRegisters: (address, length, unitId) =>
        Array.from({ length }, (_, offset) => this.getInputRegister(address + offset, unitId)),
      setCoil: (address, _value, unitId) => this.unavailable('COIL', address, unitId),
      setRegister: (address, _value, unitId) => this.unavailable('HOLDING_REGISTER', address, unitId),
      setRegisterArray: (address, _values, unitId) =>
        this.unavailable('HOLDING_REGISTER', address, unitId),
      readDeviceIdentification: () => ({
        0x00: 'Eastron',
        0x01: 'EM500',
        0x02: '1.0.0',
        0x03: 'Zero Export meter simulator',
      }),
    };
  }

  unavailable(registerType, address, unitId) {
    this.assertUnitId(unitId);
    throw modbusError(`The simulator only serves EM500 input registers; ${registerType} address ${address} is not available.`, 0x02);
  }

  getInputRegister(address, unitId) {
    this.assertUnitId(unitId);
    this.lastRequestAt = new Date();
    const word = this.memory.get(address);
    if (word === undefined) {
      throw modbusError(`Address ${address} is not simulated.`, 0x02);
    }
    return word;
  }

  /** Recompute simulated values and refresh the raw register memory. */
  tick() {
    const now = new Date();
    const measurements = this.computeMeasurements();
    const dtHours = this.configuration.updateIntervalMs / 3600000;
    const energy = this.computeEnergy(measurements, dtHours);

    for (const register of this.profile.registers) {
      let engineeringValue =
        register.group === 'Energy'
          ? energy[register.key]
          : measurements[register.key];

      if (engineeringValue === undefined) {
        this.logger.warn('Simulator has no value generator for register', {
          registerKey: register.key,
        });
        continue;
      }

      // A real meter quantizes to its raw integer resolution; do the same so
      // the encoder accepts the value and the wire format matches the meter.
      const isIntegerType = [
        'INT16',
        'UINT16',
        'INT32',
        'UINT32',
        'INT64',
        'UINT64',
      ].includes(register.dataType);
      if (isIntegerType) {
        engineeringValue =
          Math.round(engineeringValue / register.scaleFactor) * register.scaleFactor;
      }

      const encoded = encodeRegister(register, engineeringValue);
      encoded.rawValues.forEach((rawValue, offset) => {
        this.memory.set(register.address + offset, rawValue);
      });

      this.values.set(register.key, {
        registerKey: register.key,
        registerName: register.name,
        address: register.address,
        dataType: register.dataType,
        group: register.group,
        unit: register.unit || null,
        value: engineeringValue,
        rawValues: [...encoded.rawValues],
        sampledAt: now,
      });
    }

    this.tickCount += 1;
    this.lastTickAt = now;
    return this.getStatus();
  }

  computeMeasurements() {
    const p = this.phase;
    p.voltage = p.voltage.map((v) => drift(v, 0.6, 225, 245));
    p.current = p.current.map((i) => drift(i, 1.6, 25, 75));
    p.powerFactor = p.powerFactor.map((pf) => drift(pf, 0.006, 0.85, 0.99));
    p.frequency = drift(p.frequency, 0.02, 49.9, 50.1);

    const [v1, v2, v3] = p.voltage;
    const [i1, i2, i3] = p.current;
    const [pf1, pf2, pf3] = p.powerFactor;

    const active = [v1 * i1 * pf1, v2 * i2 * pf2, v3 * i3 * pf3];
    const apparent = [v1 * i1, v2 * i2, v3 * i3];
    const reactive = [
      apparent[0] * Math.sqrt(Math.max(0, 1 - pf1 * pf1)),
      apparent[1] * Math.sqrt(Math.max(0, 1 - pf2 * pf2)),
      apparent[2] * Math.sqrt(Math.max(0, 1 - pf3 * pf3)),
    ];

    const avgVoltage = (v1 + v2 + v3) / 3;
    const avgCurrent = (i1 + i2 + i3) / 3;
    const sumActive = active[0] + active[1] + active[2];
    const sumReactive = reactive[0] + reactive[1] + reactive[2];
    const sumApparent = apparent[0] + apparent[1] + apparent[2];

    return {
      l1_phase_voltage: v1,
      l2_phase_voltage: v2,
      l3_phase_voltage: v3,
      l1_current: i1,
      l2_current: i2,
      l3_current: i3,
      neutral_current: Math.abs(drift(0.18, 0.2, 0, 1.5)),
      l1_l2_voltage: (v1 + v2) / 2 * Math.sqrt(3),
      l2_l3_voltage: (v2 + v3) / 2 * Math.sqrt(3),
      l3_l1_voltage: (v3 + v1) / 2 * Math.sqrt(3),
      l1_active_power: active[0],
      l2_active_power: active[1],
      l3_active_power: active[2],
      l1_reactive_power: reactive[0],
      l2_reactive_power: reactive[1],
      l3_reactive_power: reactive[2],
      l1_apparent_power: apparent[0],
      l2_apparent_power: apparent[1],
      l3_apparent_power: apparent[2],
      l1_power_factor: pf1,
      l2_power_factor: pf2,
      l3_power_factor: pf3,
      frequency: p.frequency,
      eqv_phase_voltage: avgVoltage,
      eqv_phase_to_phase_voltage: avgVoltage * Math.sqrt(3),
      eqv_current: avgCurrent,
      eqv_active_power: sumActive,
      eqv_reactive_power: sumReactive,
      eqv_apparent_power: sumApparent,
      eqv_power_factor: sumActive / sumApparent,
      phase_phase_voltage_asymmetry: 1.5,
      phase_neutral_voltage_asymmetry: 1.1,
      current_asymmetry: 2.2,
    };
  }

  computeEnergy(measurements, dtHours) {
    const e = this.energy;
    const activeImportRate = measurements.eqv_active_power / 1000; // kW
    const activeExportRate = Math.max(0, -measurements.eqv_active_power) / 1000 + 0.02;
    const reactiveImportRate = measurements.eqv_reactive_power / 1000;
    const apparentRate = measurements.eqv_apparent_power / 1000;

    const dImport = activeImportRate * dtHours;
    const dExport = activeExportRate * dtHours;
    const dReactive = reactiveImportRate * dtHours;
    const dApparent = apparentRate * dtHours;

    e.totalImportActive += dImport;
    e.totalExportActive += dExport;
    e.totalImportReactive += dReactive;
    e.totalExportReactive += dReactive * 0.15;
    e.totalApparent += dApparent;
    e.partialImportActive += dImport;
    e.partialExportActive += dExport;
    e.partialImportReactive += dReactive;
    e.partialExportReactive += dReactive * 0.15;
    e.partialApparent += dApparent;

    const [p1, p2, p3] = [measurements.l1_active_power, measurements.l2_active_power, measurements.l3_active_power];
    const total = p1 + p2 + p3 || 1;
    e.l1ImportActive += dImport * (p1 / total);
    e.l2ImportActive += dImport * (p2 / total);
    e.l3ImportActive += dImport * (p3 / total);
    e.l1PartialApparent += dApparent * (p1 / total);
    e.l2PartialApparent += dApparent * (p2 / total);
    e.l3PartialApparent += dApparent * (p3 / total);

    return {
      total_import_active_energy: e.totalImportActive,
      total_export_active_energy: e.totalExportActive,
      total_import_reactive_energy: e.totalImportReactive,
      total_export_reactive_energy: e.totalExportReactive,
      total_apparent_energy: e.totalApparent,
      partial_import_active_energy: e.partialImportActive,
      partial_export_active_energy: e.partialExportActive,
      partial_import_reactive_energy: e.partialImportReactive,
      partial_export_reactive_energy: e.partialExportReactive,
      partial_apparent_energy: e.partialApparent,
      import_active_energy_tariff_1: e.totalImportActive * 0.6,
      export_active_energy_tariff_1: e.totalExportActive * 0.6,
      import_reactive_energy_tariff_1: e.totalImportReactive * 0.6,
      export_reactive_energy_tariff_1: e.totalExportReactive * 0.6,
      apparent_energy_tariff_1: e.totalApparent * 0.6,
      import_active_energy_tariff_2: e.totalImportActive * 0.4,
      apparent_energy_tariff_2: e.totalApparent * 0.4,
      l1_import_active_energy_tariff_1: e.l1ImportActive * 0.6,
      l1_apparent_energy_tariff_1: e.l1PartialApparent * 0.6,
      l1_import_active_energy_tariff_2: e.l1ImportActive * 0.4,
      l1_apparent_energy_tariff_2: e.l1PartialApparent * 0.4,
      l2_import_active_energy_tariff_1: e.l2ImportActive * 0.6,
      l2_apparent_energy_tariff_1: e.l2PartialApparent * 0.6,
      l2_import_active_energy_tariff_2: e.l2ImportActive * 0.4,
      l2_apparent_energy_tariff_2: e.l2PartialApparent * 0.4,
      l3_import_active_energy_tariff_1: e.l3ImportActive * 0.6,
      l3_apparent_energy_tariff_1: e.l3PartialApparent * 0.6,
      l3_import_active_energy_tariff_2: e.l3ImportActive * 0.4,
      l3_apparent_energy_tariff_2: e.l3PartialApparent * 0.4,
      l1_import_active_energy: e.l1ImportActive,
      l1_partial_apparent_energy: e.l1PartialApparent,
      l2_import_active_energy: e.l2ImportActive,
      l2_partial_apparent_energy: e.l2PartialApparent,
      l3_import_active_energy: e.l3ImportActive,
      l3_partial_apparent_energy: e.l3PartialApparent,
    };
  }

  getStatus() {
    return {
      state: this.state,
      deviceType: this.configuration.deviceType,
      host: this.configuration.host,
      port: this.configuration.port,
      unitId: this.configuration.unitId,
      updateIntervalMs: this.configuration.updateIntervalMs,
      startedAt: this.startedAt,
      lastRequestAt: this.lastRequestAt,
      lastTickAt: this.lastTickAt,
      tickCount: this.tickCount,
      lastError: this.lastError,
      registerCount: this.profile.registers.length,
      servedRegisterCount: this.values.size,
    };
  }

  getValues() {
    return [...this.values.values()].sort(
      (left, right) =>
        String(left.group).localeCompare(String(right.group)) ||
        left.address - right.address,
    );
  }
}

const meterSimulator = new MeterSimulator();

module.exports = {
  DEFAULT_CONFIGURATION,
  MeterSimulator,
  SIMULATOR_STATES,
  meterSimulator,
};
