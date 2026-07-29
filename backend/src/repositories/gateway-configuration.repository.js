'use strict';

const GatewayConfiguration = require('../models/gateway-configuration.model');
const BaseRepository = require('./base.repository');

const DEFAULT_CONFIGURATION = Object.freeze({
  key: 'primary',
  enabled: false,
  unitId: 1,
  tcp: Object.freeze({
    enabled: true,
    host: '0.0.0.0',
    port: 1502,
  }),
  rtu: Object.freeze({
    enabled: false,
    serialPath: '/dev/ttyUSB1',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  }),
  mappings: Object.freeze([]),
});

function defaultConfiguration() {
  return {
    ...DEFAULT_CONFIGURATION,
    tcp: { ...DEFAULT_CONFIGURATION.tcp },
    rtu: { ...DEFAULT_CONFIGURATION.rtu },
    mappings: [],
  };
}

function configurationPayload(configuration) {
  return {
    enabled: configuration.enabled,
    unitId: configuration.unitId,
    tcp: configuration.tcp,
    rtu: configuration.rtu,
    mappings: configuration.mappings,
  };
}

class GatewayConfigurationRepository extends BaseRepository {
  constructor() {
    super(GatewayConfiguration);
  }

  async get() {
    return this.model.findOne({ key: 'primary' }).lean().exec();
  }

  async getOrDefault() {
    return (await this.get()) || defaultConfiguration();
  }

  async save(configuration) {
    return this.model
      .findOneAndUpdate(
        { key: 'primary' },
        {
          $set: configurationPayload(configuration),
          $setOnInsert: { key: 'primary' },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
  }

  async setEnabled(enabled) {
    return this.model
      .findOneAndUpdate(
        { key: 'primary' },
        {
          $set: { enabled },
          $setOnInsert: {
            key: 'primary',
            unitId: DEFAULT_CONFIGURATION.unitId,
            tcp: DEFAULT_CONFIGURATION.tcp,
            rtu: DEFAULT_CONFIGURATION.rtu,
            mappings: [],
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
  }
}

module.exports = {
  DEFAULT_CONFIGURATION,
  GatewayConfigurationRepository,
  defaultConfiguration,
};
