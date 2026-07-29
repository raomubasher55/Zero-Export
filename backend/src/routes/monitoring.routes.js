'use strict';

const express = require('express');
const MonitoringController = require('../controllers/monitoring.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const {
  communicationLogsQuerySchema,
  deviceIdParamSchema,
  deviceRegisterParamSchema,
  latestValuesQuerySchema,
} = require('../validators/monitoring.validator');

const router = express.Router();
const monitoringController = new MonitoringController();

router
  .route('/:deviceId/values')
  .get(
    validateRequest({ params: deviceIdParamSchema, query: latestValuesQuerySchema }),
    asyncHandler(monitoringController.listLatestValues),
  );

router
  .route('/:deviceId/values/:registerKey')
  .get(
    validateRequest({ params: deviceRegisterParamSchema }),
    asyncHandler(monitoringController.getLatestValue),
  );

router
  .route('/:deviceId/communication-logs')
  .get(
    validateRequest({ params: deviceIdParamSchema, query: communicationLogsQuerySchema }),
    asyncHandler(monitoringController.listCommunicationLogs),
  );

module.exports = router;
