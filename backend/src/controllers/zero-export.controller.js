'use strict';

const { zeroExportService } = require('../services/zero-export.service');
const { sendSuccess } = require('../utils/api-response');

class ZeroExportController {
  constructor(service = zeroExportService) {
    this.service = service;
    this.get = this.get.bind(this);
    this.update = this.update.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
  }

  async get(_req, res) {
    return sendSuccess(res, { data: await this.service.get() });
  }

  async update(req, res) {
    return sendSuccess(res, { data: await this.service.update(req.validated.body) });
  }

  async start(_req, res) {
    return sendSuccess(res, { data: await this.service.startControl() });
  }

  async stop(_req, res) {
    return sendSuccess(res, { data: await this.service.stopControl() });
  }
}

module.exports = ZeroExportController;
