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

function device({ profile, deviceType = 'EM500 meter', options = {}, configuration = {} }) {
  const fake = fakeServerFactory();
  const instance = new SimulatorDevice({
    key: 'test',
    deviceType,
    profile,
    defaultConfiguration: { ...configuration, options },
    logger: silentLogger(),
    serverFactory: fake.factory,
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
  );
  assert.throws(
    () => vector.getHoldingRegister(0x0002, 1),
    (error) => error.modbusErrorCode === 0x02,
  );

  await instance.stop();
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
  assert.ok(cappedPower.value <= 30.5, `fixed derating caps output, got ${cappedPower.value} kW`);

  assert.throws(
    () => vector.setRegister(32080, 1, 2),
    (error) => error.modbusErrorCode === 0x02,
  );
  assert.throws(
    () => vector.getInputRegister(32066, 2),
    (error) => error.modbusErrorCode === 0x02,
  );

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
