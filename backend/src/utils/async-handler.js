'use strict';

/**
 * Passes rejected promises from Express route handlers to the centralized
 * error middleware. Express 4 does not do this automatically.
 */
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

module.exports = asyncHandler;
