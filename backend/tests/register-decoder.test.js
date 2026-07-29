'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BYTE_ORDERS,
  REGISTER_DATA_TYPES,
  REGISTER_TYPES,
  WORD_ORDERS,
} = require('../src/constants/modbus');
const { decodeRegister } = require('../src/modbus/register-decoder');

function definition(overrides = {}) {
  return {
    key: 'test_value',
    name: 'Test value',
    registerType: REGISTER_TYPES.HOLDING,
    address: 0,
    dataType: REGISTER_DATA_TYPES.UINT16,
    length: 1,
    byteOrder: BYTE_ORDERS.BIG_ENDIAN,
    wordOrder: WORD_ORDERS.BIG_ENDIAN,
    bitIndex: 0,
    scaleFactor: 1,
    offset: 0,
    ...overrides,
  };
}

test('register decoder applies Modbus word and byte order before numeric conversion', () => {
  const bigEndian = decodeRegister(
    definition({ dataType: REGISTER_DATA_TYPES.UINT32, length: 2 }),
    [0x1234, 0x5678],
  );
  assert.equal(bigEndian.value, 0x12345678);

  const wordSwapped = decodeRegister(
    definition({
      dataType: REGISTER_DATA_TYPES.UINT32,
      length: 2,
      wordOrder: WORD_ORDERS.LITTLE_ENDIAN,
    }),
    [0x1234, 0x5678],
  );
  assert.equal(wordSwapped.value, 0x56781234);

  const byteAndWordSwapped = decodeRegister(
    definition({
      dataType: REGISTER_DATA_TYPES.UINT32,
      length: 2,
      byteOrder: BYTE_ORDERS.LITTLE_ENDIAN,
      wordOrder: WORD_ORDERS.LITTLE_ENDIAN,
    }),
    [0x1234, 0x5678],
  );
  assert.equal(byteAndWordSwapped.value, 0x78563412);
});

test('register decoder supports scaled floats, UTF-8 strings, and BIT extraction', () => {
  const scaledFloat = decodeRegister(
    definition({
      dataType: REGISTER_DATA_TYPES.FLOAT32,
      length: 2,
      scaleFactor: 2,
      offset: 1,
    }),
    [0x3f80, 0x0000],
  );
  assert.equal(scaledFloat.rawValue, 1);
  assert.equal(scaledFloat.value, 3);

  const stringValue = decodeRegister(
    definition({
      key: 'serial',
      dataType: REGISTER_DATA_TYPES.STRING,
      length: 3,
    }),
    [0x4142, 0x4331, 0x0000],
  );
  assert.equal(stringValue.value, 'ABC1');

  const registerBit = decodeRegister(
    definition({
      key: 'alarm',
      dataType: REGISTER_DATA_TYPES.BIT,
      length: 1,
      bitIndex: 2,
    }),
    [0x0004],
  );
  assert.equal(registerBit.value, true);

  const coilBit = decodeRegister(
    definition({
      key: 'relay',
      registerType: REGISTER_TYPES.COIL,
      dataType: REGISTER_DATA_TYPES.BIT,
      length: 1,
    }),
    [false],
  );
  assert.equal(coilBit.value, false);
});
