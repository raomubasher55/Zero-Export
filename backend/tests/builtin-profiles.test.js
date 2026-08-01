'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_DATA_TYPES } = require('../src/constants/modbus');
const { createRegisterProfileBodySchema } = require('../src/validators/register-profile.validator');
const { EM500_PROFILE } = require('../src/seed/em500.profile');
const {
  BUILTIN_PROFILES,
  seedBuiltinProfiles,
} = require('../src/seed/builtin-profiles');
const RegisterProfileService = require('../src/services/register-profile.service');

const MEASUREMENT_SCALES = new Set([0.01, 0.0001, 0.001]);

test('built-in EM500 profile is valid and complete', () => {
  const parsed = createRegisterProfileBodySchema.parse(EM500_PROFILE);

  assert.equal(parsed.identifier, 'em500');
  assert.equal(parsed.manufacturer, 'Eastron');
  assert.equal(parsed.model, 'EM500');
  assert.equal(parsed.isActive, true);
  assert.equal(parsed.registers.length, 68);

  const keys = new Set(parsed.registers.map((register) => register.key));
  assert.equal(keys.size, 68, 'register keys must be unique');

  const addresses = new Set(
    parsed.registers.map((register) => `${register.registerType}:${register.address}`),
  );
  assert.equal(addresses.size, 68, 'register addresses must be unique');

  for (const register of parsed.registers) {
    assert.equal(register.registerType, 'INPUT_REGISTER', `${register.key} must be an input register`);
    assert.equal(register.writable, false, `${register.key} must be read-only`);
    assert.equal(register.enabled, true, `${register.key} must be enabled`);
    assert.equal(register.bitIndex, 0);
    assert.equal(register.offset, 0);
    assert.equal(register.length, register.dataType === REGISTER_DATA_TYPES.UINT64 ? 4 : 2);
    assert.ok(register.address + register.length <= 65536);
  }
});

test('EM500 measurement registers use 2-word signed/unsigned longs with manual scaling', () => {
  const measurements = EM500_PROFILE.registers.filter(
    (register) => register.group === 'Measurements',
  );
  assert.equal(measurements.length, 33);

  const twoWordTypes = new Set([
    REGISTER_DATA_TYPES.UINT32,
    REGISTER_DATA_TYPES.INT32,
  ]);
  for (const register of measurements) {
    assert.ok(twoWordTypes.has(register.dataType), `${register.key} must be a 32-bit long`);
    assert.equal(register.length, 2);
    assert.ok(MEASUREMENT_SCALES.has(register.scaleFactor), `${register.key} scale must match the manual`);
  }

  const byKey = new Map(measurements.map((register) => [register.key, register]));
  assert.equal(byKey.get('l1_phase_voltage').address, 0x0002);
  assert.equal(byKey.get('l1_phase_voltage').scaleFactor, 0.01);
  assert.equal(byKey.get('l1_phase_voltage').unit, 'V');
  assert.equal(byKey.get('l1_current').scaleFactor, 0.0001);
  assert.equal(byKey.get('l1_current').unit, 'A');
  assert.equal(byKey.get('l1_active_power').dataType, REGISTER_DATA_TYPES.INT32);
  assert.equal(byKey.get('l1_power_factor').scaleFactor, 0.0001);
  assert.equal(byKey.get('frequency').scaleFactor, 0.001);
  assert.equal(byKey.get('frequency').unit, 'Hz');
  assert.equal(byKey.get('neutral_current').address, 0x0048);
  assert.equal(byKey.get('current_asymmetry').address, 0x0046);
});

test('EM500 energy registers are 4-word UINT64 counters scaled by 0.01', () => {
  const energy = EM500_PROFILE.registers.filter(
    (register) => register.group === 'Energy',
  );
  assert.equal(energy.length, 35);

  for (const register of energy) {
    assert.equal(register.dataType, REGISTER_DATA_TYPES.UINT64);
    assert.equal(register.length, 4);
    assert.equal(register.scaleFactor, 0.01);
  }

  const byKey = new Map(energy.map((register) => [register.key, register]));
  assert.equal(byKey.get('total_import_active_energy').address, 0x1b20);
  assert.equal(byKey.get('total_import_active_energy').unit, 'kWh');
  assert.equal(byKey.get('total_export_reactive_energy').unit, 'kvarh');
  assert.equal(byKey.get('total_apparent_energy').unit, 'kVAh');
  assert.equal(byKey.get('l3_partial_apparent_energy').address, 0x1e94);
  assert.equal(byKey.get('l3_apparent_energy_tariff_2').address, 0x1c0c);
});

test('built-in profile seed creates missing profiles and never overwrites existing ones', async () => {
  const created = [];
  const repository = {
    findByIdentifier: async () => null,
    create: async (payload) => {
      created.push(payload);
      return payload;
    },
  };

  const results = await seedBuiltinProfiles(repository);
  assert.equal(results.length, BUILTIN_PROFILES.length);
  assert.ok(results.every((result) => result.action === 'CREATED'));
  assert.ok(created.every((profile) => profile.builtIn === true));
  assert.deepEqual(
    created.map((profile) => profile.identifier),
    BUILTIN_PROFILES.map((profile) => profile.identifier),
  );
});

test('built-in profile seed skips identifiers that already exist', async () => {
  const repository = {
    findByIdentifier: async () => ({ identifier: 'em500' }),
    create: async () => {
      throw new Error('create must not be called for existing profiles');
    },
  };

  const results = await seedBuiltinProfiles(repository);
  assert.deepEqual(results, [{ identifier: 'em500', action: 'SKIPPED' }]);
});

test('RegisterProfileService.restoreBuiltIns recreates deleted built-in profiles', async () => {
  const created = [];
  const service = new RegisterProfileService({
    registerProfileRepository: {
      findByIdentifier: async () => null,
      create: async (payload) => {
        created.push(payload);
        return payload;
      },
    },
    deviceRepository: {},
  });

  const result = await service.restoreBuiltIns();
  assert.deepEqual(result.restored, ['em500']);
  assert.deepEqual(result.alreadyPresent, []);
  assert.equal(result.total, 1);
  assert.ok(created.every((profile) => profile.builtIn === true));
});

test('RegisterProfileService.restoreBuiltIns reports profiles that already exist', async () => {
  const service = new RegisterProfileService({
    registerProfileRepository: {
      findByIdentifier: async () => ({ identifier: 'em500' }),
      create: async () => {
        throw new Error('create must not be called');
      },
    },
    deviceRepository: {},
  });

  const result = await service.restoreBuiltIns();
  assert.deepEqual(result.restored, []);
  assert.deepEqual(result.alreadyPresent, ['em500']);
  assert.equal(result.total, 1);
});
