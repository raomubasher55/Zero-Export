'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Device = require('../src/models/device.model');
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
