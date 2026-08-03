'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REGISTER_DATA_TYPES,
  REGISTER_TYPES,
} = require('../src/constants/modbus');
const { GatewayService } = require('../src/services/gateway.service');
const { generateMappingsSchema } = require('../src/validators/gateway.validator');

const DEVICE_ID = '507f1f77bcf86cd799439011';
const PROFILE_ID = '507f1f77bcf86cd799439012';

function em500LikeDevice() {
  return {
    _id: DEVICE_ID,
    identifier: 'plant-a-meter',
    name: 'Plant A meter',
    registerProfile: {
      _id: PROFILE_ID,
      identifier: 'em500',
      name: 'Eastron EM500 energy meter',
      model: 'EM500',
      registers: [
        {
          key: 'l1_phase_voltage',
          name: 'L1 phase voltage',
          registerType: REGISTER_TYPES.INPUT,
          address: 0x0002,
          dataType: REGISTER_DATA_TYPES.UINT32,
          length: 2,
          byteOrder: 'BIG_ENDIAN',
          wordOrder: 'BIG_ENDIAN',
          bitIndex: 0,
          scaleFactor: 0.01,
          offset: 0,
          unit: 'V',
          writable: false,
          enabled: true,
        },
        {
          key: 'l1_active_power',
          name: 'L1 active power',
          registerType: REGISTER_TYPES.INPUT,
          address: 0x0014,
          dataType: REGISTER_DATA_TYPES.INT32,
          length: 2,
          byteOrder: 'BIG_ENDIAN',
          wordOrder: 'BIG_ENDIAN',
          bitIndex: 0,
          scaleFactor: 0.01,
          offset: 0,
          unit: 'W',
          writable: false,
          enabled: true,
        },
        {
          key: 'total_import_active_energy',
          name: 'Total imported active energy',
          registerType: REGISTER_TYPES.INPUT,
          address: 0x1b20,
          dataType: REGISTER_DATA_TYPES.UINT64,
          length: 4,
          byteOrder: 'BIG_ENDIAN',
          wordOrder: 'BIG_ENDIAN',
          bitIndex: 0,
          scaleFactor: 0.01,
          offset: 0,
          unit: 'kWh',
          writable: false,
          enabled: true,
        },
        {
          key: 'disabled_value',
          name: 'Disabled value',
          registerType: REGISTER_TYPES.INPUT,
          address: 0x00ff,
          dataType: REGISTER_DATA_TYPES.UINT32,
          length: 2,
          byteOrder: 'BIG_ENDIAN',
          wordOrder: 'BIG_ENDIAN',
          bitIndex: 0,
          scaleFactor: 1,
          offset: 0,
          unit: null,
          writable: false,
          enabled: false,
        },
      ],
    },
  };
}

function serviceWith(device) {
  return new GatewayService({
    deviceRepository: {
      findManyByIdsWithProfiles: async () => (device ? [device] : []),
    },
  });
}

test('generateMappings mirrors every enabled register at the meter’s own addresses', async () => {
  const service = serviceWith(em500LikeDevice());
  const result = await service.generateMappings({ sourceDeviceId: DEVICE_ID });

  assert.equal(result.count, 3);
  assert.equal(result.registerType, null);
  assert.equal(result.addressOffset, 0);
  assert.equal(result.sourceProfile.identifier, 'em500');

  const byKey = new Map(result.mappings.map((mapping) => [mapping.key, mapping]));

  const voltage = byKey.get('l1_phase_voltage');
  assert.equal(voltage.sourceDeviceId, DEVICE_ID);
  assert.equal(voltage.sourceRegisterKey, 'l1_phase_voltage');
  assert.equal(voltage.registerType, REGISTER_TYPES.INPUT);
  assert.equal(voltage.address, 0x0002);
  assert.equal(voltage.dataType, REGISTER_DATA_TYPES.UINT32);
  assert.equal(voltage.length, 2);
  assert.equal(voltage.scaleFactor, 0.01);
  assert.equal(voltage.unit, 'V');
  assert.equal(voltage.writable, false);
  assert.equal(voltage.enabled, true);

  const energy = byKey.get('total_import_active_energy');
  assert.equal(energy.address, 0x1b20);
  assert.equal(energy.dataType, REGISTER_DATA_TYPES.UINT64);
  assert.equal(energy.length, 4);
  assert.equal(energy.scaleFactor, 0.01);
  assert.equal(energy.unit, 'kWh');

  assert.equal(byKey.has('disabled_value'), false, 'disabled registers must be skipped');
});

test('generateMappings can republish the same addresses into the holding area', async () => {
  const service = serviceWith(em500LikeDevice());
  const result = await service.generateMappings({
    sourceDeviceId: DEVICE_ID,
    registerType: REGISTER_TYPES.HOLDING,
  });

  assert.ok(result.mappings.every((mapping) => mapping.registerType === REGISTER_TYPES.HOLDING));
  const voltage = result.mappings.find((mapping) => mapping.key === 'l1_phase_voltage');
  assert.equal(voltage.address, 0x0002);
  assert.equal(voltage.writable, false);
});

test('generateMappings applies an address offset', async () => {
  const service = serviceWith(em500LikeDevice());
  const result = await service.generateMappings({
    sourceDeviceId: DEVICE_ID,
    registerType: REGISTER_TYPES.HOLDING,
    addressOffset: 100,
  });

  const voltage = result.mappings.find((mapping) => mapping.key === 'l1_phase_voltage');
  assert.equal(voltage.address, 0x0002 + 100);
});

test('generateMappings keeps write-through only for writable source registers in writable areas', async () => {
  const device = em500LikeDevice();
  device.registerProfile.registers.push({
    key: 'setpoint',
    name: 'Setpoint',
    registerType: REGISTER_TYPES.HOLDING,
    address: 400,
    dataType: REGISTER_DATA_TYPES.UINT16,
    length: 1,
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor: 1,
    offset: 0,
    unit: null,
    writable: true,
    enabled: true,
  });

  const service = serviceWith(device);
  const result = await service.generateMappings({
    sourceDeviceId: DEVICE_ID,
    registerType: REGISTER_TYPES.HOLDING,
  });

  const setpoint = result.mappings.find((mapping) => mapping.key === 'setpoint');
  assert.equal(setpoint.writable, true);

  const asInput = await service.generateMappings({
    sourceDeviceId: DEVICE_ID,
    registerType: REGISTER_TYPES.INPUT,
  });
  assert.equal(
    asInput.mappings.find((mapping) => mapping.key === 'setpoint').writable,
    false,
    'input areas cannot accept downstream writes',
  );
});

test('generateMappings rejects unknown devices and profiles without registers', async () => {
  const service = serviceWith(null);
  await assert.rejects(
    service.generateMappings({ sourceDeviceId: DEVICE_ID }),
    (error) => error.statusCode === 404 && error.code === 'NOT_FOUND',
  );

  const noProfileDevice = {
    _id: DEVICE_ID,
    identifier: 'bare',
    name: 'Bare device',
    registerProfile: null,
  };
  const bareService = serviceWith(noProfileDevice);
  await assert.rejects(
    bareService.generateMappings({ sourceDeviceId: DEVICE_ID }),
    (error) => error.statusCode === 422,
  );
});

test('generateMappings reports address overflows from an offset', async () => {
  const device = em500LikeDevice();
  device.registerProfile.registers.push({
    key: 'at_end',
    name: 'At end',
    registerType: REGISTER_TYPES.INPUT,
    address: 65534,
    dataType: REGISTER_DATA_TYPES.UINT32,
    length: 2,
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor: 1,
    offset: 0,
    unit: null,
    writable: false,
    enabled: true,
  });

  const service = serviceWith(device);
  await assert.rejects(
    service.generateMappings({ sourceDeviceId: DEVICE_ID, addressOffset: 1 }),
    (error) =>
      error.statusCode === 422 &&
      error.details.some((detail) => detail.code === 'address_range'),
  );
});

test('generateMappings rejects numeric registers in a coil/discrete-input area', async () => {
  const service = serviceWith(em500LikeDevice());
  await assert.rejects(
    service.generateMappings({ sourceDeviceId: DEVICE_ID, registerType: REGISTER_TYPES.COIL }),
    (error) =>
      error.statusCode === 422 &&
      error.details.some((detail) => detail.code === 'incompatible_area'),
  );
});

test('generateMappingsSchema accepts a minimal mirror request and applies defaults', () => {
  const parsed = generateMappingsSchema.parse({ sourceDeviceId: DEVICE_ID });
  assert.equal(parsed.addressOffset, 0);
  assert.equal(parsed.registerType, undefined);
});

test('generateMappingsSchema rejects unknown fields and invalid areas', () => {
  assert.throws(
    () => generateMappingsSchema.parse({ sourceDeviceId: DEVICE_ID, surprise: true }),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => generateMappingsSchema.parse({ sourceDeviceId: DEVICE_ID, registerType: 'MEMORY' }),
    (error) => error.name === 'ZodError',
  );
  assert.throws(
    () => generateMappingsSchema.parse({ sourceDeviceId: DEVICE_ID, addressOffset: -1 }),
    (error) => error.name === 'ZodError',
  );
});

test('gateway initialize survives a stale persisted configuration', async () => {
  let configured = null;
  const service = new GatewayService({
    configurationRepository: {
      getOrDefault: async () => ({
        key: 'primary',
        enabled: true,
        unitId: 1,
        tcp: { enabled: true, host: '0.0.0.0', port: 1502 },
        rtu: { enabled: false, serialPath: '/dev/ttyUSB1', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
        mappings: [{ key: 'stale', sourceDeviceId: '507f1f77bcf86cd799439099' }],
      }),
    },
    deviceRepository: {
      findManyByIdsWithProfiles: async () => [], // deleted device -> stale
    },
    latestValueRepository: { findForSources: async () => [] },
    runtime: {
      configure: (configuration) => {
        configured = configuration;
      },
      getStatus: () => ({ running: false, state: 'STOPPED' }),
      start: async () => {
        throw new Error('start must not be called for a stale config');
      },
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  const result = await service.initialize();

  assert.equal(result.configuration.enabled, false, 'falls back to disabled');
  assert.deepEqual(result.configuration.mappings, [], 'falls back to an empty map');
  assert.ok(result.initializationError?.message, 'surfaces the reason');
  assert.equal(service.initializationError, result.initializationError);
  assert.ok(configured.enabled === false, 'runtime configured with the safe state');
});
