'use strict';

const SimulatorDeviceSettings = require('../models/simulator-device-settings.model');

class SimulatorSettingsRepository {
  constructor(model = SimulatorDeviceSettings) {
    this.model = model;
  }

  async get(key) {
    return this.model.findOne({ key }).lean().exec();
  }

  async save(key, settings) {
    return this.model
      .findOneAndUpdate(
        { key },
        { $set: settings, $setOnInsert: { key } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
  }
}

module.exports = SimulatorSettingsRepository;
