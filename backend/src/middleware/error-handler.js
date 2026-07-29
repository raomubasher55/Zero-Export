'use strict';

const { config } = require('../config/environment');
const logger = require('../config/logger');
const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const AppError = require('../utils/app-error');

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error.name === 'ValidationError') {
    return new AppError('Request validation failed.', {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      code: ERROR_CODES.VALIDATION_ERROR,
      details: Object.values(error.errors).map((entry) => ({
        field: entry.path,
        message: entry.message,
      })),
    });
  }

  if (error.name === 'CastError') {
    return new AppError(`Invalid value for "${error.path}".`, {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.BAD_REQUEST,
    });
  }

  if (error.name === 'StrictModeError') {
    return new AppError('Request contains unsupported resource properties.', {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  }

  if (error.type === 'entity.too.large' || error.status === HTTP_STATUS.PAYLOAD_TOO_LARGE) {
    return new AppError('Request body exceeds the configured size limit.', {
      statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE,
      code: ERROR_CODES.PAYLOAD_TOO_LARGE,
    });
  }

  if (error.code === 11000) {
    return new AppError('A resource with that unique value already exists.', {
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.CONFLICT,
    });
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return new AppError('Malformed JSON request body.', {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.BAD_REQUEST,
    });
  }

  return new AppError('An unexpected internal error occurred.', {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_ERROR,
    isOperational: false,
  });
}

function errorHandler(error, req, res, _next) {
  const normalizedError = normalizeError(error);
  const isServerError = normalizedError.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR;

  logger[isServerError ? 'error' : 'warn']('HTTP request failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: normalizedError.statusCode,
    code: normalizedError.code,
    error: error.stack || error.message,
  });

  const payload = {
    success: false,
    error: {
      code: normalizedError.code,
      message: normalizedError.message,
      requestId: req.requestId,
    },
  };

  if (normalizedError.details) {
    payload.error.details = normalizedError.details;
  }

  if (!config.isProduction && !normalizedError.isOperational) {
    payload.error.stack = error.stack;
  }

  res.status(normalizedError.statusCode).json(payload);
}

module.exports = errorHandler;
