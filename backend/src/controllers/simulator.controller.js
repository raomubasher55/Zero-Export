'use strict';

const {
  getDevice,
  getStatus,
  getValues,
  startDevice,
  stopDevice,
} = require('../simulator');
const SimulatorSettingsRepository = require('../repositories/simulator-settings.repository');
const DeviceRepository = require('../repositories/device.repository');
const { sendSuccess } = require('../utils/api-response');

class SimulatorController {
  constructor(
    runtime = { getStatus, getValues, getDevice },
    settingsRepository = new SimulatorSettingsRepository(),
    deviceRepository = new DeviceRepository(),
  ) {
    this.runtime = runtime;
    this.settingsRepository = settingsRepository;
    this.deviceRepository = deviceRepository;
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
    const deviceKey = req.validated.params.deviceKey;
    const body = req.validated.body;
    const device = this.runtime.getDevice(deviceKey);
    const wasRunning = device.getStatus().state === 'RUNNING';
    await stopDevice(deviceKey);
    device.configure(body);

    // Persist the settings so they survive a backend restart.
    try {
      await this.settingsRepository.save(deviceKey, body);
    } catch (error) {
      // Persistence failure should not break the live configuration.
      this.runtime.logger?.warn?.(`Unable to persist simulator settings for ${deviceKey}`, error?.message);
    }

    // Keep the linked EMS device in sync so polling keeps working with the
    // new unit ID / port. The linked device is named <key>-simulator.
    let syncedDevice = null;
    try {
      const linked = await this.deviceRepository.findOne({
        identifier: `${deviceKey}-simulator`,
      });
      if (linked) {
        const patch = {};
        if (body.unitId !== undefined) patch.unitId = body.unitId;
        if (body.port !== undefined) {
          patch.connection = {
            protocol: linked.connection?.protocol || 'TCP',
            host: linked.connection?.host || '127.0.0.1',
            port: body.port,
          };
        }
        if (Object.keys(patch).length > 0) {
          const updated = await this.deviceRepository.updateById(linked._id, patch);
          syncedDevice = updated
            ? { _id: String(updated._id), identifier: updated.identifier }
            : null;
        }
      }
    } catch (error) {
      this.runtime.logger?.warn?.(`Unable to sync simulator device ${deviceKey}`, error?.message);
    }

    if (wasRunning) {
      await startDevice(deviceKey);
    }
    return sendSuccess(res, {
      data: device.getStatus(),
      meta: { syncedDevice },
    });
  }

  async startDevice(req, res) {
    const deviceKey = req.validated.params.deviceKey;
    await startDevice(deviceKey);
    const device = this.runtime.getDevice(deviceKey);
    return sendSuccess(res, { data: device.getStatus() });
  }

  async stopDevice(req, res) {
    const deviceKey = req.validated.params.deviceKey;
    await stopDevice(deviceKey);
    const device = this.runtime.getDevice(deviceKey);
    return sendSuccess(res, { data: device.getStatus() });
  }
}

module.exports = SimulatorController;
