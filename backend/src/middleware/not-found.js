'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const AppError = require('../utils/app-error');

function notFound(req, _res, next) {
  next(
    new AppError(`Route ${req.method} ${req.originalUrl} was not found.`, {
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.NOT_FOUND,
    }),
  );
}

module.exports = notFound;
