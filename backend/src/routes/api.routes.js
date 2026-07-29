'use strict';

const express = require('express');
const HTTP_STATUS = require('../constants/http-status');
const deviceRoutes = require('./device.routes');
const modbusRoutes = require('./modbus.routes');
const monitoringRoutes = require('./monitoring.routes');
const devicePollingRoutes = require('./device-polling.routes');
const gatewayRoutes = require('./gateway.routes');
const pollingRoutes = require('./polling.routes');
const registerProfileRoutes = require('./register-profile.routes');

const router = express.Router();

/**
 * API discovery endpoint. Domain routes are added beneath this versioned
 * namespace so clients have a stable compatibility boundary.
 */
router.get('/', (_req, res) => {
  res.status(HTTP_STATUS.OK).json({
    success: true,
    data: {
      service: 'zero-export-modbus-core',
      apiVersion: 'v1',
      status: 'operational',
      resources: {
        devices: '/api/v1/devices',
        registerProfiles: '/api/v1/register-profiles',
        deviceConnection: '/api/v1/devices/:deviceId/connection',
        modbusRead: '/api/v1/devices/:deviceId/modbus/read',
        modbusWrite: '/api/v1/devices/:deviceId/modbus/write',
        pollDevice: '/api/v1/devices/:deviceId/poll',
        latestValues: '/api/v1/devices/:deviceId/values',
        communicationLogs: '/api/v1/devices/:deviceId/communication-logs',
        gateway: '/api/v1/gateway',
        gatewayTraffic: '/api/v1/gateway/traffic',
        pollingStatus: '/api/v1/polling/status',
      },
    },
  });
});

router.use('/devices', deviceRoutes);
router.use('/devices', modbusRoutes);
router.use('/devices', devicePollingRoutes);
router.use('/devices', monitoringRoutes);
router.use('/gateway', gatewayRoutes);
router.use('/polling', pollingRoutes);
router.use('/register-profiles', registerProfileRoutes);

module.exports = router;
