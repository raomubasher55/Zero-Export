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
const { encodeRegister } = require('../src/modbus/register-encoder');

function definition(overrides = {}) {
  return {
    key: 'test_value',
    name: 'Test value',
    registerType: REGISTER_TYPES.INPUT,
    address: 0,
    dataType: REGISTER_DATA_TYPES.UINT64,
    length: 4,
    byteOrder: BYTE_ORDERS.BIG_ENDIAN,
    wordOrder: WORD_ORDERS.BIG_ENDIAN,
    bitIndex: 0,
    scaleFactor: 1,
    offset: 0,
    ...overrides,
  };
}

test('UINT64 registers decode a 64-bit counter across four words', () => {
  const decoded = decodeRegister(
    definition({ dataType: REGISTER_DATA_TYPES.UINT64 }),
    [0x0000, 0x0001, 0x1234, 0x5678],
  );
  // 0x0000000112345678 = 4,600,387,192
  assert.equal(decoded.rawValue, 4600387192);
  assert.equal(decoded.value, 4600387192);
  assert.equal(decoded.rawValues.length, 4);
});

test('UINT64 decoding honors word order', () => {
  const wordSwapped = decodeRegister(
    definition({
      dataType: REGISTER_DATA_TYPES.UINT64,
      wordOrder: WORD_ORDERS.LITTLE_ENDIAN,
    }),
    [0x5678, 0x1234, 0x0001, 0x0000],
  );
  // reversed words -> [0x0000, 0x0001, 0x1234, 0x5678]
  assert.equal(wordSwapped.rawValue, 4600387192);

  const byteSwapped = decodeRegister(
    definition({
      dataType: REGISTER_DATA_TYPES.UINT64,
      byteOrder: BYTE_ORDERS.LITTLE_ENDIAN,
    }),
    [0x0000, 0x0100, 0x3412, 0x7856],
  );
  // bytes swapped per word -> [0x0000, 0x0001, 0x1234, 0x5678]
  assert.equal(byteSwapped.rawValue, 4600387192);
});

test('UINT64 decoding applies scaling like EM500 energy counters (kWh/100)', () => {
  const decoded = decodeRegister(
    definition({
      dataType: REGISTER_DATA_TYPES.UINT64,
      scaleFactor: 0.01,
      unit: 'kWh',
    }),
    [0x0000, 0x0000, 0x00B6, 0x4BE0], // 11,946,976 raw -> 119,469.76 kWh
  );
  assert.equal(decoded.rawValue, 11946976);
  assert.ok(Math.abs(decoded.value - 119469.76) < 1e-9);
});

test('INT64 registers decode signed 64-bit values', () => {
  const negative = decodeRegister(
    definition({ dataType: REGISTER_DATA_TYPES.INT64 }),
    [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFE], // -2
  );
  assert.equal(negative.rawValue, -2);

  const positive = decodeRegister(
    definition({ dataType: REGISTER_DATA_TYPES.INT64 }),
    [0x0000, 0x0000, 0x0000, 0x0007],
  );
  assert.equal(positive.rawValue, 7);
});

test('UINT64 encoding round-trips through all byte/word orderings', () => {
  const orders = [
    ['BIG_ENDIAN', 'BIG_ENDIAN'],
    ['LITTLE_ENDIAN', 'BIG_ENDIAN'],
    ['BIG_ENDIAN', 'LITTLE_ENDIAN'],
    ['LITTLE_ENDIAN', 'LITTLE_ENDIAN'],
  ];

  for (const [byteOrder, wordOrder] of orders) {
    const base = definition({
      dataType: REGISTER_DATA_TYPES.UINT64,
      scaleFactor: 0.01,
      byteOrder,
      wordOrder,
    });
    const encoded = encodeRegister(base, 119480);
    assert.equal(encoded.rawValue, 11948000);
    assert.equal(encoded.rawValues.length, 4);
    const decoded = decodeRegister(base, encoded.rawValues);
    assert.equal(decoded.value, 119480);
  }
});

test('INT64 encoding writes the two-complement 64-bit pattern', () => {
  const base = definition({ dataType: REGISTER_DATA_TYPES.INT64 });
  const encoded = encodeRegister(base, -2);
  assert.deepEqual(encoded.rawValues, [0xffff, 0xffff, 0xffff, 0xfffe]);
});

test('64-bit encoding rejects out-of-range values', () => {
  assert.throws(
    () => encodeRegister(definition({ dataType: REGISTER_DATA_TYPES.UINT64 }), -1),
    (error) => error.name === 'RegisterEncodeError',
  );
  assert.throws(
    () =>
      encodeRegister(
        definition({ dataType: REGISTER_DATA_TYPES.INT64 }),
        9223372036854775807 * 2,
      ),
    (error) => error.name === 'RegisterEncodeError',
  );
});
