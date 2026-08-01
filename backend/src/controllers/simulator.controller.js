'use strict';

const {
  getDevice,
  getStatus,
  getValues,
} = require('../simulator');
const { sendSuccess } = require('../utils/api-response');

class SimulatorController {
  constructor(runtime = { getStatus, getValues, getDevice }) {
    this.runtime = runtime;
    this.get = this.get.bind(this);
    this.getValues = this.getValues.bind(this);
    this.updateDevice = this.updateDevice.bind(this);
    this.startDevice = this.startDevice.bind(this);
    this.stopDevice = this.stopDevice.bind(this);
  }

  async get(_req, res) {
    return sendSuccess(res, { data: this.runtime.getStatus() });
  }

  async getValues(req, res) {
    const deviceKey = req.validated.query.device;
    return sendSuccess(res, {
      data: this.runtime.getValues(deviceKey),
      meta: { device: deviceKey },
    });
  }

  async updateDevice(req, res) {
    const device = this.runtime.getDevice(req.validated.params.deviceKey);
    const wasRunning = device.getStatus().state === 'RUNNING';
    await device.stop();
    device.configure(req.validated.body);
    if (wasRunning) {
      await device.start();
    }
    return sendSuccess(res, { data: device.getStatus() });
  }

  async startDevice(req, res) {
    const device = this.runtime.getDevice(req.validated.params.deviceKey);
    return sendSuccess(res, { data: await device.start() });
  }

  async stopDevice(req, res) {
    const device = this.runtime.getDevice(req.validated.params.deviceKey);
    return sendSuccess(res, { data: await device.stop() });
  }
}

module.exports = SimulatorController;
