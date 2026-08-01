'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const ModbusRTU = require('modbus-serial');
const { ModbusGatewayRuntime } = require('../src/gateway/modbus-gateway-runtime');
const { ModbusTrafficAnalyzer } = require('../src/gateway/modbus-traffic-analyzer');
const { SimulatorDevice } = require('../src/simulator/simulator-device');
const { HUAWEI_SUN2000_PROFILE } = require('../src/seed/huawei-sun2000.profile');
const { modbusConnectionManager } = require('../src/modbus/connection-manager');
const ModbusOperationService = require('../src/services/modbus-operation.service');
const GatewayWriteThroughService = require('../src/services/gateway-write-through.service');
const { decodeRegister } = require('../src/modbus/register-decoder');

const INVERTER_DEVICE_ID = '507f1f77bcf86cd799439022';
const PROFILE_ID = '507f1f77bcf86cd799439033';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

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

function profileRegisters() {
  return HUAWEI_SUN2000_PROFILE.registers.map((register) => ({ ...register }));
}

function inverterDevice(simulatorPort) {
  return {
    _id: INVERTER_DEVICE_ID,
    identifier: 'huawei-simulator',
    name: 'Huawei SUN2000 Simulator',
    isEnabled: true,
    unitId: 2,
    connection: { protocol: 'TCP', host: '127.0.0.1', port: simulatorPort },
    reconnect: { timeoutMs: 2000, retries: 1, retryDelayMs: 100 },
    registerProfile: {
      _id: PROFILE_ID,
      identifier: 'huawei-sun2000',
      registers: profileRegisters(),
    },
  };
}

function mappingFromRegister(register) {
  return {
    key: register.key,
    name: register.name,
    sourceDeviceId: INVERTER_DEVICE_ID,
    sourceRegisterKey: register.key,
    registerType: register.registerType,
    address: register.address,
    dataType: register.dataType,
    length: register.length,
    byteOrder: register.byteOrder,
    wordOrder: register.wordOrder,
    bitIndex: register.bitIndex ?? 0,
    scaleFactor: register.scaleFactor ?? 1,
    offset: register.offset ?? 0,
    unit: register.unit ?? null,
    writable: Boolean(register.writable),
    enabled: true,
  };
}

function definitions() {
  return new Map(HUAWEI_SUN2000_PROFILE.registers.map((register) => [register.key, register]));
}

test('master writes derating through the gateway and the simulated inverter follows', async () => {
  const simulatorPort = await availablePort();
  const gatewayPort = await availablePort();
  const device = inverterDevice(simulatorPort);
  const defs = definitions();

  // --- 1. real Huawei inverter simulator ---
  const simulator = new SimulatorDevice({
    key: 'huawei',
    deviceType: 'Huawei SUN2000 inverter',
    profile: HUAWEI_SUN2000_PROFILE,
    defaultConfiguration: {
      host: '127.0.0.1',
      port: simulatorPort,
      unitId: 2,
      updateIntervalMs: 60000,
      options: { ratingKw: 100, availabilityPct: 80 },
    },
    logger: silentLogger,
  });
  await simulator.start();

  // --- 2. real write path: gateway -> connection manager -> simulator ---
  const operationService = new ModbusOperationService({
    deviceRepository: { findById: async () => device },
    runtimeService: {
      markOnline: async () => undefined,
      markOnlineMany: async () => undefined,
      markOfflineMany: async () => undefined,
      markFailure: async () => undefined,
      markFailureMany: async () => undefined,
    },
    communicationLogRepository: { create: async () => undefined },
    logger: silentLogger,
  });
  const writeThroughService = new GatewayWriteThroughService({
    deviceRepository: { findByIdForPolling: async () => device },
    modbusOperationService: operationService,
  });

  // --- 3. gateway exposing the inverter registers (same addresses) ---
  const runtime = new ModbusGatewayRuntime({
    writeThroughService,
    trafficAnalyzer: new ModbusTrafficAnalyzer(),
    logger: silentLogger,
  });
  runtime.configure({
    enabled: true,
    unitId: 1,
    tcp: { enabled: true, host: '127.0.0.1', port: gatewayPort },
    rtu: {
      enabled: false,
      serialPath: '/dev/ttyUSB1',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    mappings: HUAWEI_SUN2000_PROFILE.registers.map(mappingFromRegister),
  });

  const publishAll = () =>
    runtime.publish(
      INVERTER_DEVICE_ID,
      simulator.getValues().map((value) => ({
        registerKey: value.registerKey,
        value: value.value,
        sampledAt: value.sampledAt,
      })),
    );

  const master = new ModbusRTU();
  try {
    await runtime.start();
    publishAll();

    await master.connectTCP('127.0.0.1', { port: gatewayPort });
    master.setID(1);

    // Master reads current output power and derating from the gateway.
    const powerBeforeWords = await master.readHoldingRegisters(32080, 2);
    const powerBeforeKw = decodeRegister(defs.get('active_power'), powerBeforeWords.data).value;
    const deratingBefore = await master.readHoldingRegisters(40125, 1);
    assert.deepEqual(deratingBefore.data, [1000], 'derating starts at 100%');

    // Master writes 500 (50%) to the derating register on the gateway.
    await master.writeRegister(40125, 500);
    assert.equal(
      simulator.model.deratingRaw,
      500,
      'write-through reached the simulated inverter',
    );

    // The inverter reacts on its next update cycle.
    simulator.tick();
    publishAll();

    const powerAfterWords = await master.readHoldingRegisters(32080, 2);
    const powerAfterKw = decodeRegister(defs.get('active_power'), powerAfterWords.data).value;
    assert.ok(
      powerAfterKw < powerBeforeKw * 0.7,
      `output dropped after 50% derating (${powerBeforeKw.toFixed(1)} kW -> ${powerAfterKw.toFixed(1)} kW)`,
    );

    // Read-back of the derating register on the gateway returns the written value.
    const deratingAfter = await master.readHoldingRegisters(40125, 1);
    assert.deepEqual(deratingAfter.data, [500]);

    // Master restores full output; the inverter follows back up.
    await master.writeRegister(40125, 1000);
    simulator.tick();
    publishAll();
    const powerRestoredWords = await master.readHoldingRegisters(32080, 2);
    const powerRestoredKw = decodeRegister(defs.get('active_power'), powerRestoredWords.data).value;
    assert.ok(powerRestoredKw > powerAfterKw * 1.3, `output restored (${powerRestoredKw.toFixed(1)} kW)`);
  } finally {
    await closeClient(master);
    await runtime.stop();
    await simulator.stop();
    operationService.dispose();
    await modbusConnectionManager.shutdown().catch(() => undefined);
  }
});
