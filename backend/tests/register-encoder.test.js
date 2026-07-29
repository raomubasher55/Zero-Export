'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_DATA_TYPES, REGISTER_TYPES } = require('../src/constants/modbus');
const { decodeRegister } = require('../src/modbus/register-decoder');
const { encodeRegister } = require('../src/modbus/register-encoder');

const orders = [
  ['BIG_ENDIAN', 'BIG_ENDIAN'],
  ['LITTLE_ENDIAN', 'BIG_ENDIAN'],
  ['BIG_ENDIAN', 'LITTLE_ENDIAN'],
  ['LITTLE_ENDIAN', 'LITTLE_ENDIAN'],
];

test('register encoder reverses scaling and every supported 32-bit byte/word order', () => {
  for (const [byteOrder, wordOrder] of orders) {
    const definition = {
      key: 'power',
      name: 'Power',
      registerType: REGISTER_TYPES.HOLDING,
      address: 10,
      dataType: REGISTER_DATA_TYPES.UINT32,
      length: 2,
      byteOrder,
      wordOrder,
      scaleFactor: 0.1,
      offset: -5,
    };

    const encoded = encodeRegister(definition, 123451.7);
    const decoded = decodeRegister(definition, encoded.rawValues);
    assert.ok(Math.abs(decoded.value - 123451.7) < 1e-9);
    assert.equal(decoded.rawValue, 1234567);
  }
});

test('register encoder supports float, string, coil, and holding-register bit values', () => {
  const floatDefinition = {
    key: 'frequency',
    name: 'Frequency',
    registerType: REGISTER_TYPES.INPUT,
    address: 0,
    dataType: REGISTER_DATA_TYPES.FLOAT32,
    length: 2,
    scaleFactor: 1,
    offset: 0,
  };
  const floatWords = encodeRegister(floatDefinition, 50.25).rawValues;
  assert.equal(decodeRegister(floatDefinition, floatWords).value, 50.25);

  const stringDefinition = {
    key: 'serial',
    name: 'Serial',
    registerType: REGISTER_TYPES.HOLDING,
    address: 20,
    dataType: REGISTER_DATA_TYPES.STRING,
    length: 4,
  };
  const stringWords = encodeRegister(stringDefinition, 'OPI-01').rawValues;
  assert.equal(decodeRegister(stringDefinition, stringWords).value, 'OPI-01');

  const coilDefinition = {
    key: 'enable',
    name: 'Enable',
    registerType: REGISTER_TYPES.COIL,
    address: 1,
    dataType: REGISTER_DATA_TYPES.BIT,
    length: 1,
  };
  assert.deepEqual(encodeRegister(coilDefinition, true).rawValues, [true]);

  const bitDefinition = {
    ...coilDefinition,
    registerType: REGISTER_TYPES.HOLDING,
    bitIndex: 7,
  };
  assert.deepEqual(encodeRegister(bitDefinition, true).rawValues, [128]);
});
