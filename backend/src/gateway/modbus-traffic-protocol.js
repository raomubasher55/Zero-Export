'use strict';

const FUNCTION_DETAILS = Object.freeze({
  1: { name: 'Read Coils', operation: 'READ', registerType: 'COIL' },
  2: { name: 'Read Discrete Inputs', operation: 'READ', registerType: 'DISCRETE_INPUT' },
  3: { name: 'Read Holding Registers', operation: 'READ', registerType: 'HOLDING_REGISTER' },
  4: { name: 'Read Input Registers', operation: 'READ', registerType: 'INPUT_REGISTER' },
  5: { name: 'Write Single Coil', operation: 'WRITE', registerType: 'COIL' },
  6: { name: 'Write Single Register', operation: 'WRITE', registerType: 'HOLDING_REGISTER' },
  15: { name: 'Write Multiple Coils', operation: 'WRITE', registerType: 'COIL' },
  16: { name: 'Write Multiple Registers', operation: 'WRITE', registerType: 'HOLDING_REGISTER' },
  17: { name: 'Report Server ID', operation: 'OTHER' },
  43: { name: 'Read Device Identification', operation: 'OTHER' },
});

const EXCEPTION_NAMES = Object.freeze({
  1: 'Illegal function',
  2: 'Illegal data address',
  3: 'Illegal data value',
  4: 'Slave device failure',
  5: 'Acknowledge',
  6: 'Slave device busy',
  8: 'Memory parity error',
  10: 'Gateway path unavailable',
  11: 'Gateway target failed to respond',
});

const REFERENCE_BASES = Object.freeze({
  COIL: 1,
  DISCRETE_INPUT: 10001,
  INPUT_REGISTER: 30001,
  HOLDING_REGISTER: 40001,
});

function toHex(buffer) {
  return Buffer.from(buffer).toString('hex').match(/.{1,2}/g)?.join(' ').toUpperCase() || '';
}

function registerReference(registerType, address) {
  const base = REFERENCE_BASES[registerType];
  if (base === undefined || !Number.isInteger(address) || address < 0 || address > 9998) {
    return null;
  }
  return String(base + address).padStart(5, '0');
}

function possibleDataTypes(registerType, quantity) {
  if (['COIL', 'DISCRETE_INPUT'].includes(registerType)) {
    return ['BIT'];
  }
  if (!Number.isInteger(quantity) || quantity < 1) return [];
  if (quantity === 1) return ['UINT16', 'INT16', 'BIT_FIELD'];
  if (quantity === 2) return ['UINT32', 'INT32', 'FLOAT32', 'TWO_UINT16_VALUES'];
  if (quantity === 4) return ['FLOAT64', 'FOUR_UINT16_VALUES', 'TWO_32_BIT_VALUES'];
  return [`STRING_${quantity * 2}_BYTES`, `UINT16_ARRAY_${quantity}`];
}

function readBits(buffer, byteOffset, quantity) {
  const values = [];
  for (let index = 0; index < quantity; index += 1) {
    const byte = buffer[byteOffset + Math.floor(index / 8)];
    values.push(Boolean(byte & (1 << (index % 8))));
  }
  return values;
}

function parseRequestPdu(buffer, { unitOffset, functionOffset, transactionId = null }) {
  if (buffer.length <= functionOffset) return null;
  const unitId = buffer.readUInt8(unitOffset);
  const functionCode = buffer.readUInt8(functionOffset);
  const details = FUNCTION_DETAILS[functionCode] || {
    name: `Function ${functionCode}`,
    operation: 'OTHER',
    registerType: null,
  };
  const dataOffset = functionOffset + 1;
  const parsed = {
    transactionId,
    unitId,
    functionCode,
    functionName: details.name,
    operation: details.operation,
    registerType: details.registerType,
    address: null,
    endAddress: null,
    quantity: null,
    requestValues: [],
    possibleDataTypes: [],
    requestHex: toHex(buffer),
  };

  if ([1, 2, 3, 4].includes(functionCode) && buffer.length >= dataOffset + 4) {
    parsed.address = buffer.readUInt16BE(dataOffset);
    parsed.quantity = buffer.readUInt16BE(dataOffset + 2);
  } else if ([5, 6].includes(functionCode) && buffer.length >= dataOffset + 4) {
    parsed.address = buffer.readUInt16BE(dataOffset);
    parsed.quantity = 1;
    const rawValue = buffer.readUInt16BE(dataOffset + 2);
    parsed.requestValues = functionCode === 5 ? [rawValue === 0xff00] : [rawValue];
  } else if ([15, 16].includes(functionCode) && buffer.length >= dataOffset + 5) {
    parsed.address = buffer.readUInt16BE(dataOffset);
    parsed.quantity = buffer.readUInt16BE(dataOffset + 2);
    const byteCount = buffer.readUInt8(dataOffset + 4);
    const valuesOffset = dataOffset + 5;
    const availableBytes = Math.max(0, Math.min(byteCount, buffer.length - valuesOffset));
    if (functionCode === 15) {
      parsed.requestValues = readBits(
        buffer.subarray(0, valuesOffset + availableBytes),
        valuesOffset,
        Math.min(parsed.quantity, availableBytes * 8),
      );
    } else {
      for (let offset = 0; offset + 1 < availableBytes; offset += 2) {
        parsed.requestValues.push(buffer.readUInt16BE(valuesOffset + offset));
      }
    }
  }

  if (parsed.address !== null && parsed.quantity !== null && parsed.quantity > 0) {
    parsed.endAddress = parsed.address + parsed.quantity - 1;
    parsed.registerReference = registerReference(parsed.registerType, parsed.address);
    parsed.possibleDataTypes = possibleDataTypes(parsed.registerType, parsed.quantity);
  } else {
    parsed.registerReference = null;
  }

  return parsed;
}

function parseTcpRequest(buffer) {
  if (buffer.length < 8 || buffer.readUInt16BE(2) !== 0) return null;
  return parseRequestPdu(buffer, {
    unitOffset: 6,
    functionOffset: 7,
    transactionId: buffer.readUInt16BE(0),
  });
}

function parseRtuRequest(buffer) {
  if (buffer.length < 4) return null;
  return parseRequestPdu(buffer, { unitOffset: 0, functionOffset: 1 });
}

function parseResponsePdu(buffer, request, { unitOffset, functionOffset, transactionId = null }) {
  if (!request || buffer.length <= functionOffset) return null;
  const unitId = buffer.readUInt8(unitOffset);
  const responseFunctionCode = buffer.readUInt8(functionOffset);
  const isException = (responseFunctionCode & 0x80) !== 0;
  const functionCode = responseFunctionCode & 0x7f;
  const dataOffset = functionOffset + 1;
  const response = {
    transactionId,
    unitId,
    functionCode,
    success: !isException,
    exceptionCode: null,
    exceptionName: null,
    responseValues: [],
    responseHex: toHex(buffer),
  };

  if (isException) {
    response.exceptionCode = buffer.length > dataOffset ? buffer.readUInt8(dataOffset) : 4;
    response.exceptionName = EXCEPTION_NAMES[response.exceptionCode] || 'Unknown Modbus exception';
    return response;
  }

  if ([1, 2].includes(functionCode) && buffer.length > dataOffset) {
    const byteCount = buffer.readUInt8(dataOffset);
    const available = Math.max(0, Math.min(byteCount, buffer.length - dataOffset - 1));
    response.responseValues = readBits(
      buffer.subarray(0, dataOffset + 1 + available),
      dataOffset + 1,
      Math.min(request.quantity || available * 8, available * 8),
    );
  } else if ([3, 4].includes(functionCode) && buffer.length > dataOffset) {
    const byteCount = buffer.readUInt8(dataOffset);
    const available = Math.max(0, Math.min(byteCount, buffer.length - dataOffset - 1));
    for (let offset = 0; offset + 1 < available; offset += 2) {
      response.responseValues.push(buffer.readUInt16BE(dataOffset + 1 + offset));
    }
  } else if ([5, 6].includes(functionCode) && buffer.length >= dataOffset + 4) {
    const rawValue = buffer.readUInt16BE(dataOffset + 2);
    response.responseValues = functionCode === 5 ? [rawValue === 0xff00] : [rawValue];
  } else if ([15, 16].includes(functionCode) && buffer.length >= dataOffset + 4) {
    response.responseValues = [
      buffer.readUInt16BE(dataOffset),
      buffer.readUInt16BE(dataOffset + 2),
    ];
  }

  return response;
}

function parseTcpResponse(buffer, request) {
  if (buffer.length < 8 || buffer.readUInt16BE(2) !== 0) return null;
  return parseResponsePdu(buffer, request, {
    unitOffset: 6,
    functionOffset: 7,
    transactionId: buffer.readUInt16BE(0),
  });
}

function parseRtuResponse(buffer, request) {
  if (buffer.length < 4) return null;
  return parseResponsePdu(buffer, request, { unitOffset: 0, functionOffset: 1 });
}

function extractTcpFrames(previous, chunk) {
  let buffer = Buffer.concat([previous, chunk]);
  const frames = [];

  while (buffer.length >= 7) {
    const protocolId = buffer.readUInt16BE(2);
    const pduLength = buffer.readUInt16BE(4);
    const frameLength = 6 + pduLength;
    if (protocolId !== 0 || pduLength < 2 || frameLength > 65542) {
      buffer = buffer.subarray(1);
      continue;
    }
    if (buffer.length < frameLength) break;
    frames.push(buffer.subarray(0, frameLength));
    buffer = buffer.subarray(frameLength);
  }

  return { frames, remaining: buffer };
}

module.exports = {
  EXCEPTION_NAMES,
  FUNCTION_DETAILS,
  extractTcpFrames,
  parseRtuRequest,
  parseRtuResponse,
  parseTcpRequest,
  parseTcpResponse,
  possibleDataTypes,
  registerReference,
  toHex,
};
