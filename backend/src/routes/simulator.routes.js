'use strict';

const express = require('express');
const SimulatorController = require('../controllers/simulator.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const {
  simulatorDeviceKeyParamSchema,
  simulatorDeviceUpdateSchema,
  simulatorValuesQuerySchema,
} = require('../validators/simulator.validator');

const router = express.Router();
const simulatorController = new SimulatorController();

router.get('/', asyncHandler(simulatorController.get));
router.get(
  '/values',
  validateRequest({ query: simulatorValuesQuerySchema }),
  asyncHandler(simulatorController.getValues),
);

router.put(
  '/devices/:deviceKey',
  validateRequest({
    params: simulatorDeviceKeyParamSchema,
    body: simulatorDeviceUpdateSchema,
  }),
  asyncHandler(simulatorController.updateDevice),
);
router.post(
  '/devices/:deviceKey/start',
  validateRequest({ params: simulatorDeviceKeyParamSchema }),
  asyncHandler(simulatorController.startDevice),
);
router.post(
  '/devices/:deviceKey/stop',
  validateRequest({ params: simulatorDeviceKeyParamSchema }),
  asyncHandler(simulatorController.stopDevice),
);

module.exports = router;
