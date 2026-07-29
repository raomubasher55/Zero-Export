'use strict';

const HTTP_STATUS = require('../constants/http-status');
const ERROR_CODES = require('../constants/error-codes');
const AppError = require('../utils/app-error');

function formatIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'request',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Parses route input once and exposes trusted, normalized data through
 * req.validated. Controllers must never consume unvalidated req.body/query.
 */
function validateRequest(schemas) {
  return (req, _res, next) => {
    const validated = {};

    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        return next(
          new AppError('Request validation failed.', {
            statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
            code: ERROR_CODES.VALIDATION_ERROR,
            details: formatIssues(result.error.issues),
          }),
        );
      }

      validated[source] = result.data;
    }

    req.validated = Object.freeze(validated);
    return next();
  };
}

module.exports = validateRequest;
