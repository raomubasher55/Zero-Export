'use strict';

const ModbusOperationService = require('../services/modbus-operation.service');
const { sendSuccess } = require('../utils/api-response');

class ModbusController {
  constructor(modbusOperationService = new ModbusOperationService()) {
    this.modbusOperationService = modbusOperationService;

    this.getConnectionStatus = this.getConnectionStatus.bind(this);
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.read = this.read.bind(this);
    this.write = this.write.bind(this);
  }

  async getConnectionStatus(req, res) {
    const connection = await this.modbusOperationService.getConnectionStatus(req.validated.params.deviceId);
    return sendSuccess(res, { data: connection });
  }

  async connect(req, res) {
    const connection = await this.modbusOperationService.connect(req.validated.params.deviceId);
    return sendSuccess(res, { data: connection });
  }

  async disconnect(req, res) {
    const connection = await this.modbusOperationService.disconnect(req.validated.params.deviceId);
    return sendSuccess(res, { data: connection });
  }

  async read(req, res) {
    const data = await this.modbusOperationService.read(req.validated.params.deviceId, req.validated.body);
    return sendSuccess(res, { data });
  }

  async write(req, res) {
    const data = await this.modbusOperationService.write(req.validated.params.deviceId, req.validated.body);
    return sendSuccess(res, { data });
  }
}

module.exports = ModbusController;
