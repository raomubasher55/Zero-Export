'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_TYPES } = require('../src/constants/modbus');
const { readModbusBodySchema, writeModbusBodySchema } = require('../src/validators/modbus.validator');

test('raw Modbus validators enforce function-code quantity limits and address ranges', () => {
  const validRead = readModbusBodySchema.safeParse({
    registerType: REGISTER_TYPES.HOLDING,
    address: 0,
    quantity: 125,
  });
  assert.equal(validRead.success, true);

  const invalidWordRead = readModbusBodySchema.safeParse({
    registerType: REGISTER_TYPES.HOLDING,
    address: 0,
    quantity: 126,
  });
  assert.equal(invalidWordRead.success, false);

  const invalidRange = readModbusBodySchema.safeParse({
    registerType: REGISTER_TYPES.COIL,
    address: 65535,
    quantity: 2,
  });
  assert.equal(invalidRange.success, false);
});

test('raw Modbus write validator allows only writable Modbus areas and valid unsigned values', () => {
  const validCoilWrite = writeModbusBodySchema.safeParse({
    registerType: REGISTER_TYPES.COIL,
    address: 10,
    values: [true, false],
  });
  assert.equal(validCoilWrite.success, true);

  const validRegisterWrite = writeModbusBodySchema.safeParse({
    registerType: REGISTER_TYPES.HOLDING,
    address: 10,
    values: [0, 65535],
  });
  assert.equal(validRegisterWrite.success, true);

  const invalidInputWrite = writeModbusBodySchema.safeParse({
    registerType: REGISTER_TYPES.INPUT,
    address: 10,
    values: [5],
  });
  assert.equal(invalidInputWrite.success, false);
});
