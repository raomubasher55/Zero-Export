'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { MeterSimulator } = require('../src/simulator/meter-simulator');
const { simulatorConfigurationSchema } = require('../src/validators/simulator.validator');
const { decodeRegister } = require('../src/modbus/register-decoder');
const { EM500_PROFILE } = require('../src/seed/em500.profile');

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

function simulator(options = {}) {
  const fake = fakeServerFactory();
  const instance = new MeterSimulator({
    logger: silentLogger(),
    serverFactory: fake.factory,
    ...options,
  });
  return { instance, fake };
}

const REGISTER_BY_KEY = new Map(
  EM500_PROFILE.registers.map((register) => [register.key, register]),
);

test('simulator serves raw words that decode back with the EM500 profile', async () => {
  const { instance } = simulator();
  instance.configure({ port: 15020, unitId: 1, updateIntervalMs: 60000 });
  await instance.start();

  const vector = instance.createVector();

  const voltageWords = vector.getMultipleInputRegisters(0x0002, 2, 1);
  assert.equal(voltageWords.length, 2);
  const voltage = decodeRegister(REGISTER_BY_KEY.get('l1_phase_voltage'), voltageWords);
  assert.ok(voltage.value > 225 && voltage.value < 245, `voltage in range, got ${voltage.value}`);

  const powerWords = vector.getMultipleInputRegisters(0x0014, 2, 1);
  const power = decodeRegister(REGISTER_BY_KEY.get('l1_active_power'), powerWords);
  assert.ok(power.value > 5000 && power.value < 25000, `power in range, got ${power.value}`);

  const energyWords = vector.getMultipleInputRegisters(0x1b20, 4, 1);
  assert.equal(energyWords.length, 4);
  const energy = decodeRegister(REGISTER_BY_KEY.get('total_import_active_energy'), energyWords);
  assert.ok(energy.value > 12000, `energy counter plausible, got ${energy.value}`);
  assert.equal(energy.value, instance.values.get('total_import_active_energy').value);

  await instance.stop();
});

test('simulator tick advances energy counters and refreshes measurements', async () => {
  const { instance } = simulator();
  instance.configure({ updateIntervalMs: 1000 });

  const before = instance.values.get('total_import_active_energy')?.value;
  instance.tick();
  const after = instance.values.get('total_import_active_energy').value;
  assert.ok(after > (before ?? 0), 'energy must increase over ticks');

  const voltageA = instance.values.get('l1_phase_voltage').value;
  instance.tick();
  const voltageB = instance.values.get('l1_phase_voltage').value;
  assert.ok(
    Math.abs(voltageA - voltageB) < 2,
    'voltages drift slowly between ticks',
  );

  assert.equal(instance.getValues().length, EM500_PROFILE.registers.length);
});

test('simulator rejects unexpected unit IDs and unmapped addresses', async () => {
  const { instance } = simulator();
  instance.configure({ unitId: 1 });

  const vector = instance.createVector();
  assert.throws(
    () => vector.getInputRegister(0x0002, 2),
    (error) => error.modbusErrorCode === 0x02,
  );
  assert.throws(
    () => vector.getInputRegister(0xffff, 1),
    (error) => error.modbusErrorCode === 0x02,
  );
  assert.throws(
    () => vector.getHoldingRegister(0x0002, 1),
    (error) => error.modbusErrorCode === 0x02,
  );
});

test('simulator start/stop lifecycle manages its server and interval', async () => {
  const { instance, fake } = simulator();
  instance.configure({ port: 15020, updateIntervalMs: 60000 });

  const statusBefore = instance.getStatus();
  assert.equal(statusBefore.state, 'STOPPED');

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
  const { instance } = simulator();
  instance.configure({ updateIntervalMs: 60000 });
  await instance.start();

  assert.throws(() => instance.configure({ port: 1 }), /Stop the simulator/);
  await instance.stop();

  instance.configure({ port: 15021 });
  assert.equal(instance.getStatus().port, 15021);
  instance.configure({ unitId: 3 });
  assert.equal(instance.getStatus().unitId, 3);
  assert.equal(instance.getStatus().port, 15021, 'patch must merge, not replace');
});

test('simulator configuration schema validates settings', () => {
  const parsed = simulatorConfigurationSchema.parse({ port: 15020 });
  assert.equal(parsed.port, 15020);

  assert.throws(
    () => simulatorConfigurationSchema.parse({ port: 70000 }),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => simulatorConfigurationSchema.parse({ unitId: 0 }),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => simulatorConfigurationSchema.parse({ updateIntervalMs: 10 }),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => simulatorConfigurationSchema.parse({}),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => simulatorConfigurationSchema.parse({ surprise: true }),
    (error) => error.name === 'ZodError',
  );
});
