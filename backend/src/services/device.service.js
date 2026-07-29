'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const DeviceRepository = require('../repositories/device.repository');
const RegisterProfileRepository = require('../repositories/register-profile.repository');
const AppError = require('../utils/app-error');
const { modbusConnectionManager } = require('../modbus/connection-manager');
const { buildPaginationMeta } = require('../utils/pagination');

function notFound(message) {
  return new AppError(message, {
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.NOT_FOUND,
  });
}

function validationError(message, details) {
  return new AppError(message, {
    statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
    code: ERROR_CODES.VALIDATION_ERROR,
    details,
  });
}

function mapDevicePayload(input) {
  const { registerProfileId, ...payload } = input;

  if (registerProfileId !== undefined) {
    payload.registerProfile = registerProfileId;
  }

  return payload;
}

class DeviceService {
  constructor({ deviceRepository, registerProfileRepository, connectionManager } = {}) {
    this.deviceRepository = deviceRepository || new DeviceRepository();
    this.registerProfileRepository = registerProfileRepository || new RegisterProfileRepository();
    this.connectionManager = connectionManager || modbusConnectionManager;
  }

  async list(query) {
    const { items, total } = await this.deviceRepository.list(query);

    return {
      items,
      pagination: buildPaginationMeta({
        page: query.page,
        limit: query.limit,
        total,
      }),
    };
  }

  async getById(deviceId) {
    const device = await this.deviceRepository.findByIdWithProfile(deviceId);
    if (!device) {
      throw notFound('Device was not found.');
    }

    return device;
  }

  async create(input) {
    await this.assertProfileCanBeAssigned(input.registerProfileId);
    const payload = mapDevicePayload(input);
    const pollingEnabled = input.polling?.enabled ?? true;
    const deviceEnabled = input.isEnabled ?? true;
    if (deviceEnabled && pollingEnabled && input.registerProfileId) {
      payload.nextPollAt = new Date();
    }
    return this.deviceRepository.createWithProfile(payload);
  }

  async update(deviceId, input) {
    const existingDevice = await this.deviceRepository.findById(deviceId);
    if (!existingDevice) {
      throw notFound('Device was not found.');
    }

    await this.assertProfileCanBeAssigned(input.registerProfileId);

    const payload = mapDevicePayload(input);
    if (input.polling) {
      payload.polling = { ...existingDevice.polling, ...input.polling };
      this.assertPollingSettings(payload.polling);
    }
    if (input.reconnect) {
      payload.reconnect = { ...existingDevice.reconnect, ...input.reconnect };
    }

    const pollingConfigurationChanged =
      input.polling !== undefined ||
      input.isEnabled !== undefined ||
      input.registerProfileId !== undefined ||
      input.connection !== undefined ||
      input.unitId !== undefined;
    if (pollingConfigurationChanged) {
      const effectivePolling = payload.polling || existingDevice.polling;
      const effectiveEnabled = input.isEnabled ?? existingDevice.isEnabled;
      const effectiveProfile =
        input.registerProfileId !== undefined
          ? input.registerProfileId
          : existingDevice.registerProfile;
      payload.nextPollAt =
        effectiveEnabled && effectivePolling?.enabled && effectiveProfile
          ? new Date()
          : null;
    }

    const updatedDevice = await this.deviceRepository.updateByIdWithProfile(deviceId, payload);
    if (!updatedDevice) {
      throw notFound('Device was not found.');
    }

    if (input.connection || input.unitId !== undefined || input.reconnect || input.isEnabled === false) {
      await this.connectionManager.invalidateDevice(deviceId);
    }

    return updatedDevice;
  }

  async delete(deviceId) {
    await this.connectionManager.disconnectDevice(deviceId);
    const deletedDevice = await this.deviceRepository.deleteById(deviceId);
    if (!deletedDevice) {
      throw notFound('Device was not found.');
    }

    return deletedDevice;
  }

  async assertProfileCanBeAssigned(registerProfileId) {
    if (registerProfileId === undefined || registerProfileId === null) {
      return;
    }

    const profile = await this.registerProfileRepository.findById(registerProfileId);
    if (!profile) {
      throw notFound('The specified register profile was not found.');
    }

    if (!profile.isActive) {
      throw validationError('An inactive register profile cannot be assigned to a device.', [
        {
          field: 'registerProfileId',
          message: 'Select an active register profile or activate the profile first.',
          code: 'custom',
        },
      ]);
    }
  }

  assertPollingSettings(polling) {
    if (polling.jitterMs > polling.intervalMs) {
      throw validationError('Request validation failed.', [
        {
          field: 'polling.jitterMs',
          message: 'jitterMs cannot exceed intervalMs.',
          code: 'custom',
        },
      ]);
    }
  }
}

module.exports = DeviceService;
