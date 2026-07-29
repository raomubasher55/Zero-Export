'use strict';

const { pollingScheduler } = require('../jobs/polling-scheduler');
const { DevicePollingService } = require('../services/device-polling.service');
const { sendSuccess } = require('../utils/api-response');

class PollingController {
  constructor(options = {}) {
    this.pollingService = options.pollingService || new DevicePollingService();
    this.pollingScheduler = options.pollingScheduler || pollingScheduler;

    this.pollNow = this.pollNow.bind(this);
    this.getSchedulerStatus = this.getSchedulerStatus.bind(this);
  }

  async pollNow(req, res) {
    const result = await this.pollingService.pollNow(req.validated.params.deviceId);
    return sendSuccess(res, { data: result });
  }

  async getSchedulerStatus(_req, res) {
    return sendSuccess(res, { data: this.pollingScheduler.getStatus() });
  }
}

module.exports = PollingController;
