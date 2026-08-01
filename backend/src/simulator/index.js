'use strict';

const { SimulatorDevice } = require('./simulator-device');
const { EM500_PROFILE } = require('../seed/em500.profile');
const { HUAWEI_SUN2000_PROFILE } = require('../seed/huawei-sun2000.profile');

/**
 * Simulator farm: one Modbus TCP slave per device type.
 *
 * Each device runs on its own TCP port and answers only for its configured
 * unit ID, so a site can be tested with an EM500 grid meter and a Huawei
 * SUN2000 inverter side by side.
 */
const simulatorDevices = Object.freeze({
  em500: new SimulatorDevice({
    key: 'em500',
    deviceType: 'EM500 meter',
    profile: EM500_PROFILE,
    defaultConfiguration: {
      host: '0.0.0.0',
      port: 15020,
      unitId: 1,
      updateIntervalMs: 1000,
      options: {
        loadKw: 100,
      },
    },
  }),
  huawei: new SimulatorDevice({
    key: 'huawei',
    deviceType: 'Huawei SUN2000 inverter',
    profile: HUAWEI_SUN2000_PROFILE,
    defaultConfiguration: {
      host: '0.0.0.0',
      port: 15021,
      unitId: 2,
      updateIntervalMs: 1000,
      options: {
        ratingKw: 100,
        availabilityPct: 80,
        loadKw: 100,
      },
    },
  }),
});

function getDevice(key) {
  return simulatorDevices[key] || null;
}

function getStatus() {
  const devices = {};
  for (const [key, device] of Object.entries(simulatorDevices)) {
    devices[key] = device.getStatus();
  }
  return { devices };
}

function getValues(key) {
  const device = getDevice(key);
  return device ? device.getValues() : [];
}

async function startAll() {
  // Start the inverter first so the coupled meter sees it running on its
  // initial tick and reports grid = load - inverter from the first second.
  await simulatorDevices.huawei.start();
  await simulatorDevices.em500.start();
  return getStatus();
}

async function stopAll() {
  await Promise.all(Object.values(simulatorDevices).map((device) => device.stop()));
  return getStatus();
}

module.exports = {
  getDevice,
  getStatus,
  getValues,
  simulatorDevices,
  startAll,
  stopAll,
};
