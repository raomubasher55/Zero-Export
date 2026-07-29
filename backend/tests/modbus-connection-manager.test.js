'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { ModbusConnectionManager } = require('../src/modbus/connection-manager');

class FakeModbusClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.isOpen = false;
    this.connectCalls = [];
    this.unitIds = [];
    this.timeouts = [];
  }

  async connectTCP(host, options) {
    this.connectCalls.push({ protocol: 'TCP', host, options });
    if (this.options.connectError) {
      throw this.options.connectError;
    }
    this.isOpen = true;
  }

  async connectRTUBuffered(serialPath, options) {
    this.connectCalls.push({ protocol: 'RTU', serialPath, options });
    if (this.options.connectError) {
      throw this.options.connectError;
    }
    this.isOpen = true;
  }

  setTimeout(timeoutMs) {
    this.timeouts.push(timeoutMs);
  }

  setID(unitId) {
    this.unitIds.push(unitId);
  }

  close(callback) {
    this.isOpen = false;
    callback?.();
  }

  disconnectUnexpectedly() {
    this.isOpen = false;
    this.emit('close');
  }
}

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function tcpDevice(id, overrides = {}) {
  return {
    _id: id,
    unitId: 1,
    connection: {
      protocol: 'TCP',
      host: '192.168.1.50',
      port: 502,
    },
    reconnect: {
      timeoutMs: 50,
      retries: 1,
      retryDelayMs: 1,
    },
    ...overrides,
  };
}

async function waitFor(condition, timeoutMs = 200) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Condition was not reached before the timeout.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test('connection manager pools a transport endpoint and serializes unit-ID operations', async () => {
  const clients = [];
  const manager = new ModbusConnectionManager({
    clientFactory: () => {
      const client = new FakeModbusClient();
      clients.push(client);
      return client;
    },
    logger: silentLogger,
    maxPoolSize: 2,
  });
  const firstDevice = tcpDevice('device-a', { unitId: 1 });
  const secondDevice = tcpDevice('device-b', { unitId: 2 });
  const observedUnitIds = [];

  try {
    const [first, second] = await Promise.all([
      manager.execute(firstDevice, 'read', async (client) => {
        observedUnitIds.push(client.unitIds.at(-1));
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'first';
      }),
      manager.execute(secondDevice, 'read', async (client) => {
        observedUnitIds.push(client.unitIds.at(-1));
        return 'second';
      }),
    ]);

    assert.equal(first, 'first');
    assert.equal(second, 'second');
    assert.equal(clients.length, 1);
    assert.deepEqual(observedUnitIds, [1, 2]);
    assert.equal(manager.getDeviceStatus('device-a').pooled, true);
    assert.equal(manager.getPoolSnapshot().size, 1);
  } finally {
    await manager.shutdown();
  }
});

test('connection manager retries retryable Modbus timeouts using the device retry policy', async () => {
  const client = new FakeModbusClient();
  const manager = new ModbusConnectionManager({
    clientFactory: () => client,
    logger: silentLogger,
    maxPoolSize: 1,
  });
  let attempts = 0;

  try {
    const value = await manager.execute(tcpDevice('device-timeout'), 'read', async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('Timed out');
        error.errno = 'ETIMEDOUT';
        throw error;
      }
      return 42;
    });

    assert.equal(value, 42);
    assert.equal(attempts, 2);
    assert.deepEqual(client.unitIds, [1, 1]);
  } finally {
    await manager.shutdown();
  }
});

test('connection manager automatically reconnects after an unexpected transport close', async () => {
  const clients = [];
  const manager = new ModbusConnectionManager({
    clientFactory: () => {
      const client = new FakeModbusClient();
      clients.push(client);
      return client;
    },
    logger: silentLogger,
    maxPoolSize: 1,
  });

  try {
    await manager.connectDevice(tcpDevice('device-reconnect'));
    clients[0].disconnectUnexpectedly();

    await waitFor(() => clients.length === 2 && manager.getDeviceStatus('device-reconnect').connected);

    assert.equal(manager.getDeviceStatus('device-reconnect').state, 'CONNECTED');
    assert.equal(clients[1].connectCalls.length, 1);
  } finally {
    await manager.shutdown();
  }
});

test('connection manager rejects a distinct endpoint when the pool capacity is exhausted', async () => {
  const manager = new ModbusConnectionManager({
    clientFactory: () => new FakeModbusClient(),
    logger: silentLogger,
    maxPoolSize: 1,
  });

  try {
    await manager.connectDevice(tcpDevice('first-device'));
    await assert.rejects(
      manager.connectDevice(
        tcpDevice('second-device', {
          connection: { protocol: 'TCP', host: '192.168.1.51', port: 502 },
        }),
      ),
      (error) => error.code === 'MODBUS_POOL_EXHAUSTED',
    );
  } finally {
    await manager.shutdown();
  }
});

test('connection manager opens an RTU buffered serial transport with persisted line settings', async () => {
  const client = new FakeModbusClient();
  const manager = new ModbusConnectionManager({
    clientFactory: () => client,
    logger: silentLogger,
    maxPoolSize: 1,
  });

  try {
    await manager.connectDevice({
      _id: 'rtu-device',
      unitId: 7,
      connection: {
        protocol: 'RTU',
        serialPath: '/dev/ttyUSB0',
        baudRate: 19200,
        dataBits: 8,
        stopBits: 1,
        parity: 'even',
      },
      reconnect: { timeoutMs: 100, retries: 0, retryDelayMs: 1 },
    });

    assert.deepEqual(client.connectCalls, [
      {
        protocol: 'RTU',
        serialPath: '/dev/ttyUSB0',
        options: {
          baudRate: 19200,
          dataBits: 8,
          stopBits: 1,
          parity: 'even',
        },
      },
    ]);
  } finally {
    await manager.shutdown();
  }
});
