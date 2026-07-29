'use strict';

const express = require('express');
const ModbusController = require('../controllers/modbus.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const {
  deviceIdParamSchema,
  readModbusBodySchema,
  writeModbusBodySchema,
} = require('../validators/modbus.validator');

const router = express.Router();
const modbusController = new ModbusController();

router
  .route('/:deviceId/connection')
  .get(validateRequest({ params: deviceIdParamSchema }), asyncHandler(modbusController.getConnectionStatus))
  .post(validateRequest({ params: deviceIdParamSchema }), asyncHandler(modbusController.connect))
  .delete(validateRequest({ params: deviceIdParamSchema }), asyncHandler(modbusController.disconnect));

router
  .route('/:deviceId/modbus/read')
  .post(
    validateRequest({ params: deviceIdParamSchema, body: readModbusBodySchema }),
    asyncHandler(modbusController.read),
  );

router
  .route('/:deviceId/modbus/write')
  .post(
    validateRequest({ params: deviceIdParamSchema, body: writeModbusBodySchema }),
    asyncHandler(modbusController.write),
  );

module.exports = router;
