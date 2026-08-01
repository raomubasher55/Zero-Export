'use strict';

const { randomUUID } = require('node:crypto');
const { config } = require('../config/environment');
const logger = require('../config/logger');
const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const { DEVICE_STATUSES, REGISTER_TYPES } = require('../constants/modbus');
const {
  COMMUNICATION_OPERATIONS,
  COMMUNICATION_OUTCOMES,
  COMMUNICATION_SOURCES,
} = require('../models/communication-log.model');
const { modbusGatewayRuntime } = require('../gateway/modbus-gateway-runtime');
const { modbusConnectionManager } = require('../modbus/connection-manager');
const { isTimeoutError, toTransportError } = require('../modbus/modbus-error');
const { decodeRegister } = require('../modbus/register-decoder');
const { buildReadPlan, rawValuesForDefinition } = require('../modbus/register-read-planner');
const CommunicationLogRepository = require('../repositories/communication-log.repository');
const DeviceRepository = require('../repositories/device.repository');
const LatestValueRepository = require('../repositories/latest-value.repository');
const AppError = require('../utils/app-error');

class PollingError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PollingError';
    this.code = options.code || 'POLLING_ERROR';
    this.cause = options.cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

function durationMs(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
}

function isTransportTimeout(error) {
  return error?.code === ERROR_CODES.MODBUS_TIMEOUT || isTimeoutError(error);
}

function toErrorDetails(error) {
  const transportError = toTransportError(error, 'poll');
  const code = error?.code || transportError.code || 'POLLING_ERROR';
  const message = error instanceof PollingError
    ? error.message
    : transportError.message || 'Polling failed.';

  return {
    code,
    message: String(message).slice(0, 2000),
  };
}

class DevicePollingService {
  constructor(options = {}) {
    this.deviceRepository = options.deviceRepository || new DeviceRepository();
    this.latestValueRepository = options.latestValueRepository || new LatestValueRepository();
    this.communicationLogRepository = options.communicationLogRepository || new CommunicationLogRepository();
    this.connectionManager = options.connectionManager || modbusConnectionManager;
    this.gatewayRuntime = options.gatewayRuntime || modbusGatewayRuntime;
    this.logger = options.logger || logger;
    this.leaseMs = options.leaseMs || config.polling.leaseMs;
    this.random = options.random || Math.random;
  }

  async pollNow(deviceId) {
    const existingDevice = await this.deviceRepository.findById(deviceId);
    if (!existingDevice) {
      throw new AppError('Device was not found.', {
        statusCode: HTTP_STATUS.NOT_FOUND,
        code: ERROR_CODES.NOT_FOUND,
      });
    }
    if (!existingDevice.isEnabled || !existingDevice.polling?.enabled) {
      throw new AppError('Polling is disabled for this device.', {
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.POLLING_DISABLED,
      });
    }
    if (!existingDevice.registerProfile) {
      throw new AppError('A register profile must be assigned before polling this device.', {
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.REGISTER_PROFILE_UNAVAILABLE,
      });
    }

    const leaseId = randomUUID();
    const claimedDevice = await this.deviceRepository.claimDeviceForPolling(deviceId, {
      now: new Date(),
      leaseId,
      leaseMs: this.leaseMs,
    });
    if (!claimedDevice) {
      throw new AppError('A poll is already in progress for this device.', {
        statusCode: HTTP_STATUS.CONFLICT,
        code: ERROR_CODES.POLL_IN_PROGRESS,
      });
    }

    try {
      return await this.pollClaimedDevice(claimedDevice, leaseId, COMMUNICATION_SOURCES.MANUAL);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async claimNextDueDevice() {
    const leaseId = randomUUID();
    const device = await this.deviceRepository.claimNextDueForPolling({
      now: new Date(),
      leaseId,
      leaseMs: this.leaseMs,
    });

    return device ? { device, leaseId } : null;
  }

  async pollClaimedDevice(device, leaseId, source = COMMUNICATION_SOURCES.SCHEDULER) {
    const startedAt = process.hrtime.bigint();
    const polledAt = new Date();
    const profile = device.registerProfile;
    let plan = [];

    try {
      if (!profile || !profile.isActive) {
        throw new PollingError('The assigned register profile is unavailable or inactive.', {
          code: ERROR_CODES.REGISTER_PROFILE_UNAVAILABLE,
        });
      }

      plan = buildReadPlan(profile.registers, profile.maxReadQuantity);
      if (plan.length === 0) {
        throw new PollingError('The register profile has no enabled registers to poll.', {
          code: ERROR_CODES.REGISTER_PROFILE_UNAVAILABLE,
        });
      }

      const batchResponses = await this.connectionManager.execute(device, 'poll', async (client) => {
        const responses = [];
        for (const batch of plan) {
          const response = await this.readBatch(client, batch);
          responses.push({ ...batch, rawValues: response.data.slice(0, batch.quantity) });
        }
        return responses;
      });

      const { values, failures } = this.decodeResponses(batchResponses);
      if (values.length === 0) {
        throw new PollingError('No register values could be decoded from the Modbus response.', {
          code: 'REGISTER_DECODE_ERROR',
        });
      }

      await this.latestValueRepository.bulkUpsert(device, profile, values, polledAt);
      this.gatewayRuntime.publish(
        device._id,
        values.map((value) => ({ ...value, sampledAt: polledAt })),
      );

      const completedAt = new Date();
      const elapsedMs = durationMs(startedAt);
      await this.deviceRepository.recordPollSuccess(device._id, leaseId, {
        durationMs: elapsedMs,
        nextPollAt: this.nextPollAt(device, completedAt),
        polledAt: completedAt,
      });

      const outcome = failures.length > 0
        ? COMMUNICATION_OUTCOMES.PARTIAL_SUCCESS
        : COMMUNICATION_OUTCOMES.SUCCESS;
      await this.writeLog({
        device,
        profile,
        source,
        outcome,
        durationMs: elapsedMs,
        batchCount: plan.length,
        registerCount: profile.registers.filter((register) => register.enabled !== false).length,
        decodedCount: values.length,
        failedRegisterKeys: failures.map((failure) => failure.registerKey),
        timestamp: completedAt,
      });

      return {
        deviceId: String(device._id),
        source,
        outcome,
        durationMs: elapsedMs,
        batchCount: plan.length,
        decodedCount: values.length,
        failedRegisters: failures,
        sampledAt: polledAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const elapsedMs = durationMs(startedAt);
      const errorDetails = toErrorDetails(error);

      await this.deviceRepository.recordPollFailure(device._id, leaseId, {
        status: isTransportTimeout(error) ? DEVICE_STATUSES.TIMEOUT : DEVICE_STATUSES.ERROR,
        error: errorDetails,
        durationMs: elapsedMs,
        nextPollAt: this.nextPollAt(device, completedAt),
        polledAt: completedAt,
      });
      await this.writeLog({
        device,
        profile,
        source,
        outcome: COMMUNICATION_OUTCOMES.FAILURE,
        durationMs: elapsedMs,
        batchCount: plan.length,
        registerCount: profile?.registers?.filter((register) => register.enabled !== false).length || 0,
        decodedCount: 0,
        failedRegisterKeys: [],
        error: errorDetails,
        timestamp: completedAt,
      });

      throw error;
    }
  }

  async readBatch(client, batch) {
    switch (batch.registerType) {
      case REGISTER_TYPES.COIL:
        return client.readCoils(batch.address, batch.quantity);
      case REGISTER_TYPES.DISCRETE_INPUT:
        return client.readDiscreteInputs(batch.address, batch.quantity);
      case REGISTER_TYPES.HOLDING:
        return client.readHoldingRegisters(batch.address, batch.quantity);
      case REGISTER_TYPES.INPUT:
        return client.readInputRegisters(batch.address, batch.quantity);
      default:
        throw new PollingError(`Unsupported register type: ${batch.registerType}`, {
          code: 'REGISTER_DECODE_ERROR',
        });
    }
  }

  decodeResponses(batchResponses) {
    const values = [];
    const failures = [];

    for (const batch of batchResponses) {
      for (const definition of batch.registers) {
        try {
          const rawValues = rawValuesForDefinition(batch, batch.rawValues, definition);
          values.push(decodeRegister(definition, rawValues));
        } catch (error) {
          failures.push({
            registerKey: definition.key,
            message: String(error.message || 'Register decoding failed.').slice(0, 500),
          });
        }
      }
    }

    return { values, failures };
  }

  nextPollAt(device, from) {
    const intervalMs = device.polling.intervalMs;
    const jitterMs = device.polling.jitterMs || 0;
    const jitter = jitterMs === 0 ? 0 : Math.floor(this.random() * (jitterMs + 1));
    return new Date(from.getTime() + intervalMs + jitter);
  }

  async writeLog(entry) {
    try {
      await this.communicationLogRepository.create({
        device: entry.device._id,
        registerProfile: entry.profile?._id,
        operation: COMMUNICATION_OPERATIONS.POLL,
        source: entry.source,
        outcome: entry.outcome,
        durationMs: entry.durationMs,
        request: {
          batchCount: entry.batchCount,
          registerCount: entry.registerCount,
        },
        response: {
          decodedCount: entry.decodedCount,
          failedRegisterKeys: entry.failedRegisterKeys,
        },
        error: entry.error,
        timestamp: entry.timestamp,
      });
    } catch (error) {
      this.logger.error('Unable to persist Modbus communication log', {
        deviceId: String(entry.device._id),
        error: error.stack || error.message,
      });
    }
  }

  toHttpError(error) {
    if (error instanceof AppError) {
      return error;
    }

    const details = [{ field: 'operation', message: 'poll', code: error?.code || 'POLLING_ERROR' }];
    if (isTransportTimeout(error)) {
      return new AppError('Modbus device did not respond before the configured timeout.', {
        statusCode: HTTP_STATUS.GATEWAY_TIMEOUT,
        code: ERROR_CODES.MODBUS_TIMEOUT,
        details,
      });
    }

    if (error?.code === 'REGISTER_PROFILE_UNAVAILABLE' || error?.code === 'REGISTER_DECODE_ERROR') {
      return new AppError('The device register profile cannot be polled successfully.', {
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        code: error.code,
        details,
      });
    }

    return new AppError('The device polling operation failed.', {
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      code: error?.code === ERROR_CODES.MODBUS_EXCEPTION
        ? ERROR_CODES.MODBUS_EXCEPTION
        : ERROR_CODES.MODBUS_OPERATION_ERROR,
      details,
    });
  }
}

module.exports = {
  DevicePollingService,
  PollingError,
};
