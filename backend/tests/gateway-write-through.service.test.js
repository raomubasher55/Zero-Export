'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const GatewayWriteThroughService = require('../src/services/gateway-write-through.service');

function sourceDevice(register) {
  return {
    _id: '507f1f77bcf86cd799439011',
    registerProfile: { registers: [register] },
  };
}

test('GatewayWriteThroughService applies current source scaling and order before writing', async () => {
  const writes = [];
  const service = new GatewayWriteThroughService({
    deviceRepository: {
      findByIdForPolling: async () =>
        sourceDevice({
          key: 'setpoint',
          registerType: 'HOLDING_REGISTER',
          address: 20,
          dataType: 'UINT32',
          length: 2,
          byteOrder: 'BIG_ENDIAN',
          wordOrder: 'LITTLE_ENDIAN',
          scaleFactor: 0.1,
          offset: 0,
          writable: true,
        }),
    },
    modbusOperationService: {
      write: async (...args) => writes.push(args),
    },
  });

  await service.write(
    {
      sourceDeviceId: '507f1f77bcf86cd799439011',
      sourceRegisterKey: 'setpoint',
    },
    6553.8,
  );

  assert.deepEqual(writes, [
    [
      '507f1f77bcf86cd799439011',
      { registerType: 'HOLDING_REGISTER', address: 20, values: [2, 1] },
      'GATEWAY',
    ],
  ]);
});

test('GatewayWriteThroughService performs a read-modify-write for a holding-register bit', async () => {
  const writes = [];
  const service = new GatewayWriteThroughService({
    deviceRepository: {
      findByIdForPolling: async () =>
        sourceDevice({
          key: 'remote_enable',
          registerType: 'HOLDING_REGISTER',
          address: 30,
          dataType: 'BIT',
          length: 1,
          bitIndex: 3,
          writable: true,
        }),
    },
    modbusOperationService: {
      read: async () => ({ values: [1] }),
      write: async (...args) => writes.push(args),
    },
  });

  await service.write(
    {
      sourceDeviceId: '507f1f77bcf86cd799439011',
      sourceRegisterKey: 'remote_enable',
    },
    true,
  );

  assert.equal(writes[0][1].values[0], 9);
});
