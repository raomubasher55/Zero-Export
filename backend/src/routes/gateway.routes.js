'use strict';

const express = require('express');
const GatewayController = require('../controllers/gateway.controller');
const gatewayTrafficRoutes = require('./gateway-traffic.routes');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const {
  gatewayConfigurationSchema,
  generateMappingsSchema,
} = require('../validators/gateway.validator');

const router = express.Router();
const gatewayController = new GatewayController();

router.use('/traffic', gatewayTrafficRoutes);

router.post(
  '/mappings/generate',
  validateRequest({ body: generateMappingsSchema }),
  asyncHandler(gatewayController.generateMappings),
);

router
  .route('/')
  .get(asyncHandler(gatewayController.get))
  .put(validateRequest({ body: gatewayConfigurationSchema }), asyncHandler(gatewayController.update));
router.post('/start', asyncHandler(gatewayController.start));
router.post('/stop', asyncHandler(gatewayController.stop));

module.exports = router;
