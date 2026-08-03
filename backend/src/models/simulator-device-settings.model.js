'use strict';

const mongoose = require('mongoose');

const simulatorDeviceSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ['em500', 'huawei', 'solis'],
    },
    host: { type: String, trim: true, maxlength: 253, default: '0.0.0.0' },
    port: { type: Number, min: 1, max: 65535, required: true },
    unitId: { type: Number, min: 1, max: 247, required: true },
    updateIntervalMs: { type: Number, min: 250, max: 60000, default: 1000 },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
    id: false,
    strict: 'throw',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

simulatorDeviceSettingsSchema.index({ key: 1 }, { unique: true, name: 'uq_simulator_device_key' });

const SimulatorDeviceSettings = mongoose.model(
  'SimulatorDeviceSettings',
  simulatorDeviceSettingsSchema,
);

module.exports = SimulatorDeviceSettings;
