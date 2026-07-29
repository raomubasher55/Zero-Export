'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const { REGISTER_TYPES } = require('../constants/modbus');
const {
  COMMUNICATION_OPERATIONS,
  COMMUNICATION_OUTCOMES,
  COMMUNICATION_SOURCES,
} = require('../models/communication-log.model');
const logger = require('../config/logger');
const { modbusConnectionManager } = require('../modbus/connection-manager');
const { ModbusTransportError } = require('../modbus/modbus-error');
const CommunicationLogRepository = require('../repositories/communication-log.repository');
const DeviceRepository = require('../repositories/device.repository');
const AppError = require('../utils/app-error');
const DeviceRuntimeService = require('./device-runtime.service');

function notFound() {
  return new AppError('Device was not found.', {
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.NOT_FOUND,
  });
}

function deviceDisabled() {
  return new AppError('The device is disabled and cannot perform Modbus operations.', {
    statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
    code: ERROR_CODES.DEVICE_DISABLED,
  });
}

function operationDurationMs(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
}

class ModbusOperationService {
  constructor(options = {}) {
    this.deviceRepository = options.deviceRepository || new DeviceRepository();
    this.runtimeService = options.runtimeService || new DeviceRuntimeService(this.deviceRepository);
    this.communicationLogRepository = options.communicationLogRepository || new CommunicationLogRepository();
    this.connectionManager = options.connectionManager || modbusConnectionManager;
    this.logger = options.logger || logger;

    this.onConnectionOnline = (event) => {
      void this.persistLifecycle(() => this.runtimeService.markOnlineMany(event.deviceIds), 'online', event);
    };
    this.onConnectionOffline = (event) => {
      void this.persistLifecycle(
        () => this.runtimeService.markOfflineMany(event.deviceIds, event.error),
        'offline',
        event,
      );
    };
    this.onConnectionError = (event) => {
      void this.persistLifecycle(
        () => this.runtimeService.markFailureMany(event.deviceIds, event.error),
        'error',
        event,
      );
    };

    this.connectionManager.on('connection:online', this.onConnectionOnline);
    this.connectionManager.on('connection:offline', this.onConnectionOffline);
    this.connectionManager.on('connection:error', this.onConnectionError);
  }

  dispose() {
    this.connectionManager.removeListener('connection:online', this.onConnectionOnline);
    this.connectionManager.removeListener('connection:offline', this.onConnectionOffline);
    this.connectionManager.removeListener('connection:error', this.onConnectionError);
  }

  async getConnectionStatus(deviceId) {
    await this.getDevice(deviceId);
    return this.connectionManager.getDeviceStatus(deviceId);
  }

  async connect(deviceId) {
    const device = await this.getEnabledDevice(deviceId);
    const startedAt = process.hrtime.bigint();

    try {
      const connection = await this.connectionManager.connectDevice(device);
      await this.runtimeService.markOnline(device._id);
      await this.writeCommunicationLog({
        device,
        operation: COMMUNICATION_OPERATIONS.CONNECT,
        outcome: COMMUNICATION_OUTCOMES.SUCCESS,
        durationMs: operationDurationMs(startedAt),
      });
      return connection;
    } catch (error) {
      await this.persistFailure(device._id, error);
      await this.writeCommunicationLog({
        device,
        operation: COMMUNICATION_OPERATIONS.CONNECT,
        outcome: COMMUNICATION_OUTCOMES.FAILURE,
        durationMs: operationDurationMs(startedAt),
        error,
      });
      throw this.toHttpError(error, 'connect');
    }
  }

  async disconnect(deviceId) {
    const device = await this.getDevice(deviceId);
    const startedAt = process.hrtime.bigint();
    const connection = await this.connectionManager.disconnectDevice(device._id);
    await this.runtimeService.markOfflineMany([String(device._id)], {
      code: 'MANUAL_DISCONNECT',
      message: 'Connection was manually released.',
    });
    await this.writeCommunicationLog({
      device,
      operation: COMMUNICATION_OPERATIONS.CONNECT,
      outcome: COMMUNICATION_OUTCOMES.SUCCESS,
      durationMs: operationDurationMs(startedAt),
    });
    return connection;
  }

  async read(deviceId, request) {
    const device = await this.getEnabledDevice(deviceId);
    const startedAt = process.hrtime.bigint();

    try {
      const result = await this.connectionManager.execute(device, 'read', (client) => {
        switch (request.registerType) {
          case REGISTER_TYPES.COIL:
            return client.readCoils(request.address, request.quantity);
          case REGISTER_TYPES.DISCRETE_INPUT:
            return client.readDiscreteInputs(request.address, request.quantity);
          case REGISTER_TYPES.HOLDING:
            return client.readHoldingRegisters(request.address, request.quantity);
          case REGISTER_TYPES.INPUT:
            return client.readInputRegisters(request.address, request.quantity);
          default:
            throw new ModbusTransportError('Unsupported Modbus register type.', {
              code: 'MODBUS_OPERATION_ERROR',
              retryable: false,
            });
        }
      });

      const elapsedMs = operationDurationMs(startedAt);
      await this.runtimeService.markOnline(device._id);
      await this.writeCommunicationLog({
        device,
        operation: COMMUNICATION_OPERATIONS.READ,
        outcome: COMMUNICATION_OUTCOMES.SUCCESS,
        durationMs: elapsedMs,
        batchCount: 1,
        registerCount: request.quantity,
        decodedCount: request.quantity,
      });
      return {
        registerType: request.registerType,
        address: request.address,
        quantity: request.quantity,
        values: result.data.slice(0, request.quantity),
        durationMs: elapsedMs,
        connection: this.connectionManager.getDeviceStatus(device._id),
      };
    } catch (error) {
      await this.persistFailure(device._id, error);
      await this.writeCommunicationLog({
        device,
        operation: COMMUNICATION_OPERATIONS.READ,
        outcome: COMMUNICATION_OUTCOMES.FAILURE,
        durationMs: operationDurationMs(startedAt),
        batchCount: 1,
        registerCount: request.quantity,
        error,
      });
      throw this.toHttpError(error, 'read');
    }
  }

  async write(deviceId, request) {
    const device = await this.getEnabledDevice(deviceId);
    const startedAt = process.hrtime.bigint();

    try {
      const result = await this.connectionManager.execute(device, 'write', (client) => {
        if (request.registerType === REGISTER_TYPES.COIL) {
          return request.values.length === 1
            ? client.writeCoil(request.address, request.values[0])
            : client.writeCoils(request.address, request.values);
        }

        return request.values.length === 1
          ? client.writeRegister(request.address, request.values[0])
          : client.writeRegisters(request.address, request.values);
      });

      const elapsedMs = operationDurationMs(startedAt);
      await this.runtimeService.markOnline(device._id);
      await this.writeCommunicationLog({
        device,
        operation: COMMUNICATION_OPERATIONS.WRITE,
        outcome: COMMUNICATION_OUTCOMES.SUCCESS,
        durationMs: elapsedMs,
        batchCount: 1,
        registerCount: request.values.length,
      });
      return {
        registerType: request.registerType,
        address: request.address,
        quantity: request.values.length,
        result,
        durationMs: elapsedMs,
        connection: this.connectionManager.getDeviceStatus(device._id),
      };
    } catch (error) {
      await this.persistFailure(device._id, error);
      await this.writeCommunicationLog({
        device,
        operation: COMMUNICATION_OPERATIONS.WRITE,
        outcome: COMMUNICATION_OUTCOMES.FAILURE,
        durationMs: operationDurationMs(startedAt),
        batchCount: 1,
        registerCount: request.values.length,
        error,
      });
      throw this.toHttpError(error, 'write');
    }
  }

  async getDevice(deviceId) {
    const device = await this.deviceRepository.findById(deviceId);
    if (!device) {
      throw notFound();
    }

    return device;
  }

  async getEnabledDevice(deviceId) {
    const device = await this.getDevice(deviceId);
    if (!device.isEnabled) {
      throw deviceDisabled();
    }

    return device;
  }

  async writeCommunicationLog(entry) {
    try {
      await this.communicationLogRepository.create({
        device: entry.device._id,
        operation: entry.operation,
        source: COMMUNICATION_SOURCES.API,
        outcome: entry.outcome,
        durationMs: entry.durationMs,
        request: {
          batchCount: entry.batchCount,
          registerCount: entry.registerCount,
        },
        response: {
          decodedCount: entry.decodedCount,
          failedRegisterKeys: [],
        },
        error: entry.error
          ? {
              code: entry.error.code || entry.error.errno || ERROR_CODES.MODBUS_OPERATION_ERROR,
              message: String(entry.error.message || 'Modbus communication failed.').slice(0, 2000),
            }
          : undefined,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Unable to persist Modbus communication log', {
        deviceId: String(entry.device._id),
        error: error.stack || error.message,
      });
    }
  }

  async persistFailure(deviceId, error) {
    try {
      await this.runtimeService.markFailure(deviceId, error);
    } catch (persistenceError) {
      this.logger.error('Unable to persist Modbus device failure state', {
        deviceId: String(deviceId),
        error: persistenceError.stack || persistenceError.message,
      });
    }
  }

  async persistLifecycle(operation, state, event) {
    try {
      await operation();
    } catch (error) {
      this.logger.error('Unable to persist Modbus connection lifecycle state', {
        state,
        connectionKey: event.connectionKey,
        error: error.stack || error.message,
      });
    }
  }

  toHttpError(error, operation) {
    if (error instanceof AppError) {
      return error;
    }

    const code = error?.code || ERROR_CODES.MODBUS_OPERATION_ERROR;
    const detail = {
      field: 'operation',
      message: operation,
      code,
    };

    switch (code) {
      case ERROR_CODES.MODBUS_TIMEOUT:
        return new AppError('Modbus device did not respond before the configured timeout.', {
          statusCode: HTTP_STATUS.GATEWAY_TIMEOUT,
          code,
          details: [detail],
        });
      case ERROR_CODES.MODBUS_POOL_EXHAUSTED:
        return new AppError('Modbus connection capacity is currently exhausted.', {
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
          code,
          details: [detail],
        });
      case ERROR_CODES.MODBUS_EXCEPTION:
        return new AppError('The Modbus device rejected the requested operation.', {
          statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
          code,
          details: [detail],
        });
      case ERROR_CODES.MODBUS_CONNECTION_ERROR:
        return new AppError('Unable to establish or maintain Modbus communication with the device.', {
          statusCode: HTTP_STATUS.BAD_GATEWAY,
          code,
          details: [detail],
        });
      default:
        return new AppError('The Modbus operation failed.', {
          statusCode: HTTP_STATUS.BAD_GATEWAY,
          code: ERROR_CODES.MODBUS_OPERATION_ERROR,
          details: [detail],
        });
    }
  }
}

module.exports = ModbusOperationService;
