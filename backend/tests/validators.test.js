'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createDeviceBodySchema,
  updateDeviceBodySchema,
} = require('../src/validators/device.validator');
const {
  createRegisterProfileBodySchema,
} = require('../src/validators/register-profile.validator');

test('device validator normalizes a complete Modbus TCP device with safe defaults', () => {
  const result = createDeviceBodySchema.safeParse({
    identifier: 'Main-Meter_01',
    name: 'Main incomer meter',
    connection: {
      protocol: 'TCP',
      host: '192.168.10.25',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.identifier, 'main-meter_01');
  assert.deepEqual(result.data.connection, {
    protocol: 'TCP',
    host: '192.168.10.25',
    port: 502,
  });
  assert.deepEqual(result.data.polling, {
    enabled: true,
    intervalMs: 5000,
    jitterMs: 0,
  });
  assert.deepEqual(result.data.reconnect, {
    timeoutMs: 3000,
    retries: 2,
    retryDelayMs: 500,
  });
});

test('device validator rejects a partial transport configuration and unsafe polling jitter', () => {
  const missingTcpHost = createDeviceBodySchema.safeParse({
    identifier: 'main-meter',
    name: 'Main meter',
    connection: { protocol: 'TCP' },
  });
  assert.equal(missingTcpHost.success, false);

  const invalidPollingUpdate = updateDeviceBodySchema.safeParse({
    polling: { intervalMs: 1000, jitterMs: 5000 },
  });
  assert.equal(invalidPollingUpdate.success, false);
});

test('register profile validator derives fixed Modbus word lengths', () => {
  const result = createRegisterProfileBodySchema.safeParse({
    identifier: 'acme-pm5350',
    name: 'Acme PM5350 default map',
    registers: [
      {
        key: 'line_voltage_avg',
        name: 'Average line voltage',
        registerType: 'INPUT_REGISTER',
        address: 2999,
        dataType: 'FLOAT32',
        unit: 'V',
      },
      {
        key: 'serial_number',
        name: 'Serial number',
        registerType: 'HOLDING_REGISTER',
        address: 100,
        dataType: 'STRING',
        length: 8,
      },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.registers[0].length, 2);
  assert.equal(result.data.registers[0].bitIndex, 0);
  assert.equal(result.data.registers[1].length, 8);
});

test('register profile validator rejects duplicate register keys and invalid bit transport definitions', () => {
  const duplicateKeys = createRegisterProfileBodySchema.safeParse({
    identifier: 'invalid-profile',
    name: 'Invalid profile',
    registers: [
      {
        key: 'Power',
        name: 'Power',
        registerType: 'INPUT_REGISTER',
        address: 0,
        dataType: 'INT16',
      },
      {
        key: 'power',
        name: 'Power duplicate',
        registerType: 'INPUT_REGISTER',
        address: 1,
        dataType: 'INT16',
      },
    ],
  });
  assert.equal(duplicateKeys.success, false);

  const invalidCoil = createRegisterProfileBodySchema.safeParse({
    identifier: 'invalid-coil',
    name: 'Invalid coil',
    registers: [
      {
        key: 'coil_value',
        name: 'Coil value',
        registerType: 'COIL',
        address: 0,
        dataType: 'UINT16',
      },
    ],
  });
  assert.equal(invalidCoil.success, false);

  const writableInput = createRegisterProfileBodySchema.safeParse({
    identifier: 'writable-input',
    name: 'Writable input',
    registers: [
      {
        key: 'current',
        name: 'Current',
        registerType: 'INPUT_REGISTER',
        address: 0,
        dataType: 'FLOAT32',
        writable: true,
      },
    ],
  });
  assert.equal(writableInput.success, false);
});
