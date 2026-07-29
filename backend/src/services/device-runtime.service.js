'use strict';

const { DEVICE_STATUSES } = require('../constants/modbus');
const DeviceRepository = require('../repositories/device.repository');
const { isTimeoutError } = require('../modbus/modbus-error');

function toPersistedError(error) {
  return {
    code: error?.code || error?.errno || 'MODBUS_OPERATION_ERROR',
    message: String(error?.message || 'Modbus communication failed.').slice(0, 2000),
  };
}

class DeviceRuntimeService {
  constructor(deviceRepository = new DeviceRepository()) {
    this.deviceRepository = deviceRepository;
  }

  async markOnline(deviceId) {
    return this.deviceRepository.updateRuntimeState(deviceId, {
      status: DEVICE_STATUSES.ONLINE,
      touchCommunication: true,
      clearError: true,
    });
  }

  async markOnlineMany(deviceIds) {
    return this.deviceRepository.updateRuntimeStateForMany(deviceIds, {
      status: DEVICE_STATUSES.ONLINE,
      touchCommunication: true,
      clearError: true,
    });
  }

  async markFailure(deviceId, error) {
    return this.deviceRepository.updateRuntimeState(deviceId, {
      status: isTimeoutError(error) || error?.code === 'MODBUS_TIMEOUT'
        ? DEVICE_STATUSES.TIMEOUT
        : DEVICE_STATUSES.ERROR,
      touchCommunication: false,
      error: toPersistedError(error),
    });
  }

  async markFailureMany(deviceIds, error) {
    return this.deviceRepository.updateRuntimeStateForMany(deviceIds, {
      status: isTimeoutError(error) || error?.code === 'MODBUS_TIMEOUT'
        ? DEVICE_STATUSES.TIMEOUT
        : DEVICE_STATUSES.ERROR,
      touchCommunication: false,
      error: toPersistedError(error),
    });
  }

  async markOfflineMany(deviceIds, error) {
    return this.deviceRepository.updateRuntimeStateForMany(deviceIds, {
      status: DEVICE_STATUSES.OFFLINE,
      touchCommunication: false,
      error: toPersistedError(error),
    });
  }
}

module.exports = DeviceRuntimeService;
