'use strict';

const {
  BYTE_ORDERS,
  REGISTER_DATA_TYPES,
  REGISTER_TYPES,
  WORD_ORDERS,
} = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

class RegisterDecodeError extends Error {
  constructor(message, definition) {
    super(message);
    this.name = 'RegisterDecodeError';
    this.registerKey = definition?.key;
    Error.captureStackTrace(this, this.constructor);
  }
}

function assertRegisterWords(rawValues, definition) {
  const requiredLength = definition.length || expectedWordLength(definition.dataType);
  if (!Array.isArray(rawValues) || rawValues.length !== requiredLength) {
    throw new RegisterDecodeError(
      `${definition.key} requires ${requiredLength} raw Modbus value(s), received ${rawValues?.length ?? 0}.`,
      definition,
    );
  }

  rawValues.forEach((value) => {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      throw new RegisterDecodeError(`${definition.key} received an invalid 16-bit Modbus word.`, definition);
    }
  });
}

function registersToBuffer(rawValues, definition) {
  assertRegisterWords(rawValues, definition);

  const words = definition.wordOrder === WORD_ORDERS.LITTLE_ENDIAN ? [...rawValues].reverse() : rawValues;
  const buffer = Buffer.alloc(words.length * 2);

  words.forEach((word, index) => {
    buffer.writeUInt16BE(word, index * 2);
    if (definition.byteOrder === BYTE_ORDERS.LITTLE_ENDIAN) {
      const byteOffset = index * 2;
      const firstByte = buffer[byteOffset];
      buffer[byteOffset] = buffer[byteOffset + 1];
      buffer[byteOffset + 1] = firstByte;
    }
  });

  return buffer;
}

function decodeNumeric(buffer, dataType, definition) {
  let rawValue;

  switch (dataType) {
    case REGISTER_DATA_TYPES.INT16:
      rawValue = buffer.readInt16BE(0);
      break;
    case REGISTER_DATA_TYPES.UINT16:
      rawValue = buffer.readUInt16BE(0);
      break;
    case REGISTER_DATA_TYPES.INT32:
      rawValue = buffer.readInt32BE(0);
      break;
    case REGISTER_DATA_TYPES.UINT32:
      rawValue = buffer.readUInt32BE(0);
      break;
    case REGISTER_DATA_TYPES.FLOAT32:
      rawValue = buffer.readFloatBE(0);
      break;
    case REGISTER_DATA_TYPES.FLOAT64:
      rawValue = buffer.readDoubleBE(0);
      break;
    default:
      throw new RegisterDecodeError(`${dataType} is not a numeric data type.`, definition);
  }

  if (!Number.isFinite(rawValue)) {
    throw new RegisterDecodeError(`${definition.key} decoded to a non-finite numeric value.`, definition);
  }

  const value = rawValue * definition.scaleFactor + definition.offset;
  if (!Number.isFinite(value)) {
    throw new RegisterDecodeError(`${definition.key} scaling produced a non-finite numeric value.`, definition);
  }

  return { rawValue, value };
}

function decodeBit(rawValues, definition) {
  if (!Array.isArray(rawValues) || rawValues.length !== 1) {
    throw new RegisterDecodeError(`${definition.key} requires exactly one raw bit or register value.`, definition);
  }

  if ([REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(definition.registerType)) {
    if (typeof rawValues[0] !== 'boolean') {
      throw new RegisterDecodeError(`${definition.key} received an invalid raw coil/discrete-input value.`, definition);
    }
    return { rawValue: rawValues[0], value: rawValues[0] };
  }

  assertRegisterWords(rawValues, definition);
  const rawValue = (rawValues[0] & (1 << definition.bitIndex)) !== 0;
  return { rawValue, value: rawValue };
}

function decodeString(buffer) {
  const rawValue = buffer.toString('utf8').replace(/\0/g, '').trim();
  return { rawValue, value: rawValue };
}

function decodeRegister(definition, rawValues) {
  const normalizedDefinition = {
    ...definition,
    scaleFactor: definition.scaleFactor ?? 1,
    offset: definition.offset ?? 0,
    byteOrder: definition.byteOrder || BYTE_ORDERS.BIG_ENDIAN,
    wordOrder: definition.wordOrder || WORD_ORDERS.BIG_ENDIAN,
    bitIndex: definition.bitIndex ?? 0,
  };

  let decoded;
  if (normalizedDefinition.dataType === REGISTER_DATA_TYPES.BIT) {
    decoded = decodeBit(rawValues, normalizedDefinition);
  } else {
    const buffer = registersToBuffer(rawValues, normalizedDefinition);
    decoded = normalizedDefinition.dataType === REGISTER_DATA_TYPES.STRING
      ? decodeString(buffer)
      : decodeNumeric(buffer, normalizedDefinition.dataType, normalizedDefinition);
  }

  return {
    registerKey: normalizedDefinition.key,
    registerName: normalizedDefinition.name,
    registerType: normalizedDefinition.registerType,
    address: normalizedDefinition.address,
    dataType: normalizedDefinition.dataType,
    group: normalizedDefinition.group,
    unit: normalizedDefinition.unit,
    rawValue: decoded.rawValue,
    rawValues: [...rawValues],
    value: decoded.value,
    quality: 'GOOD',
  };
}

module.exports = {
  RegisterDecodeError,
  decodeRegister,
  registersToBuffer,
};
