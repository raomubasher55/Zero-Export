'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { gatewayConfigurationSchema } = require('../src/validators/gateway.validator');

function mapping(overrides = {}) {
  return {
    key: 'voltage_l1',
    name: 'Voltage L1',
    sourceDeviceId: '507f1f77bcf86cd799439011',
    sourceRegisterKey: 'voltage_l1',
    registerType: 'INPUT_REGISTER',
    address: 0,
    dataType: 'UINT32',
    length: 2,
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor: 0.1,
    offset: 0,
    unit: 'V',
    writable: false,
    enabled: true,
    ...overrides,
  };
}

function configuration(mappings = [mapping()]) {
  return {
    enabled: true,
    unitId: 1,
    tcp: { enabled: true, host: '0.0.0.0', port: 1502 },
    rtu: {
      enabled: false,
      serialPath: '/dev/ttyUSB1',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    mappings,
  };
}

test('gateway validator accepts simultaneous TCP/RTU-capable forwarding settings', () => {
  const result = gatewayConfigurationSchema.safeParse(
    configuration([
      mapping(),
      mapping({
        key: 'enable',
        sourceRegisterKey: 'enable',
        registerType: 'COIL',
        address: 10,
        dataType: 'BIT',
        length: 1,
        scaleFactor: 1,
        writable: true,
      }),
    ]),
  );
  assert.equal(result.success, true);
});

test('gateway validator rejects overlapping ranges and writes to input areas', () => {
  const result = gatewayConfigurationSchema.safeParse(
    configuration([
      mapping(),
      mapping({ key: 'overlap', sourceRegisterKey: 'other', address: 1, writable: true }),
    ]),
  );

  assert.equal(result.success, false);
  const messages = result.error.issues.map((issue) => issue.message);
  assert.ok(messages.some((message) => message.includes('cannot accept downstream writes')));
  assert.ok(messages.some((message) => message.includes('cannot overlap')));
});
