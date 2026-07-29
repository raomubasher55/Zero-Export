'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COMMUNICATION_SOURCES } = require('../src/models/communication-log.model');
const { REGISTER_DATA_TYPES, REGISTER_TYPES } = require('../src/constants/modbus');
const { DevicePollingService } = require('../src/services/device-polling.service');

test('DevicePollingService reads a planned profile, decodes values, persists latest values, and records success', async () => {
  const captured = {
    latest: [],
    logs: [],
    success: [],
  };
  const device = {
    _id: '507f1f77bcf86cd799439011',
    unitId: 1,
    isEnabled: true,
    connection: { protocol: 'TCP', host: '127.0.0.1', port: 502 },
    reconnect: { timeoutMs: 1000, retries: 0, retryDelayMs: 0 },
    polling: { enabled: true, intervalMs: 60000, jitterMs: 0 },
    registerProfile: {
      _id: '507f1f77bcf86cd799439012',
      isActive: true,
      registers: [
        {
          key: 'voltage',
          name: 'Voltage',
          registerType: REGISTER_TYPES.INPUT,
          address: 0,
          dataType: REGISTER_DATA_TYPES.UINT16,
          length: 1,
          scaleFactor: 0.1,
          offset: 0,
          enabled: true,
        },
        {
          key: 'current',
          name: 'Current',
          registerType: REGISTER_TYPES.INPUT,
          address: 1,
          dataType: REGISTER_DATA_TYPES.UINT16,
          length: 1,
          scaleFactor: 0.01,
          offset: 0,
          enabled: true,
        },
      ],
    },
  };

  const service = new DevicePollingService({
    random: () => 0,
    connectionManager: {
      execute: async (_device, operation, callback) => {
        assert.equal(operation, 'poll');
        return callback({
          readInputRegisters: async () => ({ data: [2300, 1234] }),
        });
      },
    },
    deviceRepository: {
      recordPollSuccess: async (...args) => captured.success.push(args),
      recordPollFailure: async () => {
        throw new Error('failure must not be recorded');
      },
    },
    latestValueRepository: {
      bulkUpsert: async (...args) => captured.latest.push(args),
    },
    communicationLogRepository: {
      create: async (entry) => captured.logs.push(entry),
    },
    logger: { error() {} },
  });

  const result = await service.pollClaimedDevice(device, 'lease-1', COMMUNICATION_SOURCES.MANUAL);

  assert.equal(result.outcome, 'SUCCESS');
  assert.equal(result.batchCount, 1);
  assert.equal(result.decodedCount, 2);
  assert.equal(captured.latest.length, 1);
  assert.deepEqual(
    captured.latest[0][2].map((value) => ({ key: value.registerKey, value: value.value })),
    [
      { key: 'voltage', value: 230 },
      { key: 'current', value: 12.34 },
    ],
  );
  assert.equal(captured.success.length, 1);
  assert.equal(captured.logs[0].outcome, 'SUCCESS');
});

test('DevicePollingService records a timeout failure and communication log while releasing the poll lease', async () => {
  const captured = { failures: [], logs: [] };
  const device = {
    _id: '507f1f77bcf86cd799439021',
    polling: { enabled: true, intervalMs: 60000, jitterMs: 0 },
    registerProfile: {
      _id: '507f1f77bcf86cd799439022',
      isActive: true,
      registers: [
        {
          key: 'voltage',
          name: 'Voltage',
          registerType: REGISTER_TYPES.INPUT,
          address: 0,
          dataType: REGISTER_DATA_TYPES.UINT16,
          length: 1,
          scaleFactor: 1,
          offset: 0,
          enabled: true,
        },
      ],
    },
  };
  const timeout = new Error('Timed out');
  timeout.code = 'MODBUS_TIMEOUT';

  const service = new DevicePollingService({
    connectionManager: {
      execute: async () => {
        throw timeout;
      },
    },
    deviceRepository: {
      recordPollSuccess: async () => {
        throw new Error('success must not be recorded');
      },
      recordPollFailure: async (...args) => captured.failures.push(args),
    },
    latestValueRepository: {
      bulkUpsert: async () => {
        throw new Error('latest values must not be written');
      },
    },
    communicationLogRepository: {
      create: async (entry) => captured.logs.push(entry),
    },
    logger: { error() {} },
  });

  await assert.rejects(
    service.pollClaimedDevice(device, 'lease-timeout', COMMUNICATION_SOURCES.SCHEDULER),
    (error) => error === timeout,
  );

  assert.equal(captured.failures.length, 1);
  assert.equal(captured.failures[0][2].status, 'TIMEOUT');
  assert.equal(captured.logs[0].outcome, 'FAILURE');
  assert.equal(captured.logs[0].error.code, 'MODBUS_TIMEOUT');
});
