'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const DeviceService = require('../src/services/device.service');
const RegisterProfileService = require('../src/services/register-profile.service');

test('DeviceService maps an assigned active profile to the persisted reference field', async () => {
  let persistedPayload;
  const service = new DeviceService({
    registerProfileRepository: {
      findById: async () => ({ _id: '507f1f77bcf86cd799439011', isActive: true }),
    },
    deviceRepository: {
      createWithProfile: async (payload) => {
        persistedPayload = payload;
        return payload;
      },
    },
  });

  const created = await service.create({
    identifier: 'main-meter',
    name: 'Main meter',
    registerProfileId: '507f1f77bcf86cd799439011',
  });

  assert.equal(persistedPayload.registerProfile, '507f1f77bcf86cd799439011');
  assert.equal('registerProfileId' in persistedPayload, false);
  assert.equal(created.identifier, 'main-meter');
});

test('DeviceService refuses assigning an inactive profile', async () => {
  const service = new DeviceService({
    registerProfileRepository: {
      findById: async () => ({ _id: '507f1f77bcf86cd799439011', isActive: false }),
    },
    deviceRepository: {},
  });

  await assert.rejects(
    service.create({
      identifier: 'main-meter',
      name: 'Main meter',
      registerProfileId: '507f1f77bcf86cd799439011',
    }),
    (error) => error.code === 'VALIDATION_ERROR' && error.statusCode === 422,
  );
});

test('RegisterProfileService prevents deletion while devices reference the profile', async () => {
  const service = new RegisterProfileService({
    registerProfileRepository: {
      deleteById: async () => {
        throw new Error('delete should not be reached');
      },
    },
    deviceRepository: {
      countByRegisterProfile: async () => 3,
    },
  });

  await assert.rejects(
    service.delete('507f1f77bcf86cd799439011'),
    (error) => error.code === 'CONFLICT' && error.statusCode === 409,
  );
});

test('DeviceService releases a pooled connection when transport configuration changes', async () => {
  const invalidatedDeviceIds = [];
  const service = new DeviceService({
    registerProfileRepository: {},
    connectionManager: {
      invalidateDevice: async (deviceId) => invalidatedDeviceIds.push(deviceId),
      disconnectDevice: async () => undefined,
    },
    deviceRepository: {
      findById: async () => ({
        polling: { enabled: true, intervalMs: 60000, jitterMs: 0 },
        reconnect: { timeoutMs: 3000, retries: 2, retryDelayMs: 500 },
      }),
      updateByIdWithProfile: async (_deviceId, payload) => payload,
    },
  });

  await service.update('507f1f77bcf86cd799439011', {
    connection: {
      protocol: 'TCP',
      host: '192.168.10.99',
      port: 502,
    },
  });

  assert.deepEqual(invalidatedDeviceIds, ['507f1f77bcf86cd799439011']);
});
