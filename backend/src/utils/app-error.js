'use strict';

class AppError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = options.statusCode || 500;
    this.code = options.code || 'INTERNAL_ERROR';
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
