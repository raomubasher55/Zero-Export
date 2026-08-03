'use strict';

const ModbusRTU = require('modbus-serial');
const { SimulatorDevice, waitForServer } = require('./simulator-device');
const { EM500_PROFILE } = require('../seed/em500.profile');
const { HUAWEI_SUN2000_PROFILE } = require('../seed/huawei-sun2000.profile');
const { SOLIS_PROFILE } = require('../seed/solis-inverter.profile');

/**
 * Simulator farm: one or more Modbus TCP slaves.
 *
 * Devices that share the same host:port are served by ONE shared TCP server
 * and are distinguished by unit ID — exactly like an RS485 bus bridged over
 * TCP. Default layout: EM500 meter (15020/unit 1), Huawei SUN2000 inverter
 * (15021/unit 2), Solis inverter (15022/unit 3); any of them can be moved to
 * the same port via the UI/API as long as unit IDs stay unique.
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
  solis: new SimulatorDevice({
    key: 'solis',
    deviceType: 'Solis inverter',
    profile: SOLIS_PROFILE,
    defaultConfiguration: {
      host: '0.0.0.0',
      port: 15022,
      unitId: 3,
      updateIntervalMs: 1000,
      options: {
        ratingKw: 100,
        availabilityPct: 80,
        loadKw: 100,
      },
    },
  }),
});

// host:port -> { server, devices: Set }
const sharedServers = new Map();

function getDevice(key) {
  return simulatorDevices[key] || null;
}

function portKeyOf(device) {
  const status = device.getStatus();
  return `${status.host}:${status.port}`;
}

function modbusError(message, modbusErrorCode = 0x04) {
  const error = new Error(message);
  error.modbusErrorCode = modbusErrorCode;
  return error;
}

/** Build a server vector that dispatches every request to the device whose
 *  configured unit ID matches the request, like a shared RS485 bus. */
function buildSharedVector(devices) {
  const byUnit = new Map(devices.map((device) => [device.configuration.unitId, device]));

  const call = (fnName, args) => {
    const unitId = args[args.length - 1];
    const device = byUnit.get(unitId) || (unitId === 0 ? devices[0] : undefined);
    if (!device) {
      throw modbusError(`No simulated device on unit ${unitId}.`, 0x0b);
    }
    return device.createVector()[fnName](...args);
  };

  return {
    getCoil: (...args) => call('getCoil', args),
    getDiscreteInput: (...args) => call('getDiscreteInput', args),
    getHoldingRegister: (...args) => call('getHoldingRegister', args),
    getInputRegister: (...args) => call('getInputRegister', args),
    getMultipleHoldingRegisters: (...args) => call('getMultipleHoldingRegisters', args),
    getMultipleInputRegisters: (...args) => call('getMultipleInputRegisters', args),
    setCoil: (...args) => call('setCoil', args),
    setRegister: (...args) => call('setRegister', args),
    setRegisterArray: (...args) => call('setRegisterArray', args),
    readDeviceIdentification: () => devices[0]?.createVector().readDeviceIdentification(),
  };
}

function closeSharedServer(key) {
  const entry = sharedServers.get(key);
  if (!entry) return Promise.resolve();
  sharedServers.delete(key);
  return new Promise((resolve) => {
    try {
      entry.server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

/** Start one shared TCP server for a group of devices on the same host:port. */
async function startSharedGroup(devices) {
  if (devices.length === 0) return;

  // Release any self-owned servers first.
  await Promise.all(devices.map((device) => device.stop()));

  const key = portKeyOf(devices[0]);

  // Unit IDs must be unique within a shared port.
  const units = new Set();
  for (const device of devices) {
    const unitId = device.configuration.unitId;
    if (units.has(unitId)) {
      throw new Error(
        `Duplicate unit ID ${unitId} on shared port ${key}. Use different unit IDs on the same port.`,
      );
    }
    units.add(unitId);
  }

  await closeSharedServer(key);

  const vector = buildSharedVector(devices);
  const server = new ModbusRTU.ServerTCP(vector, {
    host: devices[0].configuration.host,
    port: devices[0].configuration.port,
    unitID: 255, // respond to every unit ID; the vector dispatches
  });
  await waitForServer(server);

  const attached = new Set();
  sharedServers.set(key, { server, devices: attached });
  for (const device of devices) {
    device.attachSharedServer(server);
    attached.add(device);
  }
}

/** Group every farm device by host:port and start one shared server per port. */
async function startAll() {
  const groups = new Map();
  for (const device of Object.values(simulatorDevices)) {
    const groupKey = portKeyOf(device);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(device);
  }
  for (const devices of groups.values()) {
    await startSharedGroup(devices);
  }
  return getStatus();
}

async function stopAll() {
  // Stop ticks for every device, then close the shared servers.
  await Promise.all(Object.values(simulatorDevices).map((device) => device.stop()));
  await Promise.all([...sharedServers.keys()].map((key) => closeSharedServer(key)));
  return getStatus();
}

/** Start the shared server of the port group this device belongs to. */
async function startDevice(key) {
  const device = getDevice(key);
  if (!device) return getStatus();
  const groupKey = portKeyOf(device);
  const group = Object.values(simulatorDevices).filter(
    (candidate) => portKeyOf(candidate) === groupKey,
  );
  await startSharedGroup(group);
  return getStatus();
}

/** Stop one device; the shared server stays up while other devices on the
 *  same port are still running and closes when the last one stops. */
async function stopDevice(key) {
  const device = getDevice(key);
  if (!device) return getStatus();
  const groupKey = portKeyOf(device);
  await device.stop();
  const entry = sharedServers.get(groupKey);
  if (entry) {
    entry.devices.delete(device);
    const stillRunning = [...entry.devices].some(
      (candidate) => candidate.getStatus().state === 'RUNNING',
    );
    if (!stillRunning) {
      await closeSharedServer(groupKey);
    }
  }
  return getStatus();
}

/** Apply persisted settings (port, unit ID, options) to every device. */
async function applyPersistedSettings(settingsRepository) {
  const results = [];
  for (const key of Object.keys(simulatorDevices)) {
    try {
      const saved = await settingsRepository.get(key);
      if (saved) {
        const { key: ignoredKey, createdAt, updatedAt, _id, ...settings } = saved;
        void ignoredKey; void createdAt; void updatedAt; void _id;
        simulatorDevices[key].configure(settings);
        results.push({ key, applied: true });
      } else {
        results.push({ key, applied: false });
      }
    } catch (error) {
      results.push({ key, applied: false, error: error.message });
    }
  }
  return results;
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

module.exports = {
  applyPersistedSettings,
  buildSharedVector,
  getDevice,
  getStatus,
  getValues,
  sharedServers,
  simulatorDevices,
  startAll,
  startDevice,
  stopAll,
  stopDevice,
};
