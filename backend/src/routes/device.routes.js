'use strict';

const express = require('express');
const DeviceController = require('../controllers/device.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const {
  createDeviceBodySchema,
  deviceIdParamSchema,
  listDevicesQuerySchema,
  updateDeviceBodySchema,
} = require('../validators/device.validator');

const router = express.Router();
const deviceController = new DeviceController();

router
  .route('/')
  .get(validateRequest({ query: listDevicesQuerySchema }), asyncHandler(deviceController.list))
  .post(validateRequest({ body: createDeviceBodySchema }), asyncHandler(deviceController.create));

router
  .route('/:deviceId')
  .get(validateRequest({ params: deviceIdParamSchema }), asyncHandler(deviceController.getById))
  .patch(
    validateRequest({ params: deviceIdParamSchema, body: updateDeviceBodySchema }),
    asyncHandler(deviceController.update),
  )
  .delete(validateRequest({ params: deviceIdParamSchema }), asyncHandler(deviceController.delete));

module.exports = router;
