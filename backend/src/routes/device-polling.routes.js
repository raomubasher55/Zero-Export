'use strict';

const express = require('express');
const PollingController = require('../controllers/polling.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const { deviceIdParamSchema } = require('../validators/monitoring.validator');

const router = express.Router();
const pollingController = new PollingController();

router
  .route('/:deviceId/poll')
  .post(validateRequest({ params: deviceIdParamSchema }), asyncHandler(pollingController.pollNow));

module.exports = router;
