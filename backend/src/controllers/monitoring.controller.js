'use strict';

const MonitoringService = require('../services/monitoring.service');
const { sendSuccess } = require('../utils/api-response');

class MonitoringController {
  constructor(monitoringService = new MonitoringService()) {
    this.monitoringService = monitoringService;

    this.listLatestValues = this.listLatestValues.bind(this);
    this.getLatestValue = this.getLatestValue.bind(this);
    this.listCommunicationLogs = this.listCommunicationLogs.bind(this);
  }

  async listLatestValues(req, res) {
    const result = await this.monitoringService.listLatestValues(req.validated.params.deviceId, req.validated.query);
    return sendSuccess(res, {
      data: result.items,
      meta: { pagination: result.pagination },
    });
  }

  async getLatestValue(req, res) {
    const result = await this.monitoringService.getLatestValue(
      req.validated.params.deviceId,
      req.validated.params.registerKey,
    );
    return sendSuccess(res, { data: result });
  }

  async listCommunicationLogs(req, res) {
    const result = await this.monitoringService.listCommunicationLogs(
      req.validated.params.deviceId,
      req.validated.query,
    );
    return sendSuccess(res, {
      data: result.items,
      meta: { pagination: result.pagination },
    });
  }
}

module.exports = MonitoringController;
