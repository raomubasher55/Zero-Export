'use strict';

const logger = require('../config/logger');
const ERROR_CODES = require('../constants/error-codes');
const HTTP_STATUS = require('../constants/http-status');
const { REGISTER_DATA_TYPES, REGISTER_TYPES } = require('../constants/modbus');
const { modbusGatewayRuntime } = require('../gateway/modbus-gateway-runtime');
const DeviceRepository = require('../repositories/device.repository');
const {
  GatewayConfigurationRepository,
} = require('../repositories/gateway-configuration.repository');
const LatestValueRepository = require('../repositories/latest-value.repository');
const AppError = require('../utils/app-error');

const READ_FUNCTION_CODES = Object.freeze({
  [REGISTER_TYPES.COIL]: 1,
  [REGISTER_TYPES.DISCRETE_INPUT]: 2,
  [REGISTER_TYPES.HOLDING]: 3,
  [REGISTER_TYPES.INPUT]: 4,
});

const WRITE_FUNCTION_CODES = Object.freeze({
  [REGISTER_TYPES.COIL]: [5, 15],
  [REGISTER_TYPES.HOLDING]: [6, 16],
});

function validationError(message, details = []) {
  return new AppError(message, {
    statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
    code: ERROR_CODES.VALIDATION_ERROR,
    details,
  });
}

function runtimeError(error) {
  return new AppError(`Unable to start the Modbus forwarding gateway: ${error.message}`, {
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: ERROR_CODES.MODBUS_GATEWAY_ERROR,
  });
}

class GatewayService {
  constructor(options = {}) {
    this.configurationRepository =
      options.configurationRepository || new GatewayConfigurationRepository();
    this.deviceRepository = options.deviceRepository || new DeviceRepository();
    this.latestValueRepository = options.latestValueRepository || new LatestValueRepository();
    this.runtime = options.runtime || modbusGatewayRuntime;
    this.logger = options.logger || logger;
    this.initializationError = null;
  }

  async initialize() {
    const configuration = await this.configurationRepository.getOrDefault();

    try {
      const hydrated = await this.hydrate(configuration);
      const initialValues = await this.getInitialValues(hydrated);
      this.runtime.configure(hydrated, initialValues);

      if (configuration.enabled) {
        try {
          await this.runtime.start();
        } catch (error) {
          this.logger.error('Configured Modbus gateway could not be started', {
            error: error.stack || error.message,
          });
        }
      }

      this.initializationError = null;
      return this.present(configuration);
    } catch (error) {
      // The persisted configuration can be stale (mappings pointing at
      // deleted devices/profiles). Never block boot on it: start with a
      // safe disabled configuration and surface the reason in the API.
      this.logger.warn(
        'Persisted gateway configuration is invalid; starting with a safe disabled configuration',
        { error: error.message || String(error) },
      );
      const safe = { ...configuration, enabled: false, mappings: [] };
      this.runtime.configure(safe, []);
      this.initializationError = {
        message: String(error.message || 'Gateway configuration is invalid.').slice(0, 500),
        occurredAt: new Date(),
      };
      return {
        configuration: safe,
        status: this.runtime.getStatus(),
        initializationError: this.initializationError,
      };
    }
  }

  async get() {
    const configuration = await this.configurationRepository.getOrDefault();
    return {
      ...this.present(configuration),
      initializationError: this.initializationError,
    };
  }

  async update(input) {
    const hydrated = await this.hydrate(input);
    const initialValues = await this.getInitialValues(hydrated);
    await this.runtime.stop();
    const saved = await this.configurationRepository.save(input);
    this.runtime.configure(hydrated, initialValues);

    if (saved.enabled) {
      try {
        await this.runtime.start();
      } catch (error) {
        await this.configurationRepository.setEnabled(false);
        throw runtimeError(error);
      }
    }

    return this.present({ ...saved, enabled: saved.enabled && this.runtime.getStatus().running });
  }

  async start() {
    const configuration = await this.configurationRepository.getOrDefault();
    const candidate = { ...configuration, enabled: true };
    const hydrated = await this.hydrate(candidate);
    const initialValues = await this.getInitialValues(hydrated);
    await this.runtime.stop();
    this.runtime.configure(hydrated, initialValues);

    try {
      await this.runtime.start();
      const saved = await this.configurationRepository.save({ ...configuration, enabled: true });
      return this.present(saved);
    } catch (error) {
      await this.configurationRepository.save({ ...configuration, enabled: false });
      throw runtimeError(error);
    }
  }

  async stop() {
    await this.runtime.stop();
    const configuration = await this.configurationRepository.getOrDefault();
    const saved = await this.configurationRepository.save({ ...configuration, enabled: false });
    return this.present(saved);
  }

  /**
   * Build a forwarding mapping for every enabled register of a device's
   * assigned profile. Addresses and data layout mirror the source profile so
   * a downstream controller can read the gateway exactly like the physical
   * meter ("same addresses" forwarding). Nothing is persisted here; the
   * operator reviews the generated mappings and saves them with PUT /gateway.
   */
  async generateMappings({ sourceDeviceId, registerType, addressOffset = 0 }) {
    const [device] = await this.deviceRepository.findManyByIdsWithProfiles([sourceDeviceId]);
    if (!device) {
      throw new AppError('Source device was not found.', {
        statusCode: HTTP_STATUS.NOT_FOUND,
        code: ERROR_CODES.NOT_FOUND,
      });
    }

    const profile = device.registerProfile;
    if (!profile || !Array.isArray(profile.registers) || profile.registers.length === 0) {
      throw validationError('The selected device has no register profile with registers to forward.');
    }

    const targetBitArea = [REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(registerType);
    const issues = [];
    const mappings = [];

    for (const register of profile.registers) {
      if (register.enabled === false) {
        continue;
      }

      const area = registerType || register.registerType;
      const address = register.address + addressOffset;

      if (address + register.length > 65536) {
        issues.push({
          field: `registers.${register.key}`,
          message: `Address ${address} (0x${address.toString(16).toUpperCase()}) exceeds the 65535 address limit with an offset of ${addressOffset}.`,
          code: 'address_range',
        });
        continue;
      }

      if (targetBitArea && register.dataType !== REGISTER_DATA_TYPES.BIT) {
        issues.push({
          field: `registers.${register.key}`,
          message: `Only BIT registers can be forwarded to a coil/discrete-input area (${register.key} is ${register.dataType}).`,
          code: 'incompatible_area',
        });
        continue;
      }

      mappings.push({
        key: register.key,
        name: register.name,
        sourceDeviceId,
        sourceRegisterKey: register.key,
        registerType: area,
        address,
        dataType: register.dataType,
        length: targetBitArea ? 1 : register.length,
        byteOrder: register.byteOrder,
        wordOrder: register.wordOrder,
        bitIndex: targetBitArea ? 0 : (register.bitIndex ?? 0),
        scaleFactor: register.scaleFactor ?? 1,
        offset: register.offset ?? 0,
        unit: register.unit ?? null,
        writable: Boolean(
          register.writable &&
            [REGISTER_TYPES.COIL, REGISTER_TYPES.HOLDING].includes(area),
        ),
        enabled: true,
      });
    }

    if (issues.length > 0) {
      throw validationError('Unable to mirror the source profile as forwarding mappings.', issues);
    }

    if (mappings.length === 0) {
      throw validationError('The selected profile has no enabled registers to forward.');
    }

    return {
      sourceDevice: {
        _id: String(device._id),
        identifier: device.identifier,
        name: device.name,
      },
      sourceProfile: {
        _id: String(profile._id),
        identifier: profile.identifier,
        name: profile.name,
        model: profile.model ?? null,
      },
      registerType: registerType || null,
      addressOffset,
      mappings,
      count: mappings.length,
    };
  }

  async hydrate(configuration) {
    const deviceIds = [...new Set(configuration.mappings.map((mapping) => String(mapping.sourceDeviceId)))];
    const devices = await this.deviceRepository.findManyByIdsWithProfiles(deviceIds);
    const devicesById = new Map(devices.map((device) => [String(device._id), device]));
    const issues = [];

    const mappings = configuration.mappings.map((mapping, index) => {
      const sourceDevice = devicesById.get(String(mapping.sourceDeviceId));
      if (!sourceDevice) {
        issues.push({
          field: `mappings.${index}.sourceDeviceId`,
          message: 'The selected source device no longer exists.',
          code: 'not_found',
        });
        return mapping;
      }

      const sourceDefinition = sourceDevice.registerProfile?.registers?.find(
        (register) => register.key === mapping.sourceRegisterKey,
      );
      if (!sourceDefinition) {
        issues.push({
          field: `mappings.${index}.sourceRegisterKey`,
          message: 'The selected source register is not in the device’s assigned profile.',
          code: 'not_found',
        });
        return mapping;
      }
      if (!sourceDevice.registerProfile?.isActive || sourceDefinition.enabled === false) {
        issues.push({
          field: `mappings.${index}.sourceRegisterKey`,
          message: 'The source profile and register must both be enabled for forwarding.',
          code: 'disabled',
        });
      }
      if (mapping.writable) {
        if (!sourceDefinition.writable) {
          issues.push({
            field: `mappings.${index}.writable`,
            message: 'Write-through requires the source profile register to be marked writable.',
            code: 'read_only',
          });
        }
        if (![REGISTER_TYPES.COIL, REGISTER_TYPES.HOLDING].includes(sourceDefinition.registerType)) {
          issues.push({
            field: `mappings.${index}.writable`,
            message: 'Write-through sources must be a coil or holding register.',
            code: 'read_only',
          });
        }
      }

      return {
        ...mapping,
        sourceDevice,
        sourceDefinition,
      };
    });

    if (issues.length > 0) {
      throw validationError('Gateway source mappings are invalid.', issues);
    }

    return { ...configuration, mappings };
  }

  async getInitialValues(configuration) {
    const sources = configuration.mappings
      .filter((mapping) => mapping.enabled)
      .map((mapping) => ({
        deviceId: mapping.sourceDeviceId,
        registerKey: mapping.sourceRegisterKey,
      }));
    return this.latestValueRepository.findForSources(sources);
  }

  present(configuration) {
    return {
      configuration: {
        ...configuration,
        mappings: configuration.mappings.map((mapping) => ({
          ...mapping,
          readFunctionCode: READ_FUNCTION_CODES[mapping.registerType],
          writeFunctionCodes: mapping.writable
            ? WRITE_FUNCTION_CODES[mapping.registerType] || []
            : [],
        })),
      },
      status: this.runtime.getStatus(),
    };
  }
}

const gatewayService = new GatewayService();

module.exports = {
  GatewayService,
  READ_FUNCTION_CODES,
  WRITE_FUNCTION_CODES,
  gatewayService,
};
