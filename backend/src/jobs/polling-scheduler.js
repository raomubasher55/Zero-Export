'use strict';

const { config } = require('../config/environment');
const logger = require('../config/logger');
const { DevicePollingService } = require('../services/device-polling.service');

/**
 * Claims due devices with a MongoDB lease, then polls up to the configured
 * concurrency. Leases prevent duplicate work when multiple API instances run.
 */
class PollingScheduler {
  constructor(options = {}) {
    this.pollingService = options.pollingService || new DevicePollingService({ leaseMs: config.polling.leaseMs });
    this.logger = options.logger || logger;
    this.concurrency = options.concurrency || config.polling.concurrency;
    this.tickIntervalMs = options.tickIntervalMs || config.polling.tickIntervalMs;
    this.enabled = options.enabled ?? config.polling.enabled;
    this.timer = null;
    this.running = false;
    this.cycleRunning = false;
    this.activeTasks = new Set();
    this.lastCycleAt = null;
    this.lastError = null;
  }

  start() {
    if (!this.enabled || this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.tickIntervalMs);
    this.timer.unref?.();
    void this.runCycle();

    this.logger.info('Modbus polling scheduler started', {
      concurrency: this.concurrency,
      tickIntervalMs: this.tickIntervalMs,
    });
  }

  async stop() {
    if (!this.running && !this.timer) {
      return;
    }

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await Promise.allSettled([...this.activeTasks]);
    this.logger.info('Modbus polling scheduler stopped');
  }

  async runCycle() {
    if (!this.running || this.cycleRunning) {
      return;
    }

    this.cycleRunning = true;
    this.lastCycleAt = new Date();

    try {
      while (this.running && this.activeTasks.size < this.concurrency) {
        const claimed = await this.pollingService.claimNextDueDevice();
        if (!claimed) {
          break;
        }

        const task = this.executeClaimedPoll(claimed).finally(() => {
          this.activeTasks.delete(task);
        });
        this.activeTasks.add(task);
      }
    } catch (error) {
      this.lastError = {
        message: error.message,
        at: new Date(),
      };
      this.logger.error('Modbus polling scheduler cycle failed', {
        error: error.stack || error.message,
      });
    } finally {
      this.cycleRunning = false;
    }
  }

  async executeClaimedPoll({ device, leaseId }) {
    try {
      await this.pollingService.pollClaimedDevice(device, leaseId);
    } catch (error) {
      // pollClaimedDevice already writes the runtime failure state and a
      // communication log. The scheduler remains available for other devices.
      this.logger.warn('Scheduled Modbus poll failed', {
        deviceId: String(device._id),
        code: error.code,
        error: error.message,
      });
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      concurrency: this.concurrency,
      tickIntervalMs: this.tickIntervalMs,
      activePolls: this.activeTasks.size,
      lastCycleAt: this.lastCycleAt,
      lastError: this.lastError,
    };
  }
}

const pollingScheduler = new PollingScheduler();

module.exports = {
  PollingScheduler,
  pollingScheduler,
};
