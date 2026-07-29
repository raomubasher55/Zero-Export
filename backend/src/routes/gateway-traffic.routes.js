'use strict';

const express = require('express');
const GatewayTrafficController = require('../controllers/gateway-traffic.controller');
const validateRequest = require('../middleware/validate-request');
const {
  exportQuerySchema,
  interpretationSchema,
  trafficQuerySchema,
  trafficSettingsSchema,
} = require('../validators/gateway-traffic.validator');

const router = express.Router();
const controller = new GatewayTrafficController();

router.get('/', validateRequest({ query: trafficQuerySchema }), controller.list);
router.get('/analysis', controller.analysis);
router.patch('/settings', validateRequest({ body: trafficSettingsSchema }), controller.updateSettings);
router.delete('/', controller.clear);
router.post('/interpret', validateRequest({ body: interpretationSchema }), controller.interpret);
router.get('/export', validateRequest({ query: exportQuerySchema }), controller.export);

module.exports = router;
