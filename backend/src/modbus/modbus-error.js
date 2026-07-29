'use strict';

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ENXIO',
  'EIO',
  'PORT_NOT_OPEN',
]);

class ModbusTransportError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);

    this.name = 'ModbusTransportError';
    this.code = options.code || 'MODBUS_OPERATION_ERROR';
    this.retryable = options.retryable ?? false;
    this.originalError = options.cause;
    this.operation = options.operation;

    Error.captureStackTrace(this, this.constructor);
  }
}

function errorCode(error) {
  return error?.code || error?.errno;
}

function isTimeoutError(error) {
  const code = errorCode(error);
  return code === 'ETIMEDOUT' || /timed?\s*out|timeout/i.test(error?.message || '');
}

function isConnectionError(error) {
  const code = errorCode(error);
  return (
    CONNECTION_ERROR_CODES.has(code) ||
    /port not open|socket hang up|connection (?:closed|refused|reset)|serialport/i.test(error?.message || '')
  );
}

function isRetryableModbusError(error) {
  if (error instanceof ModbusTransportError) {
    return error.retryable;
  }

  return isTimeoutError(error) || isConnectionError(error) || [5, 6, 10, 11].includes(error?.modbusCode);
}

function toTransportError(error, operation) {
  if (error instanceof ModbusTransportError) {
    return error;
  }

  if (isTimeoutError(error)) {
    return new ModbusTransportError('Modbus request timed out.', {
      code: 'MODBUS_TIMEOUT',
      retryable: true,
      cause: error,
      operation,
    });
  }

  if (isConnectionError(error)) {
    return new ModbusTransportError('Modbus transport connection is unavailable.', {
      code: 'MODBUS_CONNECTION_ERROR',
      retryable: true,
      cause: error,
      operation,
    });
  }

  if (error?.modbusCode !== undefined) {
    return new ModbusTransportError('The Modbus device rejected the operation.', {
      code: 'MODBUS_EXCEPTION',
      retryable: [5, 6, 10, 11].includes(error.modbusCode),
      cause: error,
      operation,
    });
  }

  return new ModbusTransportError('Modbus operation failed.', {
    code: 'MODBUS_OPERATION_ERROR',
    retryable: false,
    cause: error,
    operation,
  });
}

module.exports = {
  ModbusTransportError,
  errorCode,
  isConnectionError,
  isRetryableModbusError,
  isTimeoutError,
  toTransportError,
};
