'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const CommunicationLogRepository = require('../repositories/communication-log.repository');
const DeviceRepository = require('../repositories/device.repository');
const LatestValueRepository = require('../repositories/latest-value.repository');
const AppError = require('../utils/app-error');
const { buildPaginationMeta } = require('../utils/pagination');

class MonitoringService {
  constructor(options = {}) {
    this.deviceRepository = options.deviceRepository || new DeviceRepository();
    this.latestValueRepository = options.latestValueRepository || new LatestValueRepository();
    this.communicationLogRepository = options.communicationLogRepository || new CommunicationLogRepository();
  }

  async listLatestValues(deviceId, query) {
    await this.assertDeviceExists(deviceId);
    const { items, total } = await this.latestValueRepository.listByDevice(deviceId, query);

    return {
      items,
      pagination: buildPaginationMeta({ page: query.page, limit: query.limit, total }),
    };
  }

  async getLatestValue(deviceId, registerKey) {
    await this.assertDeviceExists(deviceId);
    const value = await this.latestValueRepository.findByDeviceAndKey(deviceId, registerKey);
    if (!value) {
      throw new AppError('Latest value was not found for this device register.', {
        statusCode: HTTP_STATUS.NOT_FOUND,
        code: ERROR_CODES.NOT_FOUND,
      });
    }

    return value;
  }

  async listCommunicationLogs(deviceId, query) {
    await this.assertDeviceExists(deviceId);
    const { items, total } = await this.communicationLogRepository.listByDevice(deviceId, query);

    return {
      items,
      pagination: buildPaginationMeta({ page: query.page, limit: query.limit, total }),
    };
  }

  async assertDeviceExists(deviceId) {
    const device = await this.deviceRepository.findById(deviceId);
    if (!device) {
      throw new AppError('Device was not found.', {
        statusCode: HTTP_STATUS.NOT_FOUND,
        code: ERROR_CODES.NOT_FOUND,
      });
    }

    return device;
  }
}

module.exports = MonitoringService;
