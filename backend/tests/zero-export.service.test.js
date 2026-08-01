'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ZeroExportService } = require('../src/services/zero-export.service');
const { zeroExportConfigurationSchema } = require('../src/validators/zero-export.validator');

const METER_ID = '507f1f77bcf86cd799439011';
const INVERTER_ID = '507f1f77bcf86cd799439022';
const PROFILE_ID = '507f1f77bcf86cd799439033';

function meterDevice() {
  return {
    _id: METER_ID,
    identifier: 'grid-meter',
    name: 'Grid meter',
    registerProfile: {
      _id: PROFILE_ID,
      identifier: 'em500',
      registers: [
        {
          key: 'eqv_active_power',
          name: 'Equivalent active power',
          registerType: 'INPUT_REGISTER',
          address: 0x003a,
          dataType: 'INT32',
          length: 2,
          scaleFactor: 0.01,
          offset: 0,
          unit: 'W',
          writable: false,
          enabled: true,
        },
      ],
    },
  };
}

function inverterDevice() {
  return {
    _id: INVERTER_ID,
    identifier: 'inverter',
    name: 'Inverter',
    registerProfile: {
      _id: PROFILE_ID,
      identifier: 'huawei-sun2000',
      registers: [
        {
          key: 'active_power',
          name: 'Active power',
          registerType: 'HOLDING_REGISTER',
          address: 32080,
          dataType: 'INT32',
          length: 2,
          scaleFactor: 0.001,
          offset: 0,
          unit: 'kW',
          writable: false,
          enabled: true,
        },
        {
          key: 'active_power_derating',
          name: 'Active power derating',
          registerType: 'HOLDING_REGISTER',
          address: 40201,
          dataType: 'UINT16',
          length: 1,
          scaleFactor: 0.1,
          offset: 0,
          unit: '%',
          writable: true,
          enabled: true,
        },
      ],
    },
  };
}

function configuration(overrides = {}) {
  return {
    enabled: true,
    meterDeviceId: METER_ID,
    meterRegisterKey: 'eqv_active_power',
    inverterDeviceId: INVERTER_ID,
    inverterRegisterKey: 'active_power_derating',
    inverterRegisterAddress: 40201,
    targetGridKw: 0,
    deadbandKw: 0.5,
    stepPerCycle: 20,
    minDerating: 0,
    maxDerating: 1000,
    intervalMs: 5000,
    failsafeDerating: 0,
    failsafeAfterMisses: 3,
    simulation: { enabled: false, loadKw: 100 },
    ...overrides,
  };
}

function serviceWith({ meterValue, inverterValue, writeHandler } = {}) {
  const writes = [];
  const service = new ZeroExportService({
    configurationRepository: {
      getOrDefault: async () => configuration(),
      save: async (value) => value,
      setEnabled: async (enabled) => configuration({ enabled }),
    },
    deviceRepository: {
      findById: async (id) =>
        String(id) === METER_ID ? meterDevice() : inverterDevice(),
      findByIdForPolling: async (id) =>
        String(id) === METER_ID ? meterDevice() : inverterDevice(),
    },
    latestValueRepository: {
      findByDeviceAndKey: async (deviceId, key) => {
        if (String(deviceId) === METER_ID) return meterValue || null;
        if (key === 'active_power') return inverterValue || null;
        return null;
      },
    },
    connectionManager: {
      execute: async (device, operation, operationFn) => {
        const client = {
          writeRegister: async (address, value) => {
            writes.push({ device: String(device._id), address, value });
            writeHandler?.({ address, value });
          },
        };
        await operationFn(client);
      },
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
  return { service, writes };
}

function latest(secondsAgo, value, unit = 'W') {
  return {
    value,
    unit,
    sampledAt: new Date(Date.now() - secondsAgo * 1000),
  };
}

test('zero-export raises derating when the grid imports above target', async () => {
  // Meter sees 30 kW import (30,000 W), target 0 -> raise derating 1000 -> 980? No:
  // initial derating is 1000 (max), so it must clamp and record CLAMPED.
  const { service, writes } = serviceWith({ meterValue: latest(1, 30000, 'W') });
  await service.tick();
  assert.equal(writes.length, 0, 'already at max derating, nothing to write');
  assert.equal(service.actions[0].outcome, 'CLAMPED');

  // Now force a lower starting derating and verify a write happens.
  service.deratingRaw = 500;
  await service.tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].address, 40201);
  assert.equal(writes[0].value, 520, 'one step of 20 derating units added');
  assert.equal(service.actions[0].outcome, 'WRITTEN');
  assert.equal(service.lastGridKw, 30);
});

test('zero-export lowers derating when the site exports to the grid', async () => {
  const { service, writes } = serviceWith({ meterValue: latest(1, -5000, 'W') });
  service.deratingRaw = 800;
  await service.tick();
  assert.equal(writes[0].value, 780, 'export -> derating decreased');
  assert.equal(service.actions[0].outcome, 'WRITTEN');
});

test('zero-export skips writes inside the deadband', async () => {
  const { service, writes } = serviceWith({ meterValue: latest(1, 200, 'W') });
  service.deratingRaw = 700;
  await service.tick();
  assert.equal(writes.length, 0);
  assert.equal(service.actions[0].outcome, 'IN_BAND');
});

test('zero-export simulation mode computes grid from load minus inverter output', async () => {
  const { service, writes } = serviceWith({
    inverterValue: latest(1, 70, 'kW'), // inverter producing 70 kW
  });
  service.configurationRepository.getOrDefault = async () =>
    configuration({ simulation: { enabled: true, loadKw: 100 } });

  service.deratingRaw = 500;
  await service.tick();
  // grid = 100 - 70 = 30 kW import -> raise derating
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value, 520);
  assert.equal(service.actions[0].source, 'SIMULATION');
  assert.equal(service.lastGridKw, 30);
});

test('zero-export writes failsafe derating after repeated stale readings', async () => {
  const { service, writes } = serviceWith({ meterValue: latest(600, 1000, 'W') });
  service.deratingRaw = 900;

  await service.tick();
  assert.equal(writes.length, 0, 'stale reading, no write yet');
  assert.equal(service.consecutiveMisses, 1);

  await service.tick();
  await service.tick();
  assert.equal(service.consecutiveMisses, 3);
  assert.equal(writes.length, 1, 'failsafe written after 3 misses');
  assert.equal(writes[0].value, 0);
  assert.equal(service.actions[0].outcome, 'FAILSAFE');
  assert.equal(service.deratingRaw, 0);
});

test('zero-export hydrate validates devices and derives the write address', async () => {
  const service = new ZeroExportService({
    deviceRepository: {
      findById: async (id) => (String(id) === METER_ID ? meterDevice() : inverterDevice()),
      findByIdForPolling: async (id) => (String(id) === METER_ID ? meterDevice() : inverterDevice()),
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  const hydrated = await service.hydrate(configuration());
  assert.equal(hydrated.inverterRegisterAddress, 40201);

  await assert.rejects(
    service.hydrate(configuration({ inverterRegisterKey: 'missing_key' })),
    (error) => error.statusCode === 422,
  );
  await assert.rejects(
    service.hydrate(configuration({ meterRegisterKey: 'missing_key' })),
    (error) => error.statusCode === 422,
  );
});

test('zero-export startControl requires a saved meter and inverter configuration', async () => {
  const service = new ZeroExportService({
    configurationRepository: {
      getOrDefault: async () => configuration({ meterDeviceId: null, inverterDeviceId: null }),
      save: async () => {
        throw new Error('save must not be reached without configured devices');
      },
      setEnabled: async () => configuration(),
    },
    deviceRepository: {},
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  await assert.rejects(
    service.startControl(),
    (error) =>
      error.statusCode === 422 &&
      error.details.some((detail) => detail.code === 'not_configured'),
  );
});

test('zero-export startControl persists and starts with configured devices', async () => {
  let savedPayload;
  let started = false;
  const service = new ZeroExportService({
    configurationRepository: {
      getOrDefault: async () => configuration(),
      save: async (value) => {
        savedPayload = value;
        return value;
      },
      setEnabled: async () => configuration(),
    },
    deviceRepository: {},
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  service.start = () => {
    started = true;
    return service.getStatus();
  };

  const result = await service.startControl();
  assert.equal(started, true);
  assert.equal(savedPayload.enabled, true);
  assert.equal(result.configuration.meterDeviceId, METER_ID);
});

test('zero-export configuration schema validates and cross-checks derating limits', () => {
  const parsed = zeroExportConfigurationSchema.parse(configuration());
  assert.equal(parsed.targetGridKw, 0);

  assert.throws(
    () => zeroExportConfigurationSchema.parse(configuration({ minDerating: 900, maxDerating: 100 })),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => zeroExportConfigurationSchema.parse(configuration({ stepPerCycle: 2000 })),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => zeroExportConfigurationSchema.parse(configuration({ meterDeviceId: 'nope' })),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => zeroExportConfigurationSchema.parse(configuration({ surprise: true })),
    (error) => error.name === 'ZodError',
  );
});
