'use strict';

const { decodeRegister } = require('../modbus/register-decoder');

const ORDERS = Object.freeze([
  { label: 'ABCD', byteOrder: 'BIG_ENDIAN', wordOrder: 'BIG_ENDIAN' },
  { label: 'BADC', byteOrder: 'LITTLE_ENDIAN', wordOrder: 'BIG_ENDIAN' },
  { label: 'CDAB', byteOrder: 'BIG_ENDIAN', wordOrder: 'LITTLE_ENDIAN' },
  { label: 'DCBA', byteOrder: 'LITTLE_ENDIAN', wordOrder: 'LITTLE_ENDIAN' },
]);

const TYPES_BY_LENGTH = Object.freeze({
  1: ['UINT16', 'INT16'],
  2: ['UINT32', 'INT32', 'FLOAT32'],
  4: ['FLOAT64'],
});

function safeDecode(definition, rawValues) {
  try {
    const decoded = decodeRegister(definition, rawValues);
    if (typeof decoded.value === 'number' && !Number.isFinite(decoded.value)) return null;
    return {
      dataType: definition.dataType,
      order: definition.order,
      scaleFactor: definition.scaleFactor,
      offset: definition.offset,
      rawValue: decoded.rawValue,
      value: decoded.value,
    };
  } catch {
    return null;
  }
}

function interpretRegisterWords(rawValues, options = {}) {
  if (
    !Array.isArray(rawValues) ||
    rawValues.length === 0 ||
    rawValues.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)
  ) {
    return {
      rawValues: [],
      candidates: [],
      bitFields: [],
      text: null,
      note: 'A successful FC03 or FC04 response containing complete 16-bit words is required.',
    };
  }

  const scaleFactor = Number.isFinite(Number(options.scaleFactor))
    ? Number(options.scaleFactor)
    : 1;
  const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;
  const types = TYPES_BY_LENGTH[rawValues.length] || [];
  const candidates = [];

  for (const dataType of types) {
    for (const order of ORDERS) {
      const result = safeDecode(
        {
          key: 'candidate',
          name: 'Candidate interpretation',
          registerType: 'HOLDING_REGISTER',
          address: 0,
          dataType,
          length: rawValues.length,
          byteOrder: order.byteOrder,
          wordOrder: order.wordOrder,
          scaleFactor,
          offset,
          order: order.label,
        },
        rawValues,
      );
      if (result) candidates.push(result);
    }
  }

  const bitFields = rawValues.length === 1
    ? Array.from({ length: 16 }, (_, bitIndex) => ({
        bitIndex,
        set: Boolean(rawValues[0] & (1 << bitIndex)),
      }))
    : [];

  let text = null;
  try {
    const buffer = Buffer.alloc(rawValues.length * 2);
    rawValues.forEach((word, index) => buffer.writeUInt16BE(word, index * 2));
    const decoded = buffer.toString('utf8').replace(/\0/g, '').trim();
    if (decoded && [...decoded].every((character) => character >= ' ' && character <= '~')) {
      text = decoded;
    }
  } catch {
    text = null;
  }

  return {
    rawValues,
    scaleFactor,
    offset,
    candidates,
    bitFields,
    text,
    note:
      'These are candidate interpretations only. Modbus requests do not transmit data type, byte order, scale, offset, or unit.',
  };
}

module.exports = {
  ORDERS,
  TYPES_BY_LENGTH,
  interpretRegisterWords,
};
