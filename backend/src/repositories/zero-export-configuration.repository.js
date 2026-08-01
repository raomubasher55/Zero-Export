'use strict';

const ZeroExportConfiguration = require('../models/zero-export-configuration.model');
const BaseRepository = require('./base.repository');

const DEFAULT_CONFIGURATION = Object.freeze({
  key: 'primary',
  enabled: false,
  meterDeviceId: null,
  meterRegisterKey: 'eqv_active_power',
  inverterDeviceId: null,
  inverterRegisterKey: 'active_power_derating',
  inverterRegisterAddress: 40125,
  targetGridKw: 0,
  deadbandKw: 0.5,
  stepPerCycle: 20,
  minDerating: 0,
  maxDerating: 1000,
  intervalMs: 5000,
  failsafeDerating: 0,
  failsafeAfterMisses: 3,
  simulation: { enabled: false, loadKw: 100 },
});

function defaultConfiguration() {
  return {
    ...DEFAULT_CONFIGURATION,
    simulation: { ...DEFAULT_CONFIGURATION.simulation },
  };
}

class ZeroExportConfigurationRepository extends BaseRepository {
  constructor() {
    super(ZeroExportConfiguration);
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
        { $set: configuration, $setOnInsert: { key: 'primary' } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
  }

  async setEnabled(enabled) {
    return this.model
      .findOneAndUpdate(
        { key: 'primary' },
        { $set: { enabled }, $setOnInsert: defaultConfiguration() },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
  }
}

module.exports = {
  DEFAULT_CONFIGURATION,
  ZeroExportConfigurationRepository,
  defaultConfiguration,
};
