'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Device = require('../src/models/device.model');
const GatewayConfiguration = require('../src/models/gateway-configuration.model');
const RegisterProfile = require('../src/models/register-profile.model');

test('Device model enforces protocol-specific transport fields', async () => {
  const invalidDevice = new Device({
    identifier: 'tcp-meter',
    name: 'TCP meter',
    connection: { protocol: 'TCP' },
  });

  await assert.rejects(
    invalidDevice.validate(),
    (error) => error.name === 'ValidationError' && Boolean(error.errors['connection.host']),
  );

  const validRtuDevice = new Device({
    identifier: 'rtu-meter',
    name: 'RTU meter',
    connection: {
      protocol: 'RTU',
      serialPath: '/dev/ttyUSB0',
    },
  });

  await assert.doesNotReject(validRtuDevice.validate());
});

test('RegisterProfile model rejects register ranges exceeding the Modbus address space', async () => {
  const profile = new RegisterProfile({
    identifier: 'invalid-address-range',
    name: 'Invalid address range',
    registers: [
      {
        key: 'energy',
        name: 'Energy',
        registerType: 'INPUT_REGISTER',
        address: 65535,
        dataType: 'FLOAT32',
        length: 2,
      },
    ],
  });

  await assert.rejects(
    profile.validate(),
    (error) => error.name === 'ValidationError' && Boolean(error.errors['registers.0.address']),
  );
});

test('GatewayConfiguration model rejects overlapping enabled slave register ranges', async () => {
  const baseMapping = {
    name: 'Power',
    sourceDeviceId: '507f1f77bcf86cd799439011',
    sourceRegisterKey: 'power',
    registerType: 'HOLDING_REGISTER',
    dataType: 'UINT32',
    length: 2,
    scaleFactor: 1,
    offset: 0,
    enabled: true,
  };
  const configuration = new GatewayConfiguration({
    enabled: true,
    mappings: [
      { ...baseMapping, key: 'power_1', address: 100 },
      { ...baseMapping, key: 'power_2', address: 101 },
    ],
  });

  await assert.rejects(
    configuration.validate(),
    (error) => error.name === 'ValidationError' && Boolean(error.errors['mappings.1.address']),
  );
});
