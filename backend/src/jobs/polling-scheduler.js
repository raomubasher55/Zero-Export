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
    this.lastPollCompletedAt = null;
    this.lastPollError = null;
    this.completedPolls = 0;
    this.successfulPolls = 0;
    this.failedPolls = 0;
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
      this.successfulPolls += 1;
      this.lastPollError = null;
    } catch (error) {
      this.failedPolls += 1;
      this.lastPollError = {
        deviceId: String(device._id),
        code: error.code,
        message: error.message,
        at: new Date(),
      };
      // pollClaimedDevice already writes the runtime failure state and a
      // communication log. The scheduler remains available for other devices.
      this.logger.warn('Scheduled Modbus poll failed', {
        deviceId: String(device._id),
        code: error.code,
        error: error.message,
      });
    } finally {
      this.completedPolls += 1;
      this.lastPollCompletedAt = new Date();
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      concurrency: this.concurrency,
      tickIntervalMs: this.tickIntervalMs,
      activePolls: this.activeTasks.size,
      completedPolls: this.completedPolls,
      successfulPolls: this.successfulPolls,
      failedPolls: this.failedPolls,
      lastCycleAt: this.lastCycleAt,
      lastPollCompletedAt: this.lastPollCompletedAt,
      lastPollError: this.lastPollError,
      lastError: this.lastError,
    };
  }
}

const pollingScheduler = new PollingScheduler();

module.exports = {
  PollingScheduler,
  pollingScheduler,
};
