'use strict';

const { gatewayService } = require('../services/gateway.service');
const { sendSuccess } = require('../utils/api-response');

class GatewayController {
  constructor(service = gatewayService) {
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
    return sendSuccess(res, { data: await this.service.start() });
  }

  async stop(_req, res) {
    return sendSuccess(res, { data: await this.service.stop() });
  }
}

module.exports = GatewayController;
