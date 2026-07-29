'use strict';

const express = require('express');
const PollingController = require('../controllers/polling.controller');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();
const pollingController = new PollingController();

router.route('/status').get(asyncHandler(pollingController.getSchedulerStatus));

module.exports = router;
