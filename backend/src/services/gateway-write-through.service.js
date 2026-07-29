'use strict';

const { REGISTER_DATA_TYPES, REGISTER_TYPES } = require('../constants/modbus');
const { COMMUNICATION_SOURCES } = require('../models/communication-log.model');
const { encodeRegister } = require('../modbus/register-encoder');
const DeviceRepository = require('../repositories/device.repository');
const ModbusOperationService = require('./modbus-operation.service');

class GatewayWriteThroughService {
  constructor(options = {}) {
    this.deviceRepository = options.deviceRepository || new DeviceRepository();
    this.modbusOperationService = options.modbusOperationService || new ModbusOperationService();
  }

  async write(mapping, engineeringValue) {
    const sourceDevice = await this.deviceRepository.findByIdForPolling(mapping.sourceDeviceId);
    if (!sourceDevice) {
      throw new Error('The write-through source device no longer exists.');
    }

    const sourceDefinition = sourceDevice.registerProfile?.registers?.find(
      (register) => register.key === mapping.sourceRegisterKey,
    );
    if (!sourceDefinition) {
      throw new Error(`Source register ${mapping.sourceRegisterKey} no longer exists.`);
    }
    if (!sourceDefinition.writable) {
      throw new Error(`Source register ${mapping.sourceRegisterKey} is not marked writable.`);
    }
    if (![REGISTER_TYPES.COIL, REGISTER_TYPES.HOLDING].includes(sourceDefinition.registerType)) {
      throw new Error(`Source register area ${sourceDefinition.registerType} does not accept writes.`);
    }

    let values;
    if (
      sourceDefinition.dataType === REGISTER_DATA_TYPES.BIT &&
      sourceDefinition.registerType === REGISTER_TYPES.HOLDING
    ) {
      const current = await this.modbusOperationService.read(
        String(sourceDevice._id),
        {
          registerType: REGISTER_TYPES.HOLDING,
          address: sourceDefinition.address,
          quantity: 1,
        },
        COMMUNICATION_SOURCES.GATEWAY,
      );
      const mask = 1 << (sourceDefinition.bitIndex ?? 0);
      const currentWord = current.values[0];
      values = [engineeringValue ? currentWord | mask : currentWord & ~mask];
    } else {
      values = encodeRegister(sourceDefinition, engineeringValue).rawValues;
    }

    await this.modbusOperationService.write(
      String(sourceDevice._id),
      {
        registerType: sourceDefinition.registerType,
        address: sourceDefinition.address,
        values,
      },
      COMMUNICATION_SOURCES.GATEWAY,
    );

    return { values };
  }
}

module.exports = GatewayWriteThroughService;
