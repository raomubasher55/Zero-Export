'use strict';

const express = require('express');
const GatewayController = require('../controllers/gateway.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const { gatewayConfigurationSchema } = require('../validators/gateway.validator');

const router = express.Router();
const gatewayController = new GatewayController();

router
  .route('/')
  .get(asyncHandler(gatewayController.get))
  .put(validateRequest({ body: gatewayConfigurationSchema }), asyncHandler(gatewayController.update));
router.post('/start', asyncHandler(gatewayController.start));
router.post('/stop', asyncHandler(gatewayController.stop));

module.exports = router;
