'use strict';

const express = require('express');
const ZeroExportController = require('../controllers/zero-export.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const { zeroExportConfigurationSchema } = require('../validators/zero-export.validator');

const router = express.Router();
const zeroExportController = new ZeroExportController();

router
  .route('/')
  .get(asyncHandler(zeroExportController.get))
  .put(
    validateRequest({ body: zeroExportConfigurationSchema }),
    asyncHandler(zeroExportController.update),
  );
router.post('/start', asyncHandler(zeroExportController.start));
router.post('/stop', asyncHandler(zeroExportController.stop));

module.exports = router;
