'use strict';

const mongoose = require('mongoose');
const { config } = require('../config/environment');

const COMMUNICATION_OPERATIONS = Object.freeze({
  POLL: 'POLL',
  CONNECT: 'CONNECT',
  READ: 'READ',
  WRITE: 'WRITE',
});

const COMMUNICATION_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  FAILURE: 'FAILURE',
});

const COMMUNICATION_SOURCES = Object.freeze({
  SCHEDULER: 'SCHEDULER',
  MANUAL: 'MANUAL',
  API: 'API',
  GATEWAY: 'GATEWAY',
});

const communicationLogSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },
    registerProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegisterProfile',
      default: undefined,
    },
    operation: {
      type: String,
      required: true,
      enum: Object.values(COMMUNICATION_OPERATIONS),
    },
    source: {
      type: String,
      required: true,
      enum: Object.values(COMMUNICATION_SOURCES),
    },
    outcome: {
      type: String,
      required: true,
      enum: Object.values(COMMUNICATION_OUTCOMES),
    },
    durationMs: {
      type: Number,
      min: 0,
      default: undefined,
    },
    request: {
      batchCount: { type: Number, min: 0 },
      registerCount: { type: Number, min: 0 },
    },
    response: {
      decodedCount: { type: Number, min: 0 },
      failedRegisterKeys: [{ type: String, maxlength: 64 }],
    },
    error: {
      code: { type: String, trim: true, maxlength: 100 },
      message: { type: String, trim: true, maxlength: 2000 },
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    id: false,
    strict: 'throw',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

communicationLogSchema.index({ device: 1, timestamp: -1 });
communicationLogSchema.index({ device: 1, outcome: 1, timestamp: -1 });
communicationLogSchema.index(
  { timestamp: 1 },
  {
    expireAfterSeconds: config.monitoring.communicationLogRetentionDays * 24 * 60 * 60,
    name: 'ttl_communication_log_timestamp',
  },
);

const CommunicationLog = mongoose.model('CommunicationLog', communicationLogSchema);

module.exports = {
  CommunicationLog,
  COMMUNICATION_OPERATIONS,
  COMMUNICATION_OUTCOMES,
  COMMUNICATION_SOURCES,
};
