'use strict';

const mongoose = require('mongoose');
const {
  REGISTER_DATA_TYPE_VALUES,
  REGISTER_TYPE_VALUES,
} = require('../constants/modbus');

const VALUE_QUALITIES = Object.freeze({
  GOOD: 'GOOD',
  BAD: 'BAD',
});

const latestValueSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },
    registerProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegisterProfile',
      required: true,
    },
    registerKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    registerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    registerType: {
      type: String,
      required: true,
      enum: REGISTER_TYPE_VALUES,
    },
    address: {
      type: Number,
      required: true,
      min: 0,
      max: 65535,
    },
    dataType: {
      type: String,
      required: true,
      enum: REGISTER_DATA_TYPE_VALUES,
    },
    group: {
      type: String,
      trim: true,
      maxlength: 80,
      default: undefined,
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 32,
      default: undefined,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    rawValue: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    rawValues: {
      type: [mongoose.Schema.Types.Mixed],
      required: true,
    },
    quality: {
      type: String,
      enum: Object.values(VALUE_QUALITIES),
      default: VALUE_QUALITIES.GOOD,
    },
    sampledAt: {
      type: Date,
      required: true,
    },
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

latestValueSchema.index({ device: 1, registerKey: 1 }, { unique: true, name: 'uq_latest_value_device_register' });
latestValueSchema.index({ device: 1, group: 1, registerKey: 1 });
latestValueSchema.index({ device: 1, updatedAt: -1 });

const LatestValue = mongoose.model('LatestValue', latestValueSchema);

module.exports = {
  LatestValue,
  VALUE_QUALITIES,
};
