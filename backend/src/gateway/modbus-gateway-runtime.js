'use strict';

const ModbusRTU = require('modbus-serial');
const logger = require('../config/logger');
const { REGISTER_TYPES } = require('../constants/modbus');
const { decodeRegister } = require('../modbus/register-decoder');
const { encodeRegister } = require('../modbus/register-encoder');
const { modbusTrafficAnalyzer } = require('./modbus-traffic-analyzer');
const {
  attachRtuTrafficObserver,
  attachTcpTrafficObserver,
} = require('./modbus-traffic-observers');
const GatewayWriteThroughService = require('../services/gateway-write-through.service');

const GATEWAY_STATES = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
});

function modbusError(message, modbusErrorCode = 0x04) {
  const error = new Error(message);
  error.modbusErrorCode = modbusErrorCode;
  return error;
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function waitForServer(server, errorEvent, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Timed out while starting Modbus gateway endpoint.')), timeoutMs);
    timeout.unref?.();

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.removeListener('initialized', onInitialized);
      server.removeListener(errorEvent, onError);
      if (error) reject(error);
      else resolve();
    };
    const onInitialized = () => finish();
    const onError = (error) => finish(error);

    server.once('initialized', onInitialized);
    server.once(errorEvent, onError);
  });
}

class ModbusGatewayRuntime {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.serverFactory = options.serverFactory || {
      tcp: (vector, endpoint, unitId) =>
        new ModbusRTU.ServerTCP(vector, {
          host: endpoint.host,
          port: endpoint.port,
          unitID: unitId,
        }),
      rtu: (vector, endpoint, unitId) => {
        if (!ModbusRTU.ServerSerial) {
          throw new Error('Modbus RTU server support is unavailable. Install the serialport dependency.');
        }
        return new ModbusRTU.ServerSerial(
          vector,
          {
            path: endpoint.serialPath,
            baudRate: endpoint.baudRate,
            parity: endpoint.parity,
            unitID: unitId,
          },
          {
            dataBits: endpoint.dataBits,
            stopBits: endpoint.stopBits,
          },
        );
      },
    };
    this.writeThroughService = options.writeThroughService || new GatewayWriteThroughService();
    this.trafficAnalyzer = options.trafficAnalyzer || modbusTrafficAnalyzer;
    this.configuration = null;
    this.tcpServer = null;
    this.rtuServer = null;
    this.tcpTrafficCleanup = null;
    this.rtuTrafficCleanup = null;
    this.mappingsByAddress = new Map();
    this.mappingsBySource = new Map();
    this.memory = new Map();
    this.mappingStats = new Map();
    this.writeQueue = Promise.resolve();
    this.state = GATEWAY_STATES.STOPPED;
    this.startedAt = null;
    this.lastRequestAt = null;
    this.lastError = null;
    this.endpointStates = {
      tcp: GATEWAY_STATES.STOPPED,
      rtu: GATEWAY_STATES.STOPPED,
    };
  }

  configure(configuration, initialValues = []) {
    if (this.state === GATEWAY_STATES.RUNNING || this.state === GATEWAY_STATES.STARTING) {
      throw new Error('Stop the gateway before changing its runtime configuration.');
    }

    this.configuration = configuration;
    this.mappingsByAddress.clear();
    this.mappingsBySource.clear();
    this.memory.clear();
    this.mappingStats.clear();

    for (const mapping of configuration.mappings.filter((item) => item.enabled)) {
      for (let offset = 0; offset < mapping.length; offset += 1) {
        this.mappingsByAddress.set(
          this.addressKey(mapping.registerType, mapping.address + offset),
          mapping,
        );
        this.memory.set(
          this.addressKey(mapping.registerType, mapping.address + offset),
          [REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(mapping.registerType)
            ? false
            : 0,
        );
      }

      const sourceKey = this.sourceKey(mapping.sourceDeviceId, mapping.sourceRegisterKey);
      const sourceMappings = this.mappingsBySource.get(sourceKey) || [];
      sourceMappings.push(mapping);
      this.mappingsBySource.set(sourceKey, sourceMappings);
      this.mappingStats.set(mapping.key, {
        updatedAt: null,
        lastWriteAt: null,
        lastError: null,
      });
    }

    this.trafficAnalyzer.setMappingResolver((registerType, address, quantity) =>
      this.resolveMappings(registerType, address, quantity),
    );

    for (const value of initialValues) {
      this.publish(value.device, [value]);
    }
  }

  async start() {
    if (this.state === GATEWAY_STATES.RUNNING) return this.getStatus();
    if (!this.configuration) throw new Error('Gateway runtime has not been configured.');
    if (this.mappingsByAddress.size === 0) {
      throw new Error('At least one enabled forwarding mapping is required.');
    }
    if (!this.configuration.tcp.enabled && !this.configuration.rtu.enabled) {
      throw new Error('Enable at least one TCP or RTU gateway endpoint.');
    }

    this.state = GATEWAY_STATES.STARTING;
    this.lastError = null;
    const vector = this.createVector();

    try {
      if (this.configuration.tcp.enabled) {
        this.endpointStates.tcp = GATEWAY_STATES.STARTING;
        this.tcpServer = this.serverFactory.tcp(
          vector,
          this.configuration.tcp,
          this.configuration.unitId,
        );
        this.attachServerListeners(this.tcpServer, 'tcp');
        this.tcpTrafficCleanup = attachTcpTrafficObserver(
          this.tcpServer,
          this.trafficAnalyzer,
        );
        await waitForServer(this.tcpServer, 'serverError');
        this.endpointStates.tcp = GATEWAY_STATES.RUNNING;
      }

      if (this.configuration.rtu.enabled) {
        this.endpointStates.rtu = GATEWAY_STATES.STARTING;
        this.rtuServer = this.serverFactory.rtu(
          vector,
          this.configuration.rtu,
          this.configuration.unitId,
        );
        this.attachServerListeners(this.rtuServer, 'rtu');
        this.rtuTrafficCleanup = attachRtuTrafficObserver(
          this.rtuServer,
          this.trafficAnalyzer,
          this.configuration.rtu,
        );
        await waitForServer(this.rtuServer, 'error');
        this.endpointStates.rtu = GATEWAY_STATES.RUNNING;
      }

      this.state = GATEWAY_STATES.RUNNING;
      this.startedAt = new Date();
      this.logger.info('Modbus forwarding gateway started', {
        unitId: this.configuration.unitId,
        tcp: this.configuration.tcp.enabled ? this.configuration.tcp : undefined,
        rtu: this.configuration.rtu.enabled
          ? { ...this.configuration.rtu, serialPath: this.configuration.rtu.serialPath }
          : undefined,
        mappingCount: this.mappingStats.size,
      });
      return this.getStatus();
    } catch (error) {
      await this.stop();
      this.state = GATEWAY_STATES.ERROR;
      this.lastError = { message: error.message, occurredAt: new Date() };
      throw error;
    }
  }

  async stop() {
    const tcpServer = this.tcpServer;
    const rtuServer = this.rtuServer;
    this.tcpServer = null;
    this.rtuServer = null;
    this.tcpTrafficCleanup?.();
    this.rtuTrafficCleanup?.();
    this.tcpTrafficCleanup = null;
    this.rtuTrafficCleanup = null;
    await Promise.all([closeServer(tcpServer), closeServer(rtuServer)]);
    this.endpointStates.tcp = GATEWAY_STATES.STOPPED;
    this.endpointStates.rtu = GATEWAY_STATES.STOPPED;
    this.state = GATEWAY_STATES.STOPPED;
    this.startedAt = null;
    return this.getStatus();
  }

  publish(deviceId, values) {
    for (const value of values) {
      const mappings = this.mappingsBySource.get(this.sourceKey(deviceId, value.registerKey)) || [];
      for (const mapping of mappings) {
        try {
          const encoded = encodeRegister(mapping, value.value);
          encoded.rawValues.forEach((rawValue, offset) => {
            this.memory.set(
              this.addressKey(mapping.registerType, mapping.address + offset),
              rawValue,
            );
          });
          const stats = this.mappingStats.get(mapping.key);
          if (stats) {
            stats.updatedAt = value.sampledAt || new Date();
            stats.lastError = null;
          }
        } catch (error) {
          this.recordMappingError(mapping, error);
        }
      }
    }
  }

  createVector() {
    return {
      getCoil: (address, unitId) => this.read(REGISTER_TYPES.COIL, address, unitId),
      getDiscreteInput: (address, unitId) =>
        this.read(REGISTER_TYPES.DISCRETE_INPUT, address, unitId),
      getHoldingRegister: (address, unitId) =>
        this.read(REGISTER_TYPES.HOLDING, address, unitId),
      getInputRegister: (address, unitId) =>
        this.read(REGISTER_TYPES.INPUT, address, unitId),
      getMultipleHoldingRegisters: (address, length, unitId) =>
        this.readMany(REGISTER_TYPES.HOLDING, address, length, unitId),
      getMultipleInputRegisters: (address, length, unitId) =>
        this.readMany(REGISTER_TYPES.INPUT, address, length, unitId),
      setCoil: (address, value, unitId) =>
        this.enqueueWrite(() => this.writeCoil(address, value, unitId)),
      setRegister: (address, value, unitId) =>
        this.enqueueWrite(() => this.writeRegisters(address, [value], unitId)),
      setRegisterArray: (address, values, unitId) =>
        this.enqueueWrite(() => this.writeRegisters(address, values, unitId)),
      readDeviceIdentification: () => ({
        0x00: 'Zero Export',
        0x01: 'ORANGE_PI_MODBUS_GATEWAY',
        0x02: '1.0',
        0x04: 'Zero Export Modbus Forwarding Gateway',
      }),
    };
  }

  read(registerType, address, unitId) {
    this.assertUnitId(unitId);
    this.lastRequestAt = new Date();
    const key = this.addressKey(registerType, address);
    const mapping = this.mappingsByAddress.get(key);
    if (!mapping) {
      throw modbusError(`Address ${address} is not mapped in ${registerType}.`, 0x02);
    }
    const status = this.mappingStats.get(mapping.key);
    if (!status?.updatedAt && !status?.lastWriteAt) {
      throw modbusError(`Mapping ${mapping.key} has not received a source value yet.`, 0x04);
    }
    return this.memory.get(key);
  }

  readMany(registerType, address, length, unitId) {
    return Array.from({ length }, (_, offset) => this.read(registerType, address + offset, unitId));
  }

  async writeCoil(address, value, unitId) {
    this.assertUnitId(unitId);
    this.lastRequestAt = new Date();
    const mapping = this.getWritableMapping(REGISTER_TYPES.COIL, address);
    await this.writeThrough(mapping, [Boolean(value)]);
    this.memory.set(this.addressKey(REGISTER_TYPES.COIL, address), Boolean(value));
  }

  async writeRegisters(address, values, unitId) {
    this.assertUnitId(unitId);
    this.lastRequestAt = new Date();
    const candidates = new Map();

    values.forEach((value, offset) => {
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw modbusError('Holding-register writes require unsigned 16-bit values.', 0x03);
      }
      const currentAddress = address + offset;
      const mapping = this.getWritableMapping(REGISTER_TYPES.HOLDING, currentAddress);
      if (!candidates.has(mapping.key)) {
        candidates.set(mapping.key, {
          mapping,
          rawValues: Array.from({ length: mapping.length }, (_, mappingOffset) =>
            this.memory.get(
              this.addressKey(REGISTER_TYPES.HOLDING, mapping.address + mappingOffset),
            )),
        });
      }
      candidates.get(mapping.key).rawValues[currentAddress - mapping.address] = value;
    });

    for (const candidate of candidates.values()) {
      await this.writeThrough(candidate.mapping, candidate.rawValues);
    }
    for (const candidate of candidates.values()) {
      candidate.rawValues.forEach((value, offset) => {
        this.memory.set(
          this.addressKey(REGISTER_TYPES.HOLDING, candidate.mapping.address + offset),
          value,
        );
      });
    }
  }

  async writeThrough(mapping, rawValues) {
    try {
      const decoded = decodeRegister(mapping, rawValues);
      await this.writeThroughService.write(mapping, decoded.value);
      const stats = this.mappingStats.get(mapping.key);
      if (stats) {
        stats.lastWriteAt = new Date();
        stats.lastError = null;
      }
    } catch (error) {
      this.recordMappingError(mapping, error);
      throw modbusError(error.message || 'Upstream write-through failed.', error.modbusErrorCode || 0x04);
    }
  }

  getWritableMapping(registerType, address) {
    const mapping = this.mappingsByAddress.get(this.addressKey(registerType, address));
    if (!mapping) {
      throw modbusError(`Address ${address} is not mapped in ${registerType}.`, 0x02);
    }
    if (!mapping.writable) {
      throw modbusError(`Mapping ${mapping.key} is read-only.`, 0x02);
    }
    return mapping;
  }

  enqueueWrite(operation) {
    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.catch(() => undefined);
    return queued;
  }

  assertUnitId(unitId) {
    if (unitId !== this.configuration.unitId) {
      throw modbusError(`Gateway does not serve unit ${unitId}.`, 0x0b);
    }
  }

  attachServerListeners(server, endpoint) {
    server.on('socketError', (error) => this.recordRuntimeError(endpoint, error));
    server.on('serverError', (error) => this.recordRuntimeError(endpoint, error));
    server.on('error', (error) => this.recordRuntimeError(endpoint, error));
  }

  recordRuntimeError(endpoint, error) {
    this.lastError = { message: error.message || String(error), occurredAt: new Date() };
    this.logger.warn('Modbus gateway endpoint reported an error', {
      endpoint,
      error: error.stack || error.message,
    });
  }

  recordMappingError(mapping, error) {
    const details = { message: error.message || String(error), occurredAt: new Date() };
    const stats = this.mappingStats.get(mapping.key);
    if (stats) stats.lastError = details;
    this.lastError = details;
    this.logger.warn('Modbus gateway mapping operation failed', {
      mappingKey: mapping.key,
      error: error.stack || error.message,
    });
  }

  resolveMappings(registerType, address, quantity = 1) {
    const requestedAddresses = Array.from(
      { length: Math.max(1, quantity) },
      (_, offset) => address + offset,
    );
    const matches = new Map();

    for (const requestedAddress of requestedAddresses) {
      const mapping = this.mappingsByAddress.get(
        this.addressKey(registerType, requestedAddress),
      );
      if (!mapping) continue;
      const match = matches.get(mapping.key) || { mapping, coveredAddresses: [] };
      match.coveredAddresses.push(requestedAddress);
      matches.set(mapping.key, match);
    }

    return [...matches.values()].map(({ mapping, coveredAddresses }) => {
      const order =
        mapping.byteOrder === 'LITTLE_ENDIAN'
          ? mapping.wordOrder === 'LITTLE_ENDIAN'
            ? 'DCBA'
            : 'BADC'
          : mapping.wordOrder === 'LITTLE_ENDIAN'
            ? 'CDAB'
            : 'ABCD';
      return {
        key: mapping.key,
        name: mapping.name,
        sourceDeviceId: String(mapping.sourceDeviceId),
        sourceRegisterKey: mapping.sourceRegisterKey,
        registerType: mapping.registerType,
        address: mapping.address,
        endAddress: mapping.address + mapping.length - 1,
        dataType: mapping.dataType,
        length: mapping.length,
        order,
        scaleFactor: mapping.scaleFactor,
        offset: mapping.offset,
        unit: mapping.unit || null,
        writable: mapping.writable,
        coveredAddresses,
        fullyCoversRequest: coveredAddresses.length === requestedAddresses.length,
      };
    });
  }

  getStatus() {
    return {
      state: this.state,
      running: this.state === GATEWAY_STATES.RUNNING,
      startedAt: this.startedAt,
      lastRequestAt: this.lastRequestAt,
      lastError: this.lastError,
      endpoints: { ...this.endpointStates },
      mappedAddressCount: this.mappingsByAddress.size,
      mappingCount: this.mappingStats.size,
      mappings: [...this.mappingStats.entries()].map(([key, status]) => ({ key, ...status })),
      trafficCapture: this.trafficAnalyzer.getSettings(),
    };
  }

  addressKey(registerType, address) {
    return `${registerType}:${address}`;
  }

  sourceKey(deviceId, registerKey) {
    return `${String(deviceId)}:${registerKey}`;
  }
}

const modbusGatewayRuntime = new ModbusGatewayRuntime();

module.exports = {
  GATEWAY_STATES,
  ModbusGatewayRuntime,
  modbusError,
  modbusGatewayRuntime,
};
