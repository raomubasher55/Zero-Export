'use strict';

const { systemMonitoringService } = require('../services/system-monitoring.service');
const { sendSuccess } = require('../utils/api-response');

class SystemController {
  constructor(service = systemMonitoringService) {
    this.service = service;
    this.getSnapshot = this.getSnapshot.bind(this);
  }

  async getSnapshot(_req, res) {
    return sendSuccess(res, { data: await this.service.getSnapshot() });
  }
}

module.exports = SystemController;
