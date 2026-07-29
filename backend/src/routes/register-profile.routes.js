'use strict';

const express = require('express');
const RegisterProfileController = require('../controllers/register-profile.controller');
const validateRequest = require('../middleware/validate-request');
const asyncHandler = require('../utils/async-handler');
const {
  createRegisterProfileBodySchema,
  importRegisterProfilesBodySchema,
  listRegisterProfilesQuerySchema,
  registerProfileIdParamSchema,
  updateRegisterProfileBodySchema,
} = require('../validators/register-profile.validator');

const router = express.Router();
const registerProfileController = new RegisterProfileController();

router.get('/export', asyncHandler(registerProfileController.exportAll));
router.post(
  '/import',
  validateRequest({ body: importRegisterProfilesBodySchema }),
  asyncHandler(registerProfileController.importFile),
);

router
  .route('/')
  .get(validateRequest({ query: listRegisterProfilesQuerySchema }), asyncHandler(registerProfileController.list))
  .post(
    validateRequest({ body: createRegisterProfileBodySchema }),
    asyncHandler(registerProfileController.create),
  );

router.get(
  '/:registerProfileId/export',
  validateRequest({ params: registerProfileIdParamSchema }),
  asyncHandler(registerProfileController.exportById),
);

router
  .route('/:registerProfileId')
  .get(validateRequest({ params: registerProfileIdParamSchema }), asyncHandler(registerProfileController.getById))
  .patch(
    validateRequest({ params: registerProfileIdParamSchema, body: updateRegisterProfileBodySchema }),
    asyncHandler(registerProfileController.update),
  )
  .delete(
    validateRequest({ params: registerProfileIdParamSchema }),
    asyncHandler(registerProfileController.delete),
  );

module.exports = router;
