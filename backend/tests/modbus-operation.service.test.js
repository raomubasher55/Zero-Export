'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { REGISTER_TYPES } = require('../src/constants/modbus');
const ModbusOperationService = require('../src/services/modbus-operation.service');

class FakeConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.status = {
      state: 'CONNECTED',
      connected: true,
      connectionKey: 'TCP:127.0.0.1:502',
    };
  }

  async execute(device, operationName, operation) {
    this.executed = { device, operationName };
    return operation({
      readHoldingRegisters: async (address, quantity) => ({
        data: Array.from({ length: quantity }, (_, index) => address + index),
      }),
    });
  }

  getDeviceStatus() {
    return this.status;
  }
}

test('ModbusOperationService delegates a raw holding-register read and records online state', async () => {
  const connectionManager = new FakeConnectionManager();
  const onlineDevices = [];
  const service = new ModbusOperationService({
    connectionManager,
    deviceRepository: {
      findById: async () => ({
        _id: '507f1f77bcf86cd799439011',
        isEnabled: true,
        unitId: 1,
        connection: { protocol: 'TCP', host: '127.0.0.1', port: 502 },
        reconnect: { timeoutMs: 1000, retries: 0, retryDelayMs: 0 },
      }),
    },
    runtimeService: {
      markOnline: async (deviceId) => onlineDevices.push(String(deviceId)),
      markOnlineMany: async () => undefined,
      markOfflineMany: async () => undefined,
      markFailureMany: async () => undefined,
      markFailure: async () => undefined,
    },
    communicationLogRepository: {
      create: async () => undefined,
    },
    logger: { error() {} },
  });

  try {
    const result = await service.read('507f1f77bcf86cd799439011', {
      registerType: REGISTER_TYPES.HOLDING,
      address: 100,
      quantity: 2,
    });

    assert.deepEqual(result.values, [100, 101]);
    assert.equal(connectionManager.executed.operationName, 'read');
    assert.deepEqual(onlineDevices, ['507f1f77bcf86cd799439011']);
  } finally {
    service.dispose();
  }
});
