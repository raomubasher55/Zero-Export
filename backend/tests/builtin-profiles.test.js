'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_DATA_TYPES } = require('../src/constants/modbus');
const { createRegisterProfileBodySchema } = require('../src/validators/register-profile.validator');
const { EM500_PROFILE } = require('../src/seed/em500.profile');
const { HUAWEI_SUN2000_PROFILE } = require('../src/seed/huawei-sun2000.profile');
const { SOLIS_PROFILE } = require('../src/seed/solis-inverter.profile');
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
  assert.equal(parsed.registers.length, 69);

  const keys = new Set(parsed.registers.map((register) => register.key));
  assert.equal(keys.size, 69, 'register keys must be unique');

  const addresses = new Set(
    parsed.registers.map((register) => `${register.registerType}:${register.address}`),
  );
  assert.equal(addresses.size, 69, 'register addresses must be unique');

  const holdingRegisters = parsed.registers.filter(
    (register) => register.registerType === 'HOLDING_REGISTER',
  );
  assert.equal(holdingRegisters.length, 69, 'all EM500 registers are holding registers (FC03)');

  for (const register of holdingRegisters) {
    assert.equal(register.registerType, 'HOLDING_REGISTER', `${register.key} must be a holding register`);
    assert.equal(register.bitIndex, 0);
    assert.equal(register.offset, 0);
    const expectedLength =
      register.dataType === REGISTER_DATA_TYPES.UINT64
        ? 4
        : register.dataType === REGISTER_DATA_TYPES.UINT16 && register.key === 'tariff_enable'
          ? 1
          : 2;
    assert.equal(register.length, expectedLength);
    assert.ok(register.address + register.length <= 65536);
  }

  const tariff = parsed.registers.find((register) => register.key === 'tariff_enable');
  assert.ok(tariff, 'tariff register must exist');
  assert.equal(tariff.address, 8448, 'tariff register is decimal 8448 (0x2100)');
  assert.equal(tariff.registerType, 'HOLDING_REGISTER', 'tariff is a holding register');
  assert.equal(tariff.dataType, 'UINT16');
  assert.equal(tariff.length, 1);
  assert.equal(tariff.writable, true, 'tariff must be writable');
  assert.equal(tariff.enabled, true, 'tariff must be enabled');
  assert.equal(tariff.scaleFactor, 1);
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

  // Enabled registers stay in the real-time area, except the tariff control
  // register at 8448.
  const enabledRealtime = EM500_PROFILE.registers.filter(
    (register) => register.enabled && register.key !== 'tariff_enable',
  );
  const maxEnabled = Math.max(
    ...enabledRealtime.map((register) => register.address + register.length),
  );
  assert.ok(
    maxEnabled <= 0x0048 + 2,
    'enabled registers must stay in the 0x0000-0x0048 real-time area',
  );
  assert.ok(
    EM500_PROFILE.registers.every(
      (register) => register.registerType === 'HOLDING_REGISTER',
    ),
    'every EM500 register is a holding register (FC03)',
  );
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
  assert.equal(byKey.get('active_power_derating').address, 40125);
  assert.equal(byKey.get('active_power_derating').writable, true);
  assert.equal(byKey.get('active_power_derating').scaleFactor, 0.1);
  assert.equal(byKey.get('active_power_fixed_limit').address, 40126);
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

test('built-in Solis profile covers the Modbus RTU map with wire-offset addresses', () => {
  const parsed = createRegisterProfileBodySchema.parse(SOLIS_PROFILE);

  assert.equal(parsed.identifier, 'solis-inverter');
  assert.equal(parsed.maxReadQuantity, 50);
  assert.equal(parsed.registers.length, 117);

  const keys = new Set(parsed.registers.map((register) => register.key));
  assert.equal(keys.size, 117, 'register keys must be unique');

  const byKey = new Map(parsed.registers.map((register) => [register.key, register]));

  // Wire address = document register - 1.
  assert.equal(byKey.get('grid_voltage_a').address, 3008, 'doc 3009 -> wire 3008');
  assert.equal(byKey.get('grid_voltage_a').registerType, 'INPUT_REGISTER');
  assert.equal(byKey.get('grid_voltage_a').scaleFactor, 0.1);
  assert.equal(byKey.get('grid_frequency').address, 3017);
  assert.equal(byKey.get('grid_frequency').scaleFactor, 0.01);
  assert.equal(byKey.get('active_power').address, 3003);
  assert.equal(byKey.get('active_power').dataType, 'UINT32');
  assert.equal(byKey.get('reactive_power').address, 3005, 'moved off 0x0BBC to avoid overlap');
  assert.equal(byKey.get('power_factor').scaleFactor, 0.001);
  assert.equal(byKey.get('daily_generation').address, 3014);
  assert.equal(byKey.get('daily_generation').scaleFactor, 0.1);
  assert.equal(byKey.get('meter_grid_active_power').address, 3205);
  assert.equal(byKey.get('meter_grid_active_power').dataType, 'INT32');
  assert.equal(byKey.get('mppt1_voltage').address, 3500);
  assert.equal(byKey.get('mppt15_voltage').address, 3514);
  assert.equal(byKey.get('mppt1_current').address, 3530);
  assert.equal(byKey.get('mppt15_current').address, 3544);
  assert.equal(byKey.get('string1_voltage').address, 3022);
  assert.equal(byKey.get('string1_current').address, 3023);
  assert.equal(byKey.get('string32_voltage').address, 3084);
  assert.equal(byKey.get('string32_current').address, 3085);

  const limit = byKey.get('active_power_limit');
  assert.equal(limit.address, 3051, 'active power limit served at document address 3051');
  assert.equal(limit.registerType, 'HOLDING_REGISTER', 'power limit is a holding register');
  assert.equal(limit.writable, true);
  assert.equal(limit.dataType, 'UINT16');
  assert.equal(limit.scaleFactor, 0.1);

  for (const register of parsed.registers) {
    assert.ok(register.address + register.length <= 65536);
    if (register.dataType === 'UINT32' || register.dataType === 'INT32') {
      assert.equal(register.length, 2);
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
  const currentVersions = new Map(
    BUILTIN_PROFILES.map((profile) => [profile.identifier, profile.metadata.profileVersion]),
  );
  const repository = {
    findByIdentifier: async (identifier) => ({
      identifier,
      builtIn: true,
      metadata: { profileVersion: currentVersions.get(identifier) },
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
    ['SKIPPED', 'SKIPPED', 'SKIPPED'],
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
  // All three built-ins ship above version 1, so stale v1 built-ins upgrade.
  assert.deepEqual(
    results.map((result) => result.action),
    ['UPDATED', 'UPDATED', 'UPDATED'],
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
    ['SKIPPED', 'SKIPPED', 'SKIPPED'],
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
  assert.deepEqual(result.restored, ['em500', 'huawei-sun2000', 'solis-inverter']);
  assert.deepEqual(result.alreadyPresent, []);
  assert.equal(result.total, 3);
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
  assert.deepEqual(result.restored, ['huawei-sun2000', 'solis-inverter']);
  assert.deepEqual(result.alreadyPresent, ['em500']);
  assert.equal(result.total, 3);
  assert.deepEqual(
    created.map((profile) => profile.identifier),
    ['huawei-sun2000', 'solis-inverter'],
  );
});
