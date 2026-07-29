'use strict';

const { MODBUS_PROTOCOLS } = require('../constants/modbus');

function getDeviceId(device) {
  const id = device?._id || device?.id;
  if (!id) {
    throw new Error('A persisted device identifier is required for Modbus connection management.');
  }

  return String(id);
}

function buildConnectionKey(connection) {
  if (connection.protocol === MODBUS_PROTOCOLS.TCP) {
    return [
      connection.protocol,
      String(connection.host).trim().toLowerCase(),
      Number(connection.port),
    ].join(':');
  }

  if (connection.protocol === MODBUS_PROTOCOLS.RTU) {
    return [
      connection.protocol,
      connection.serialPath,
      Number(connection.baudRate),
      Number(connection.dataBits),
      Number(connection.stopBits),
      connection.parity,
    ].join(':');
  }

  throw new Error(`Unsupported Modbus protocol: ${connection.protocol}`);
}

function summarizeEndpoint(connection) {
  if (connection.protocol === MODBUS_PROTOCOLS.TCP) {
    return {
      protocol: connection.protocol,
      host: connection.host,
      port: connection.port,
    };
  }

  return {
    protocol: connection.protocol,
    serialPath: connection.serialPath,
    baudRate: connection.baudRate,
    dataBits: connection.dataBits,
    stopBits: connection.stopBits,
    parity: connection.parity,
  };
}

module.exports = {
  buildConnectionKey,
  getDeviceId,
  summarizeEndpoint,
};
