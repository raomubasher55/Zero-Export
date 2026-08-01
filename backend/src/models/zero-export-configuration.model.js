'use strict';

const mongoose = require('mongoose');

const simulationSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    loadKw: { type: Number, default: 100, min: 0, max: 1000000 },
  },
  { _id: false, strict: 'throw' },
);

const zeroExportConfigurationSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'primary',
    },
    enabled: { type: Boolean, default: false },
    meterDeviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    meterRegisterKey: {
      type: String,
      trim: true,
      maxlength: 64,
      default: 'eqv_active_power',
    },
    inverterDeviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    inverterRegisterKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      default: 'active_power_derating',
    },
    inverterRegisterAddress: {
      type: Number,
      required: true,
      min: 0,
      max: 65535,
      default: 40125,
    },
    targetGridKw: { type: Number, default: 0 },
    deadbandKw: { type: Number, default: 0.5, min: 0, max: 10000 },
    // Derating is expressed in raw register units (0-1000 = 0-100%).
    stepPerCycle: { type: Number, default: 20, min: 1, max: 1000 },
    minDerating: { type: Number, default: 0, min: 0, max: 1000 },
    maxDerating: { type: Number, default: 1000, min: 0, max: 1000 },
    intervalMs: { type: Number, default: 5000, min: 1000, max: 60000 },
    failsafeDerating: { type: Number, default: 0, min: 0, max: 1000 },
    failsafeAfterMisses: { type: Number, default: 3, min: 1, max: 50 },
    simulation: { type: simulationSchema, default: () => ({ enabled: false, loadKw: 100 }) },
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

zeroExportConfigurationSchema.index({ key: 1 }, { unique: true, name: 'uq_zero_export_key' });

const ZeroExportConfiguration = mongoose.model(
  'ZeroExportConfiguration',
  zeroExportConfigurationSchema,
);

module.exports = ZeroExportConfiguration;
