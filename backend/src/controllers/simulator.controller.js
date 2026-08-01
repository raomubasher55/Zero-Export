'use strict';

const { meterSimulator } = require('../simulator/meter-simulator');
const { sendSuccess } = require('../utils/api-response');

class SimulatorController {
  constructor(runtime = meterSimulator) {
    this.runtime = runtime;
    this.get = this.get.bind(this);
    this.getValues = this.getValues.bind(this);
    this.update = this.update.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
  }

  async get(_req, res) {
    return sendSuccess(res, { data: this.runtime.getStatus() });
  }

  async getValues(_req, res) {
    return sendSuccess(res, { data: this.runtime.getValues() });
  }

  async update(req, res) {
    const wasRunning = this.runtime.getStatus().state === 'RUNNING';
    await this.runtime.stop();
    this.runtime.configure(req.validated.body);
    if (wasRunning) {
      await this.runtime.start();
    }
    return sendSuccess(res, { data: this.runtime.getStatus() });
  }

  async start(_req, res) {
    return sendSuccess(res, { data: await this.runtime.start() });
  }

  async stop(_req, res) {
    return sendSuccess(res, { data: await this.runtime.stop() });
  }
}

module.exports = SimulatorController;
