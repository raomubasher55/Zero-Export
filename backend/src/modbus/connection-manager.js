'use strict';

const { EventEmitter } = require('node:events');
const ModbusRTU = require('modbus-serial');
const { config } = require('../config/environment');
const logger = require('../config/logger');
const { MODBUS_PROTOCOLS } = require('../constants/modbus');
const { buildConnectionKey, getDeviceId, summarizeEndpoint } = require('./connection-key');
const {
  ModbusTransportError,
  isConnectionError,
  toTransportError,
} = require('./modbus-error');

const CONNECTION_STATES = Object.freeze({
  CONNECTED: 'CONNECTED',
  CONNECTING: 'CONNECTING',
  DISCONNECTED: 'DISCONNECTED',
  RECONNECTING: 'RECONNECTING',
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, timeoutMs, message) {
  let timer;

  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ModbusTransportError(message, {
              code: 'MODBUS_TIMEOUT',
              retryable: true,
            }),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function closeClient(client) {
  if (!client?.isOpen) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    timeout.unref?.();

    try {
      client.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

function normalizePolicy(device) {
  const reconnect = device.reconnect || {};

  return {
    timeoutMs: reconnect.timeoutMs || config.modbus.defaultTimeoutMs,
    retries: reconnect.retries ?? config.modbus.defaultRetries,
    retryDelayMs: reconnect.retryDelayMs ?? config.modbus.retryDelayMs,
  };
}

/**
 * Owns process-local Modbus clients. A single client is pooled per physical
 * endpoint and all requests through that client are serialized. Serializing is
 * critical because modbus-serial stores the active unit ID on the client.
 */
class ModbusConnectionManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.clientFactory = options.clientFactory || (() => new ModbusRTU());
    this.logger = options.logger || logger;
    this.maxPoolSize = options.maxPoolSize || config.modbus.poolMaxSize;
    this.connections = new Map();
    this.deviceConnections = new Map();
    this.shuttingDown = false;
  }

  async connectDevice(device) {
    const entry = this.registerDevice(device);
    const policy = normalizePolicy(device);

    try {
      await this.connectWithRetries(entry, policy);
      return this.describeEntry(entry, getDeviceId(device));
    } catch (error) {
      this.cleanupIdleEntry(entry);
      throw error;
    }
  }

  async execute(device, operationName, operation) {
    const entry = this.registerDevice(device);
    const policy = normalizePolicy(device);
    let lastError;

    for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
      try {
        return await this.enqueue(entry, async () => {
          await this.ensureConnected(entry, policy);
          entry.client.setTimeout(policy.timeoutMs);
          entry.client.setID(device.unitId);
          return operation(entry.client);
        });
      } catch (error) {
        const transportError = toTransportError(error, operationName);
        lastError = transportError;

        if (!transportError.retryable || attempt === policy.retries) {
          this.cleanupIdleEntry(entry);
          throw transportError;
        }

        if (isConnectionError(transportError.originalError) || transportError.code === 'MODBUS_CONNECTION_ERROR') {
          await this.invalidateEntry(entry, transportError.originalError, { scheduleReconnect: false });
        }

        this.logger.warn('Retrying Modbus operation', {
          operation: operationName,
          connectionKey: entry.key,
          attempt: attempt + 1,
          maxRetries: policy.retries,
          code: transportError.code,
        });
        await delay(this.retryDelay(policy.retryDelayMs, attempt + 1));
      }
    }

    throw lastError;
  }

  async disconnectDevice(deviceId) {
    const normalizedDeviceId = String(deviceId);
    const connectionKey = this.deviceConnections.get(normalizedDeviceId);

    if (!connectionKey) {
      return {
        deviceId: normalizedDeviceId,
        state: CONNECTION_STATES.DISCONNECTED,
        pooled: false,
      };
    }

    const entry = this.connections.get(connectionKey);
    this.deviceConnections.delete(normalizedDeviceId);

    if (!entry) {
      return {
        deviceId: normalizedDeviceId,
        state: CONNECTION_STATES.DISCONNECTED,
        pooled: false,
      };
    }

    entry.devices.delete(normalizedDeviceId);
    if (entry.devices.size > 0) {
      return {
        ...this.describeEntry(entry, normalizedDeviceId),
        pooled: true,
        released: true,
      };
    }

    await this.disposeEntry(entry);
    this.connections.delete(connectionKey);

    return {
      deviceId: normalizedDeviceId,
      state: CONNECTION_STATES.DISCONNECTED,
      pooled: false,
      released: true,
    };
  }

  /** Releases a stale device-to-endpoint mapping after transport settings change. */
  async invalidateDevice(deviceId) {
    return this.disconnectDevice(deviceId);
  }

  getDeviceStatus(deviceId) {
    const normalizedDeviceId = String(deviceId);
    const connectionKey = this.deviceConnections.get(normalizedDeviceId);
    const entry = connectionKey ? this.connections.get(connectionKey) : undefined;

    if (!entry) {
      return {
        deviceId: normalizedDeviceId,
        state: CONNECTION_STATES.DISCONNECTED,
        connected: false,
        pooled: false,
      };
    }

    return this.describeEntry(entry, normalizedDeviceId);
  }

  getPoolSnapshot() {
    return {
      size: this.connections.size,
      maxSize: this.maxPoolSize,
      connections: [...this.connections.values()].map((entry) => this.describeEntry(entry)),
    };
  }

  async shutdown() {
    this.shuttingDown = true;

    await Promise.all([...this.connections.values()].map((entry) => this.disposeEntry(entry)));
    this.connections.clear();
    this.deviceConnections.clear();
  }

  registerDevice(device) {
    if (this.shuttingDown) {
      throw new ModbusTransportError('Modbus connection manager is shutting down.', {
        code: 'MODBUS_CONNECTION_ERROR',
        retryable: false,
      });
    }

    const deviceId = getDeviceId(device);
    const key = buildConnectionKey(device.connection);
    const previousKey = this.deviceConnections.get(deviceId);

    if (previousKey && previousKey !== key) {
      const previousEntry = this.connections.get(previousKey);
      if (previousEntry) {
        previousEntry.devices.delete(deviceId);
        previousEntry.policies.delete(deviceId);
        if (previousEntry.devices.size === 0) {
          void this.disposeEntry(previousEntry);
          this.connections.delete(previousKey);
        }
      }
    }

    let entry = this.connections.get(key);
    if (!entry) {
      if (this.connections.size >= this.maxPoolSize) {
        throw new ModbusTransportError('Modbus connection pool capacity has been reached.', {
          code: 'MODBUS_POOL_EXHAUSTED',
          retryable: false,
        });
      }

      entry = this.createEntry(key, device.connection);
      this.connections.set(key, entry);
    }

    entry.devices.add(deviceId);
    entry.policies.set(deviceId, normalizePolicy(device));
    this.deviceConnections.set(deviceId, key);

    return entry;
  }

  createEntry(key, connection) {
    return {
      key,
      endpoint: summarizeEndpoint(connection),
      connection: { ...connection },
      client: null,
      state: CONNECTION_STATES.DISCONNECTED,
      devices: new Set(),
      policies: new Map(),
      queue: Promise.resolve(),
      pendingOperations: 0,
      reconnectAttempt: 0,
      reconnectTimer: null,
      manualClose: false,
      lastConnectedAt: null,
      lastErrorAt: null,
      lastError: null,
    };
  }

  enqueue(entry, operation) {
    entry.pendingOperations += 1;
    const run = entry.queue.then(operation, operation);
    entry.queue = run.catch(() => undefined);

    return run.finally(() => {
      entry.pendingOperations -= 1;
    });
  }

  async connectWithRetries(entry, policy) {
    let lastError;

    for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
      try {
        await this.enqueue(entry, () => this.ensureConnected(entry, policy));
        return;
      } catch (error) {
        lastError = toTransportError(error, 'connect');
        if (!lastError.retryable || attempt === policy.retries) {
          break;
        }

        this.logger.warn('Retrying Modbus connection', {
          connectionKey: entry.key,
          attempt: attempt + 1,
          maxRetries: policy.retries,
          code: lastError.code,
        });
        await delay(this.retryDelay(policy.retryDelayMs, attempt + 1));
      }
    }

    throw lastError;
  }

  async ensureConnected(entry, policy) {
    if (entry.state === CONNECTION_STATES.CONNECTED && entry.client?.isOpen) {
      return;
    }

    this.clearReconnectTimer(entry);
    await this.openEntry(entry, policy);
  }

  async openEntry(entry, policy) {
    entry.state = CONNECTION_STATES.CONNECTING;
    entry.manualClose = false;

    const client = this.clientFactory();
    entry.client = client;
    this.attachClientListeners(entry, client);

    try {
      client.setTimeout(policy.timeoutMs);
      await withTimeout(this.openTransport(client, entry.connection, policy.timeoutMs), policy.timeoutMs, 'Modbus connection timed out.');

      if (!client.isOpen) {
        throw new ModbusTransportError('Modbus transport did not enter an open state.', {
          code: 'MODBUS_CONNECTION_ERROR',
          retryable: true,
        });
      }

      entry.state = CONNECTION_STATES.CONNECTED;
      entry.reconnectAttempt = 0;
      entry.lastConnectedAt = new Date();
      entry.lastError = null;
      entry.lastErrorAt = null;

      this.logger.info('Modbus transport connected', {
        connectionKey: entry.key,
        endpoint: entry.endpoint,
        devices: [...entry.devices],
      });
      this.emit('connection:online', this.lifecyclePayload(entry));
    } catch (error) {
      const transportError = toTransportError(error, 'connect');
      await this.disposeClient(entry, client);
      entry.state = CONNECTION_STATES.DISCONNECTED;
      entry.lastError = transportError;
      entry.lastErrorAt = new Date();
      throw transportError;
    }
  }

  openTransport(client, connection, timeoutMs) {
    if (connection.protocol === MODBUS_PROTOCOLS.TCP) {
      return client.connectTCP(connection.host, {
        port: connection.port,
        timeout: timeoutMs,
      });
    }

    if (connection.protocol === MODBUS_PROTOCOLS.RTU) {
      return client.connectRTUBuffered(connection.serialPath, {
        baudRate: connection.baudRate,
        dataBits: connection.dataBits,
        stopBits: connection.stopBits,
        parity: connection.parity,
      });
    }

    throw new ModbusTransportError(`Unsupported Modbus protocol: ${connection.protocol}`, {
      code: 'MODBUS_CONNECTION_ERROR',
      retryable: false,
    });
  }

  attachClientListeners(entry, client) {
    const onError = (error) => this.handleClientError(entry, client, error);
    const onClose = () => this.handleClientClose(entry, client);

    client.on('error', onError);
    client.on('close', onClose);
    client.__emsConnectionListeners = { onError, onClose };
  }

  detachClientListeners(client) {
    const listeners = client?.__emsConnectionListeners;
    if (!listeners) {
      return;
    }

    client.removeListener('error', listeners.onError);
    client.removeListener('close', listeners.onClose);
    delete client.__emsConnectionListeners;
  }

  handleClientError(entry, client, error) {
    if (entry.client !== client || entry.manualClose || entry.state === CONNECTION_STATES.CONNECTING) {
      return;
    }

    this.logger.warn('Modbus transport emitted an error', {
      connectionKey: entry.key,
      endpoint: entry.endpoint,
      error: error?.stack || error?.message || String(error),
    });
    void this.invalidateEntry(entry, error, { scheduleReconnect: true, event: 'connection:error' });
  }

  handleClientClose(entry, client) {
    if (entry.client !== client || entry.manualClose) {
      return;
    }

    void this.invalidateEntry(entry, new Error('Modbus transport closed unexpectedly.'), {
      scheduleReconnect: true,
      event: 'connection:offline',
    });
  }

  async invalidateEntry(entry, error, options = {}) {
    const { scheduleReconnect = false, event = 'connection:offline' } = options;
    const currentClient = entry.client;

    if (entry.state !== CONNECTION_STATES.DISCONNECTED && entry.state !== CONNECTION_STATES.RECONNECTING) {
      entry.state = CONNECTION_STATES.DISCONNECTED;
      entry.lastError = toTransportError(error, 'transport');
      entry.lastErrorAt = new Date();
      this.emit(event, this.lifecyclePayload(entry, entry.lastError));
    }

    if (currentClient) {
      await this.disposeClient(entry, currentClient);
    }

    if (scheduleReconnect) {
      this.scheduleReconnect(entry);
    }
  }

  scheduleReconnect(entry) {
    if (this.shuttingDown || entry.manualClose || entry.devices.size === 0 || entry.reconnectTimer) {
      return;
    }

    const policy = this.getReconnectPolicy(entry);
    if (entry.reconnectAttempt >= policy.retries) {
      this.logger.warn('Modbus reconnect retry budget exhausted', {
        connectionKey: entry.key,
        retries: policy.retries,
      });
      return;
    }

    entry.reconnectAttempt += 1;
    entry.state = CONNECTION_STATES.RECONNECTING;
    const delayMs = this.retryDelay(policy.retryDelayMs, entry.reconnectAttempt);

    this.logger.info('Scheduling Modbus reconnect', {
      connectionKey: entry.key,
      attempt: entry.reconnectAttempt,
      delayMs,
    });

    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      void this.enqueue(entry, async () => {
        try {
          await this.openEntry(entry, policy);
        } catch (error) {
          entry.state = CONNECTION_STATES.DISCONNECTED;
          entry.lastError = toTransportError(error, 'reconnect');
          entry.lastErrorAt = new Date();
          this.emit('connection:error', this.lifecyclePayload(entry, entry.lastError));
          this.scheduleReconnect(entry);
        }
      });
    }, delayMs);
    entry.reconnectTimer.unref?.();
  }

  getReconnectPolicy(entry) {
    const policies = [...entry.policies.values()];
    if (policies.length === 0) {
      return {
        timeoutMs: config.modbus.defaultTimeoutMs,
        retries: config.modbus.defaultRetries,
        retryDelayMs: config.modbus.retryDelayMs,
      };
    }

    return {
      timeoutMs: Math.max(...policies.map((policy) => policy.timeoutMs)),
      retries: Math.max(...policies.map((policy) => policy.retries)),
      retryDelayMs: Math.min(...policies.map((policy) => policy.retryDelayMs)),
    };
  }

  retryDelay(baseDelayMs, attempt) {
    return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 60000);
  }

  clearReconnectTimer(entry) {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }

  async disposeClient(entry, client) {
    if (entry.client === client) {
      entry.client = null;
    }

    this.detachClientListeners(client);
    await closeClient(client);
  }

  async disposeEntry(entry) {
    entry.manualClose = true;
    this.clearReconnectTimer(entry);
    entry.state = CONNECTION_STATES.DISCONNECTED;
    await this.disposeClient(entry, entry.client);
  }

  cleanupIdleEntry(entry) {
    if (
      entry.pendingOperations > 0 ||
      entry.client ||
      entry.reconnectTimer ||
      entry.state !== CONNECTION_STATES.DISCONNECTED
    ) {
      return;
    }

    for (const deviceId of entry.devices) {
      if (this.deviceConnections.get(deviceId) === entry.key) {
        this.deviceConnections.delete(deviceId);
      }
    }
    entry.devices.clear();
    entry.policies.clear();
    this.connections.delete(entry.key);
  }

  describeEntry(entry, deviceId) {
    return {
      ...(deviceId ? { deviceId: String(deviceId) } : {}),
      connectionKey: entry.key,
      endpoint: entry.endpoint,
      state: entry.state,
      connected: entry.state === CONNECTION_STATES.CONNECTED && Boolean(entry.client?.isOpen),
      pooled: entry.devices.size > 1,
      attachedDeviceCount: entry.devices.size,
      pendingOperations: entry.pendingOperations,
      reconnectAttempt: entry.reconnectAttempt,
      lastConnectedAt: entry.lastConnectedAt,
      lastErrorAt: entry.lastErrorAt,
    };
  }

  lifecyclePayload(entry, error) {
    return {
      ...this.describeEntry(entry),
      deviceIds: [...entry.devices],
      error: error
        ? {
            code: error.code,
            message: error.message,
          }
        : undefined,
    };
  }
}

const modbusConnectionManager = new ModbusConnectionManager();

module.exports = {
  CONNECTION_STATES,
  ModbusConnectionManager,
  modbusConnectionManager,
};
