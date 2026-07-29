'use strict';

const express = require('express');
const SystemController = require('../controllers/system.controller');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();
const controller = new SystemController();

router.get('/', asyncHandler(controller.getSnapshot));

module.exports = router;
