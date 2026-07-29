'use strict';

const logger = require('../config/logger');
const ERROR_CODES = require('../constants/error-codes');
const HTTP_STATUS = require('../constants/http-status');
const { REGISTER_TYPES } = require('../constants/modbus');
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
  }

  async initialize() {
    const configuration = await this.configurationRepository.getOrDefault();
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

    return this.present(configuration);
  }

  async get() {
    const configuration = await this.configurationRepository.getOrDefault();
    return this.present(configuration);
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
