'use strict';

const {
  getDevice,
  getStatus,
  getValues,
} = require('../simulator');
const SimulatorSettingsRepository = require('../repositories/simulator-settings.repository');
const { sendSuccess } = require('../utils/api-response');

class SimulatorController {
  constructor(runtime = { getStatus, getValues, getDevice }, settingsRepository = new SimulatorSettingsRepository()) {
    this.runtime = runtime;
    this.settingsRepository = settingsRepository;
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

    // Persist the settings so they survive a backend restart.
    try {
      await this.settingsRepository.save(req.validated.params.deviceKey, req.validated.body);
    } catch (error) {
      // Persistence failure should not break the live configuration.
      this.runtime.logger?.warn?.(`Unable to persist simulator settings for ${req.validated.params.deviceKey}`, error?.message);
    }

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
