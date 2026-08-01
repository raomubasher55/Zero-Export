'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { SimulatorDevice } = require('../src/simulator/simulator-device');
const { simulatorDevices, getStatus, getValues } = require('../src/simulator');
const { simulatorDeviceUpdateSchema } = require('../src/validators/simulator.validator');
const { decodeRegister } = require('../src/modbus/register-decoder');
const { EM500_PROFILE } = require('../src/seed/em500.profile');
const { HUAWEI_SUN2000_PROFILE } = require('../src/seed/huawei-sun2000.profile');

function silentLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function fakeServerFactory() {
  const server = new EventEmitter();
  server.close = (callback) => {
    server.closed = true;
    callback?.();
  };
  return {
    server,
    factory: () => {
      setImmediate(() => server.emit('initialized'));
      return server;
    },
  };
}

function device({ profile, deviceType = 'EM500 meter', options = {}, configuration = {}, coupledInverterKw }) {
  const fake = fakeServerFactory();
  const instance = new SimulatorDevice({
    key: 'test',
    deviceType,
    profile,
    defaultConfiguration: { ...configuration, options },
    logger: silentLogger(),
    serverFactory: fake.factory,
    coupledInverterKw,
  });
  return { instance, fake };
}

const EM500_BY_KEY = new Map(
  EM500_PROFILE.registers.map((register) => [register.key, register]),
);
const HUAWEI_BY_KEY = new Map(
  HUAWEI_SUN2000_PROFILE.registers.map((register) => [register.key, register]),
);

test('EM500 simulator serves raw words that decode back with the EM500 profile', async () => {
  const { instance } = device({ profile: EM500_PROFILE });
  instance.configure({ port: 15020, unitId: 1, updateIntervalMs: 60000 });
  await instance.start();

  const vector = instance.createVector();
  const voltageWords = vector.getMultipleInputRegisters(0x0002, 2, 1);
  const voltage = decodeRegister(EM500_BY_KEY.get('l1_phase_voltage'), voltageWords);
  assert.ok(voltage.value > 225 && voltage.value < 245, `voltage in range, got ${voltage.value}`);

  const energyWords = vector.getMultipleInputRegisters(0x1b20, 4, 1);
  const energy = decodeRegister(EM500_BY_KEY.get('total_import_active_energy'), energyWords);
  assert.ok(energy.value > 12000, `energy counter plausible, got ${energy.value}`);

  assert.throws(
    () => vector.getInputRegister(0x0002, 2),
    (error) => error.modbusErrorCode === 0x02,
    'unexpected unit IDs still raise an exception',
  );
  // Gap/reserved addresses read as 0 instead of raising exception 02.
  assert.equal(vector.getHoldingRegister(0x0002, 1), 0, 'EM500 holding gap reads as 0');
  assert.equal(vector.getInputRegister(0xffff, 1), 0, 'unmapped address reads as 0');

  await instance.stop();

  // Disabling zero-fill restores the strict exception behavior.
  instance.configure({ options: { zeroFillGaps: false } });
  assert.throws(
    () => vector.getHoldingRegister(0x0002, 1),
    (error) => error.modbusErrorCode === 0x02,
  );
});

test('Huawei simulator serves holding registers and accepts derating writes', async () => {
  const { instance } = device({
    profile: HUAWEI_SUN2000_PROFILE,
    deviceType: 'Huawei SUN2000 inverter',
    configuration: { port: 15021, unitId: 2, updateIntervalMs: 60000 },
    options: { ratingKw: 100, availabilityPct: 80 },
  });
  await instance.start();

  const vector = instance.createVector();

  const powerWords = vector.getMultipleHoldingRegisters(32080, 2, 2);
  const power = decodeRegister(HUAWEI_BY_KEY.get('active_power'), powerWords);
  assert.ok(power.value > 40 && power.value < 85, `derated power in range, got ${power.value} kW`);

  // FC06 write to 40125: 500 -> 50%
  vector.setRegister(40125, 500, 2);
  assert.equal(instance.model.deratingRaw, 500);

  const deratingWords = vector.getMultipleHoldingRegisters(40125, 1, 2);
  const derating = decodeRegister(HUAWEI_BY_KEY.get('active_power_derating'), deratingWords);
  assert.equal(derating.value, 50, 'read-back shows 50%');

  // FC16 write to 40126 (INT32, 2 registers): 30000 W
  vector.setRegisterArray(40126, [0, 30000], 2);
  assert.equal(instance.model.fixedDeratingW, 30000);

  // The simulated inverter reacts on its next update cycle.
  instance.tick();
  const cappedPowerWords = vector.getMultipleHoldingRegisters(32080, 2, 2);
  const cappedPower = decodeRegister(HUAWEI_BY_KEY.get('active_power'), cappedPowerWords);
  // The simulator applies ±3% output jitter after the 30 kW cap.
  assert.ok(cappedPower.value <= 31, `fixed derating caps output, got ${cappedPower.value} kW`);

  // Full register map is served: identification strings, states, PV, meter.
  const modelName = vector.getMultipleHoldingRegisters(30000, 15, 2);
  const modelDecoded = decodeRegister(HUAWEI_BY_KEY.get('model_name'), modelName);
  assert.ok(String(modelDecoded.value).startsWith('SUN2000'), `model name served, got ${modelDecoded.value}`);

  const state1 = vector.getMultipleHoldingRegisters(32000, 1, 2);
  assert.ok(state1[0] & 4, 'State 1 normal bit set');

  const meterPower = vector.getMultipleHoldingRegisters(37113, 2, 2);
  const meterPowerDecoded = decodeRegister(HUAWEI_BY_KEY.get('meter_grid_active_power'), meterPower);
  assert.ok(Number.isFinite(meterPowerDecoded.value), 'meter grid power served');

  assert.throws(
    () => vector.getMultipleHoldingRegisters(32066, 16, 2),
    (error) => error.modbusErrorCode === 0x03,
    'reads above 15 registers must be rejected like the real SUN2000',
  );
  // A 15-word read of a fully defined block is allowed (model name).
  assert.doesNotThrow(
    () => vector.getMultipleHoldingRegisters(30000, 15, 2),
    'reads up to 15 registers are allowed',
  );

  assert.throws(
    () => vector.setRegister(32080, 1, 2),
    (error) => error.modbusErrorCode === 0x02,
    'writes to non-writable registers still raise an exception',
  );
  // Input registers do not exist on the Huawei device; gaps read as 0.
  assert.equal(vector.getInputRegister(32066, 2), 0, 'Huawei input gap reads as 0');

  await instance.stop();
});

test('simulator manager exposes both devices and their values', async () => {
  const status = getStatus();
  assert.deepEqual(Object.keys(status.devices).sort(), ['em500', 'huawei']);
  // Stopped devices serve no values until started and ticked.
  assert.equal(getValues('em500').length, 0);
  assert.equal(getValues('huawei').length, 0);
  assert.equal(getValues('unknown').length, 0);
  assert.equal(simulatorDevices.huawei.getStatus().port, 15021);
  assert.equal(simulatorDevices.huawei.getStatus().unitId, 2);
  assert.equal(simulatorDevices.em500.getStatus().port, 15020);
  assert.equal(simulatorDevices.em500.getStatus().unitId, 1);
  assert.equal(simulatorDevices.huawei.getStatus().deviceType, 'Huawei SUN2000 inverter');
});

test('EM500 simulator couples to the inverter when a site load is configured', async () => {
  let inverterKw = 70;
  const { instance } = device({
    profile: EM500_PROFILE,
    configuration: { updateIntervalMs: 60000 },
    options: { loadKw: 100 },
    coupledInverterKw: () => inverterKw,
  });

  // Inverter 70 kW, load 100 kW -> grid imports 30 kW.
  instance.tick();
  let grid = instance.values.get('eqv_active_power').value;
  assert.ok(Math.abs(grid - 30000) < 5, `grid import ~30 kW, got ${grid / 1000} kW`);
  const phase = instance.values.get('l1_active_power').value;
  assert.ok(Math.abs(phase - 10000) < 5, `per-phase ~10 kW, got ${phase / 1000} kW`);

  // Limit the inverter to 50 kW -> grid import rises to 50 kW (load constant).
  inverterKw = 50;
  instance.tick();
  grid = instance.values.get('eqv_active_power').value;
  assert.ok(Math.abs(grid - 50000) < 5, `grid import ~50 kW, got ${grid / 1000} kW`);

  // Inverter 120 kW > load 100 kW -> grid exports 20 kW (negative).
  inverterKw = 120;
  instance.tick();
  grid = instance.values.get('eqv_active_power').value;
  assert.ok(grid < -19000, `grid export ~20 kW, got ${grid / 1000} kW`);

  // Inverter stopped -> grid supplies the whole load.
  inverterKw = 0;
  instance.tick();
  grid = instance.values.get('eqv_active_power').value;
  assert.ok(Math.abs(grid - 100000) < 5, `grid supplies all, got ${grid / 1000} kW`);
});

test('EM500 simulator stays independent when no site load is configured', () => {
  const { instance } = device({
    profile: EM500_PROFILE,
    configuration: { updateIntervalMs: 60000 },
    options: {},
    coupledInverterKw: () => 70,
  });
  instance.tick();
  const grid = instance.values.get('eqv_active_power').value;
  assert.ok(grid > 5000 && grid < 60000, `independent grid power, got ${grid / 1000} kW`);
});

test('simulator lifecycle manages server and interval', async () => {
  const { instance, fake } = device({ profile: EM500_PROFILE, configuration: { updateIntervalMs: 60000 } });

  const started = await instance.start();
  assert.equal(started.state, 'RUNNING');
  assert.ok(instance.server === fake.server);
  assert.ok(instance.tickTimer);

  const again = await instance.start();
  assert.equal(again.state, 'RUNNING', 'starting twice is idempotent');

  const stopped = await instance.stop();
  assert.equal(stopped.state, 'STOPPED');
  assert.equal(instance.server, null);
  assert.equal(instance.tickTimer, null);
  assert.equal(fake.server.closed, true);
});

test('simulator configure refuses changes while running and merges patches', async () => {
  const { instance } = device({ profile: EM500_PROFILE, configuration: { updateIntervalMs: 60000 } });
  await instance.start();
  assert.throws(() => instance.configure({ port: 1 }), /Stop the simulator/);
  await instance.stop();

  instance.configure({ port: 15021 });
  assert.equal(instance.getStatus().port, 15021);
  instance.configure({ unitId: 3, options: { ratingKw: 50 } });
  assert.equal(instance.getStatus().unitId, 3);
  assert.equal(instance.getStatus().port, 15021, 'patch must merge, not replace');
  assert.equal(instance.getStatus().options.ratingKw, 50);
});

test('simulator device schema validates settings and options', () => {
  const parsed = simulatorDeviceUpdateSchema.parse({ port: 15021, options: { ratingKw: 100 } });
  assert.equal(parsed.port, 15021);
  assert.equal(parsed.options.ratingKw, 100);

  assert.throws(() => simulatorDeviceUpdateSchema.parse({ port: 70000 }), (error) => error.name === 'ZodError');
  assert.throws(() => simulatorDeviceUpdateSchema.parse({ unitId: 0 }), (error) => error.name === 'ZodError');
  assert.throws(() => simulatorDeviceUpdateSchema.parse({ options: { availabilityPct: 150 } }), (error) => error.name === 'ZodError');
  assert.throws(() => simulatorDeviceUpdateSchema.parse({}), (error) => error.name === 'ZodError');
  assert.throws(() => simulatorDeviceUpdateSchema.parse({ surprise: true }), (error) => error.name === 'ZodError');
});
