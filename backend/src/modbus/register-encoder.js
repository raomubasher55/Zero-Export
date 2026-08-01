'use strict';

const {
  BYTE_ORDERS,
  REGISTER_DATA_TYPES,
  REGISTER_TYPES,
  WORD_ORDERS,
} = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

class RegisterEncodeError extends Error {
  constructor(message, definition) {
    super(message);
    this.name = 'RegisterEncodeError';
    this.registerKey = definition?.key;
    Error.captureStackTrace(this, this.constructor);
  }
}

function normalizedDefinition(definition) {
  return {
    ...definition,
    scaleFactor: definition.scaleFactor ?? 1,
    offset: definition.offset ?? 0,
    byteOrder: definition.byteOrder || BYTE_ORDERS.BIG_ENDIAN,
    wordOrder: definition.wordOrder || WORD_ORDERS.BIG_ENDIAN,
    bitIndex: definition.bitIndex ?? 0,
    length: definition.length || expectedWordLength(definition.dataType),
  };
}

function engineeringToRaw(value, definition) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new RegisterEncodeError(`${definition.key} requires a finite numeric value.`, definition);
  }

  const rawValue = (numericValue - definition.offset) / definition.scaleFactor;
  if (!Number.isFinite(rawValue)) {
    throw new RegisterEncodeError(`${definition.key} inverse scaling produced a non-finite value.`, definition);
  }

  return rawValue;
}

function writeNumeric(buffer, dataType, rawValue, definition) {
  const integerType = [
    REGISTER_DATA_TYPES.INT16,
    REGISTER_DATA_TYPES.UINT16,
    REGISTER_DATA_TYPES.INT32,
    REGISTER_DATA_TYPES.UINT32,
    REGISTER_DATA_TYPES.INT64,
    REGISTER_DATA_TYPES.UINT64,
  ].includes(dataType);
  const value = integerType ? Math.round(rawValue) : rawValue;

  if (integerType && Math.abs(rawValue - value) > 1e-6) {
    throw new RegisterEncodeError(
      `${definition.key} cannot represent ${rawValue} as ${dataType} without losing precision.`,
      definition,
    );
  }

  try {
    switch (dataType) {
      case REGISTER_DATA_TYPES.INT16:
        buffer.writeInt16BE(value, 0);
        break;
      case REGISTER_DATA_TYPES.UINT16:
        buffer.writeUInt16BE(value, 0);
        break;
      case REGISTER_DATA_TYPES.INT32:
        buffer.writeInt32BE(value, 0);
        break;
      case REGISTER_DATA_TYPES.UINT32:
        buffer.writeUInt32BE(value, 0);
        break;
      case REGISTER_DATA_TYPES.INT64:
        buffer.writeBigInt64BE(BigInt(Math.round(value)), 0);
        break;
      case REGISTER_DATA_TYPES.UINT64:
        buffer.writeBigUInt64BE(BigInt(Math.round(value)), 0);
        break;
      case REGISTER_DATA_TYPES.FLOAT32:
        buffer.writeFloatBE(value, 0);
        break;
      case REGISTER_DATA_TYPES.FLOAT64:
        buffer.writeDoubleBE(value, 0);
        break;
      default:
        throw new RegisterEncodeError(`${dataType} is not a numeric data type.`, definition);
    }
  } catch (error) {
    if (error instanceof RegisterEncodeError) {
      throw error;
    }
    throw new RegisterEncodeError(
      `${definition.key} value ${value} is outside the range supported by ${dataType}.`,
      definition,
    );
  }
}

function bufferToRegisters(buffer, definition) {
  let words = [];
  for (let offset = 0; offset < buffer.length; offset += 2) {
    let word = buffer.readUInt16BE(offset);
    if (definition.byteOrder === BYTE_ORDERS.LITTLE_ENDIAN) {
      word = ((word & 0xff) << 8) | ((word >> 8) & 0xff);
    }
    words.push(word);
  }

  if (definition.wordOrder === WORD_ORDERS.LITTLE_ENDIAN) {
    words = words.reverse();
  }

  return words;
}

function encodeRegister(definition, engineeringValue) {
  const normalized = normalizedDefinition(definition);

  if (normalized.dataType === REGISTER_DATA_TYPES.BIT) {
    const value = Boolean(engineeringValue);
    if ([REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(normalized.registerType)) {
      return { rawValue: value, rawValues: [value] };
    }

    const word = value ? 1 << normalized.bitIndex : 0;
    return { rawValue: value, rawValues: [word] };
  }

  const byteLength = normalized.length * 2;
  const buffer = Buffer.alloc(byteLength);
  let rawValue;

  if (normalized.dataType === REGISTER_DATA_TYPES.STRING) {
    rawValue = String(engineeringValue ?? '');
    const encoded = Buffer.from(rawValue, 'utf8');
    if (encoded.length > byteLength) {
      throw new RegisterEncodeError(
        `${normalized.key} string exceeds its configured ${byteLength}-byte capacity.`,
        normalized,
      );
    }
    encoded.copy(buffer);
  } else {
    rawValue = engineeringToRaw(engineeringValue, normalized);
    writeNumeric(buffer, normalized.dataType, rawValue, normalized);
  }

  return {
    rawValue,
    rawValues: bufferToRegisters(buffer, normalized),
  };
}

module.exports = {
  RegisterEncodeError,
  bufferToRegisters,
  encodeRegister,
};
