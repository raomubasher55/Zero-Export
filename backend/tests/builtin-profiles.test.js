'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_DATA_TYPES } = require('../src/constants/modbus');
const { createRegisterProfileBodySchema } = require('../src/validators/register-profile.validator');
const { EM500_PROFILE } = require('../src/seed/em500.profile');
const { HUAWEI_SUN2000_PROFILE } = require('../src/seed/huawei-sun2000.profile');
const {
  BUILTIN_PROFILES,
  seedBuiltinProfiles,
} = require('../src/seed/builtin-profiles');
const RegisterProfileService = require('../src/services/register-profile.service');

const MEASUREMENT_SCALES = new Set([0.01, 0.0001, 0.001]);
const CURRENT_PROFILE_VERSION = EM500_PROFILE.metadata.profileVersion;

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
    assert.equal(register.bitIndex, 0);
    assert.equal(register.offset, 0);
    assert.equal(register.length, register.dataType === REGISTER_DATA_TYPES.UINT64 ? 4 : 2);
    assert.ok(register.address + register.length <= 65536);
  }
});

test('EM500 profile polls only the real-time area by default (energy counters disabled)', () => {
  const measurements = EM500_PROFILE.registers.filter(
    (register) => register.group === 'Measurements',
  );
  const energy = EM500_PROFILE.registers.filter(
    (register) => register.group === 'Energy',
  );

  assert.equal(measurements.length, 33);
  assert.equal(energy.length, 35);
  assert.ok(
    measurements.every((register) => register.enabled === true),
    'all real-time registers must be enabled',
  );
  assert.ok(
    energy.every((register) => register.enabled === false),
    'energy counters must ship disabled so polls stay within the real-time area',
  );

  const maxEnabled = Math.max(
    ...EM500_PROFILE.registers
      .filter((register) => register.enabled)
      .map((register) => register.address + register.length),
  );
  assert.ok(maxEnabled <= 0x0048 + 2, 'enabled registers must stay in the 0x0000-0x0048 real-time area');
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
    assert.equal(register.enabled, false, 'energy counters must be disabled by default');
  }

  const byKey = new Map(energy.map((register) => [register.key, register]));
  assert.equal(byKey.get('total_import_active_energy').address, 0x1b20);
  assert.equal(byKey.get('total_import_active_energy').unit, 'kWh');
  assert.equal(byKey.get('total_export_reactive_energy').unit, 'kvarh');
  assert.equal(byKey.get('total_apparent_energy').unit, 'kVAh');
  assert.equal(byKey.get('l3_partial_apparent_energy').address, 0x1e94);
  assert.equal(byKey.get('l3_apparent_energy_tariff_2').address, 0x1c0c);
});

test('built-in Huawei profile covers the full V3.0 map with a 15-register read limit', () => {
  const parsed = createRegisterProfileBodySchema.parse(HUAWEI_SUN2000_PROFILE);

  assert.equal(parsed.identifier, 'huawei-sun2000');
  assert.equal(parsed.maxReadQuantity, 15);
  assert.equal(parsed.registers.length, 69);

  const keys = new Set(parsed.registers.map((register) => register.key));
  assert.equal(keys.size, 69, 'register keys must be unique');

  const byKey = new Map(parsed.registers.map((register) => [register.key, register]));

  assert.equal(byKey.get('model_name').dataType, 'STRING');
  assert.equal(byKey.get('model_name').length, 15);
  assert.equal(byKey.get('serial_number').length, 10);
  assert.equal(byKey.get('pn_code').length, 10);
  assert.equal(byKey.get('active_power_derating').address, 40201);
  assert.equal(byKey.get('active_power_derating').writable, true);
  assert.equal(byKey.get('active_power_derating').scaleFactor, 0.1);
  assert.equal(byKey.get('active_power_fixed_limit').address, 40206);
  assert.equal(byKey.get('active_power_fixed_limit').writable, true);
  assert.equal(byKey.get('remote_power_control_enable').address, 40200);
  assert.equal(byKey.get('zero_export_mode').address, 40212);
  assert.equal(byKey.get('max_grid_feed_in_power').address, 40213);
  assert.equal(byKey.get('meter_grid_active_power').address, 37113);
  assert.equal(byKey.get('battery_soc').address, 37004);
  assert.equal(byKey.get('total_yield').address, 32106);

  for (const register of parsed.registers) {
    assert.equal(register.registerType, 'HOLDING_REGISTER');
    assert.ok(register.address + register.length <= 65536);
    if (register.dataType !== 'STRING') {
      assert.ok(register.length <= 15, 'every word register must fit one 15-word batch');
    }
  }
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

test('built-in profile seed skips identifiers that already exist at the current version', async () => {
  const repository = {
    findByIdentifier: async (identifier) => ({
      identifier,
      builtIn: true,
      metadata: { profileVersion: CURRENT_PROFILE_VERSION },
    }),
    create: async () => {
      throw new Error('create must not be called for existing profiles');
    },
    updateById: async () => {
      throw new Error('update must not be called for current profiles');
    },
  };

  const results = await seedBuiltinProfiles(repository);
  assert.deepEqual(
    results.map((result) => result.action),
    ['SKIPPED', 'SKIPPED'],
  );
});

test('built-in profile seed upgrades stale built-in profiles to the shipped version', async () => {
  const updated = [];
  const repository = {
    findByIdentifier: async (identifier) => ({
      _id: `507f1f77bcf86cd799439099${identifier === 'em500' ? '1' : '2'}`,
      identifier,
      builtIn: true,
      metadata: { profileVersion: 1 },
    }),
    create: async () => {
      throw new Error('create must not be called for existing profiles');
    },
    updateById: async (id, payload) => {
      updated.push(payload);
      return { _id: id, ...payload };
    },
  };

  const results = await seedBuiltinProfiles(repository);
  // Both profiles ship at version 2, so stale version-1 built-ins upgrade.
  assert.deepEqual(
    results.map((result) => result.action),
    ['UPDATED', 'UPDATED'],
  );

  const em500Upgrade = updated.find((profile) => profile.identifier === 'em500');
  assert.equal(em500Upgrade.metadata.profileVersion, CURRENT_PROFILE_VERSION);
  assert.equal(em500Upgrade.builtIn, true);
  const energyEnabled = em500Upgrade.registers.filter(
    (register) => register.group === 'Energy' && register.enabled,
  );
  assert.equal(energyEnabled.length, 0, 'upgrade must disable energy counters');
});

test('built-in profile seed never touches operator-created profiles', async () => {
  const repository = {
    findByIdentifier: async (identifier) => ({
      _id: '507f1f77bcf86cd799439099',
      identifier,
      builtIn: false,
      registers: [{ key: 'operator_value', name: 'Operator value' }],
    }),
    create: async () => {
      throw new Error('create must not be called');
    },
    updateById: async () => {
      throw new Error('operator-created profiles must never be replaced');
    },
  };

  const results = await seedBuiltinProfiles(repository);
  assert.deepEqual(
    results.map((result) => result.action),
    ['SKIPPED', 'SKIPPED'],
  );
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
  assert.deepEqual(result.restored, ['em500', 'huawei-sun2000']);
  assert.deepEqual(result.alreadyPresent, []);
  assert.equal(result.total, 2);
  assert.ok(created.every((profile) => profile.builtIn === true));
});

test('RegisterProfileService.restoreBuiltIns reports profiles that already exist', async () => {
  const created = [];
  const service = new RegisterProfileService({
    registerProfileRepository: {
      findByIdentifier: async (identifier) =>
        identifier === 'em500'
          ? {
              identifier,
              builtIn: true,
              metadata: { profileVersion: CURRENT_PROFILE_VERSION },
            }
          : null,
      create: async (payload) => {
        created.push(payload);
        return payload;
      },
      updateById: async () => {
        throw new Error('update must not be called');
      },
    },
    deviceRepository: {},
  });

  const result = await service.restoreBuiltIns();
  assert.deepEqual(result.restored, ['huawei-sun2000']);
  assert.deepEqual(result.alreadyPresent, ['em500']);
  assert.equal(result.total, 2);
  assert.deepEqual(
    created.map((profile) => profile.identifier),
    ['huawei-sun2000'],
  );
});
