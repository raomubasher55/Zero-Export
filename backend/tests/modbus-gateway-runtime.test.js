'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_DATA_TYPES, REGISTER_TYPES } = require('../src/constants/modbus');
const { ModbusGatewayRuntime } = require('../src/gateway/modbus-gateway-runtime');

function configuration(mapping) {
  return {
    enabled: false,
    unitId: 7,
    tcp: { enabled: true, host: '127.0.0.1', port: 1502 },
    rtu: {
      enabled: false,
      serialPath: '/dev/ttyUSB1',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    mappings: [mapping],
  };
}

function uint32Mapping(overrides = {}) {
  return {
    key: 'forwarded_power',
    name: 'Forwarded power',
    sourceDeviceId: '507f1f77bcf86cd799439011',
    sourceRegisterKey: 'power',
    registerType: REGISTER_TYPES.HOLDING,
    address: 100,
    dataType: REGISTER_DATA_TYPES.UINT32,
    length: 2,
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'LITTLE_ENDIAN',
    bitIndex: 0,
    scaleFactor: 0.1,
    offset: 0,
    writable: true,
    enabled: true,
    sourceDevice: { _id: '507f1f77bcf86cd799439011' },
    sourceDefinition: {
      key: 'power',
      writable: true,
      registerType: REGISTER_TYPES.HOLDING,
    },
    ...overrides,
  };
}

test('gateway runtime publishes engineering values into its configured Modbus slave map', () => {
  const runtime = new ModbusGatewayRuntime({
    writeThroughService: { write: async () => undefined },
    logger: { info() {}, warn() {} },
  });
  const mapping = uint32Mapping();
  runtime.configure(configuration(mapping));

  runtime.publish(mapping.sourceDeviceId, [
    { registerKey: 'power', value: 6553.8, sampledAt: new Date('2026-01-01T00:00:00Z') },
  ]);

  assert.deepEqual(runtime.readMany(REGISTER_TYPES.HOLDING, 100, 2, 7), [2, 1]);
  assert.equal(runtime.getStatus().mappings[0].updatedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.throws(
    () => runtime.read(REGISTER_TYPES.HOLDING, 102, 7),
    (error) => error.modbusErrorCode === 0x02,
  );
});

test('gateway runtime decodes a downstream FC16 write and invokes upstream write-through', async () => {
  const writes = [];
  const runtime = new ModbusGatewayRuntime({
    writeThroughService: {
      write: async (mapping, value) => writes.push({ mapping, value }),
    },
    logger: { info() {}, warn() {} },
  });
  const mapping = uint32Mapping();
  runtime.configure(configuration(mapping));

  const vector = runtime.createVector();
  await vector.setRegisterArray(100, [2, 1], 7);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].mapping.key, mapping.key);
  assert.equal(writes[0].value, 6553.8);
  assert.deepEqual(vector.getMultipleHoldingRegisters(100, 2, 7), [2, 1]);
});

test('gateway runtime returns a device-failure exception until a source value is available', () => {
  const runtime = new ModbusGatewayRuntime({
    writeThroughService: { write: async () => undefined },
    logger: { info() {}, warn() {} },
  });
  runtime.configure(configuration(uint32Mapping()));

  assert.throws(
    () => runtime.read(REGISTER_TYPES.HOLDING, 100, 7),
    (error) => error.modbusErrorCode === 0x04,
  );
});

test('gateway runtime rejects write-through for read-only and wrong-unit requests', async () => {
  const runtime = new ModbusGatewayRuntime({
    writeThroughService: { write: async () => undefined },
    logger: { info() {}, warn() {} },
  });
  runtime.configure(configuration(uint32Mapping({ writable: false })));

  await assert.rejects(
    runtime.createVector().setRegister(100, 10, 7),
    (error) => error.modbusErrorCode === 0x02,
  );
  assert.throws(
    () => runtime.read(REGISTER_TYPES.HOLDING, 100, 8),
    (error) => error.modbusErrorCode === 0x0b,
  );
});
