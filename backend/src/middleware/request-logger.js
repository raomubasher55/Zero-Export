'use strict';

const { config } = require('../config/environment');
const logger = require('../config/logger');

function shouldLogRequest(req) {
  return config.logging.logHealthRequests || !['/health', '/ready'].includes(req.path);
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (!shouldLogRequest(req)) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('HTTP request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  });

  next();
}

module.exports = requestLogger;
