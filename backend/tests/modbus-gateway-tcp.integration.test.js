'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const ModbusRTU = require('modbus-serial');
const { ModbusGatewayRuntime } = require('../src/gateway/modbus-gateway-runtime');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function closeClient(client) {
  return new Promise((resolve) => {
    if (!client.isOpen) return resolve();
    return client.close(resolve);
  });
}

test('TCP gateway serves FC03 values and performs FC06 write-through', async () => {
  const port = await availablePort();
  const writes = [];
  const runtime = new ModbusGatewayRuntime({
    writeThroughService: {
      write: async (_mapping, value) => writes.push(value),
    },
    logger: { info() {}, warn() {} },
  });
  const mapping = {
    key: 'voltage',
    name: 'Voltage',
    sourceDeviceId: '507f1f77bcf86cd799439011',
    sourceRegisterKey: 'voltage',
    registerType: 'HOLDING_REGISTER',
    address: 10,
    dataType: 'UINT16',
    length: 1,
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor: 0.1,
    offset: 0,
    writable: true,
    enabled: true,
  };
  runtime.configure({
    enabled: true,
    unitId: 1,
    tcp: { enabled: true, host: '127.0.0.1', port },
    rtu: {
      enabled: false,
      serialPath: '/dev/ttyUSB1',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    mappings: [mapping],
  });
  runtime.publish(mapping.sourceDeviceId, [{ registerKey: 'voltage', value: 230.5 }]);

  const client = new ModbusRTU();
  try {
    await runtime.start();
    await client.connectTCP('127.0.0.1', { port });
    client.setID(1);

    const before = await client.readHoldingRegisters(10, 1);
    assert.deepEqual(before.data, [2305]);

    await client.writeRegister(10, 2400);
    assert.deepEqual(writes, [240]);

    const after = await client.readHoldingRegisters(10, 1);
    assert.deepEqual(after.data, [2400]);
  } finally {
    await closeClient(client);
    await runtime.stop();
  }
});
