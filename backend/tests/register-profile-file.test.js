'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const RegisterProfileService = require('../src/services/register-profile.service');
const { importRegisterProfilesBodySchema } = require('../src/validators/register-profile.validator');

function profile(identifier = 'meter-a') {
  return {
    _id: identifier === 'meter-a' ? '507f1f77bcf86cd799439011' : '507f1f77bcf86cd799439012',
    identifier,
    name: `Profile ${identifier}`,
    description: null,
    manufacturer: 'Example',
    model: 'M1',
    registers: [
      {
        key: 'power',
        name: 'Active power',
        description: null,
        registerType: 'INPUT_REGISTER',
        address: 10,
        dataType: 'INT32',
        length: 2,
        byteOrder: 'BIG_ENDIAN',
        wordOrder: 'LITTLE_ENDIAN',
        bitIndex: 0,
        scaleFactor: 0.1,
        offset: 0,
        unit: 'W',
        group: 'Power',
        writable: false,
        enabled: true,
        sortOrder: 0,
      },
    ],
    isActive: true,
    tags: ['meter'],
    metadata: { source: 'manual' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test('register profile export creates a portable versioned JSON document', async () => {
  const service = new RegisterProfileService({
    registerProfileRepository: {
      findAllForExport: async () => [profile()],
    },
    deviceRepository: {},
  });

  const exported = await service.exportAll();
  assert.equal(exported.format, 'zero-export-register-profiles');
  assert.equal(exported.version, 1);
  assert.equal(exported.profileCount, 1);
  assert.equal(exported.profiles[0].identifier, 'meter-a');
  assert.equal(exported.profiles[0].registers[0].wordOrder, 'LITTLE_ENDIAN');
  assert.equal('_id' in exported.profiles[0], false);
  assert.equal('createdAt' in exported.profiles[0], false);
});

test('register profile import updates matching identifiers and creates new profiles', async () => {
  const actions = [];
  const existing = profile('meter-a');
  const service = new RegisterProfileService({
    registerProfileRepository: {
      findByIdentifier: async (identifier) => (identifier === 'meter-a' ? existing : null),
      updateById: async (id, payload) => {
        actions.push({ action: 'update', id: String(id), identifier: payload.identifier });
        return { _id: id, ...payload };
      },
      create: async (payload) => {
        actions.push({ action: 'create', identifier: payload.identifier });
        return { _id: '507f1f77bcf86cd799439099', ...payload };
      },
    },
    deviceRepository: {},
  });

  const result = await service.importFile({
    conflictStrategy: 'UPDATE',
    profiles: [profile('meter-a'), profile('meter-b')],
  });

  assert.equal(result.total, 2);
  assert.equal(result.updated, 1);
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(actions.map((action) => action.action), ['update', 'create']);
});

test('register profile import validator rejects duplicate identifiers and server fields', () => {
  const portable = profile();
  delete portable._id;
  delete portable.createdAt;
  delete portable.updatedAt;

  const duplicate = importRegisterProfilesBodySchema.safeParse({
    format: 'zero-export-register-profiles',
    version: 1,
    conflictStrategy: 'UPDATE',
    profiles: [portable, { ...portable }],
  });
  assert.equal(duplicate.success, false);

  const serverField = importRegisterProfilesBodySchema.safeParse({
    format: 'zero-export-register-profiles',
    version: 1,
    profiles: [{ ...portable, _id: '507f1f77bcf86cd799439011' }],
  });
  assert.equal(serverField.success, false);
});
