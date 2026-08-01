'use strict';

const express = require('express');
const SimulatorController = require('../controllers/simulator.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const { simulatorConfigurationSchema } = require('../validators/simulator.validator');

const router = express.Router();
const simulatorController = new SimulatorController();

router.get('/', asyncHandler(simulatorController.get));
router.get('/values', asyncHandler(simulatorController.getValues));
router.put(
  '/',
  validateRequest({ body: simulatorConfigurationSchema }),
  asyncHandler(simulatorController.update),
);
router.post('/start', asyncHandler(simulatorController.start));
router.post('/stop', asyncHandler(simulatorController.stop));

module.exports = router;
