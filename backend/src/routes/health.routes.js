'use strict';

const express = require('express');
const HTTP_STATUS = require('../constants/http-status');
const { getDatabaseStatus } = require('../config/database');

const router = express.Router();

function buildHealthPayload() {
  return {
    success: true,
    data: {
      service: 'zero-export-modbus-core',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      database: getDatabaseStatus(),
    },
  };
}

/** Liveness probe: confirms that the Node.js process can serve HTTP. */
router.get('/health', (_req, res) => {
  res.status(HTTP_STATUS.OK).json(buildHealthPayload());
});

/** Readiness probe: confirms that the API can reach its required datastore. */
router.get('/ready', (_req, res) => {
  const payload = buildHealthPayload();
  const statusCode = payload.data.database.connected
    ? HTTP_STATUS.OK
    : HTTP_STATUS.SERVICE_UNAVAILABLE;

  res.status(statusCode).json({
    ...payload,
    success: statusCode === HTTP_STATUS.OK,
  });
});

module.exports = router;
