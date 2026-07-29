'use strict';

const HTTP_STATUS = require('../constants/http-status');
const DeviceService = require('../services/device.service');
const { sendNoContent, sendSuccess } = require('../utils/api-response');

class DeviceController {
  constructor(deviceService = new DeviceService()) {
    this.deviceService = deviceService;

    this.list = this.list.bind(this);
    this.getById = this.getById.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.delete = this.delete.bind(this);
  }

  async list(req, res) {
    const result = await this.deviceService.list(req.validated.query);
    return sendSuccess(res, {
      data: result.items,
      meta: { pagination: result.pagination },
    });
  }

  async getById(req, res) {
    const device = await this.deviceService.getById(req.validated.params.deviceId);
    return sendSuccess(res, { data: device });
  }

  async create(req, res) {
    const device = await this.deviceService.create(req.validated.body);
    return sendSuccess(res, {
      statusCode: HTTP_STATUS.CREATED,
      data: device,
    });
  }

  async update(req, res) {
    const device = await this.deviceService.update(req.validated.params.deviceId, req.validated.body);
    return sendSuccess(res, { data: device });
  }

  async delete(req, res) {
    await this.deviceService.delete(req.validated.params.deviceId);
    return sendNoContent(res);
  }
}

module.exports = DeviceController;
