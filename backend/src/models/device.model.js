'use strict';

const mongoose = require('mongoose');
const {
  DEVICE_STATUSES,
  DEVICE_STATUS_VALUES,
  MODBUS_PROTOCOLS,
  MODBUS_PROTOCOL_VALUES,
  SERIAL_PARITY_VALUES,
} = require('../constants/modbus');

const connectionSchema = new mongoose.Schema(
  {
    protocol: {
      type: String,
      required: true,
      enum: MODBUS_PROTOCOL_VALUES,
    },
    host: {
      type: String,
      trim: true,
      maxlength: 253,
      default: undefined,
    },
    port: {
      type: Number,
      min: 1,
      max: 65535,
      default: 502,
    },
    serialPath: {
      type: String,
      trim: true,
      maxlength: 512,
      default: undefined,
    },
    baudRate: {
      type: Number,
      min: 300,
      max: 4000000,
      default: 9600,
    },
    dataBits: {
      type: Number,
      enum: [5, 6, 7, 8],
      default: 8,
    },
    stopBits: {
      type: Number,
      enum: [1, 2],
      default: 1,
    },
    parity: {
      type: String,
      enum: SERIAL_PARITY_VALUES,
      default: 'none',
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

const pollingSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    intervalMs: {
      type: Number,
      min: 1000,
      max: 86400000,
      default: 5000,
    },
    jitterMs: {
      type: Number,
      min: 0,
      max: 300000,
      default: 0,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

const reconnectSchema = new mongoose.Schema(
  {
    timeoutMs: {
      type: Number,
      min: 100,
      max: 120000,
      default: 3000,
    },
    retries: {
      type: Number,
      min: 0,
      max: 20,
      default: 2,
    },
    retryDelayMs: {
      type: Number,
      min: 0,
      max: 60000,
      default: 500,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

const deviceSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9][a-z0-9._-]{0,63}$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: undefined,
    },
    site: {
      type: String,
      trim: true,
      maxlength: 120,
      default: undefined,
    },
    unitId: {
      type: Number,
      required: true,
      min: 1,
      max: 247,
      default: 1,
    },
    connection: {
      type: connectionSchema,
      required: true,
    },
    registerProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegisterProfile',
      default: null,
      index: true,
    },
    polling: {
      type: pollingSchema,
      default: () => ({}),
    },
    reconnect: {
      type: reconnectSchema,
      default: () => ({}),
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: DEVICE_STATUS_VALUES,
      default: DEVICE_STATUSES.UNKNOWN,
      index: true,
    },
    statusChangedAt: {
      type: Date,
      default: undefined,
    },
    lastSeenAt: {
      type: Date,
      default: undefined,
    },
    lastCommunicationAt: {
      type: Date,
      default: undefined,
    },
    lastPollAt: {
      type: Date,
      default: undefined,
    },
    nextPollAt: {
      type: Date,
      default: undefined,
    },
    pollLeaseId: {
      type: String,
      default: undefined,
    },
    pollLeaseUntil: {
      type: Date,
      default: undefined,
    },
    lastError: {
      message: {
        type: String,
        trim: true,
        maxlength: 2000,
      },
      code: {
        type: String,
        trim: true,
        maxlength: 100,
      },
      occurredAt: Date,
    },
    statistics: {
      successfulPolls: {
        type: Number,
        default: 0,
        min: 0,
      },
      failedPolls: {
        type: Number,
        default: 0,
        min: 0,
      },
      consecutiveFailures: {
        type: Number,
        default: 0,
        min: 0,
      },
      lastDurationMs: {
        type: Number,
        min: 0,
        default: undefined,
      },
    },
    tags: {
      type: [String],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    id: false,
    strict: 'throw',
    toJSON: {
      virtuals: true,
    },
    toObject: {
      virtuals: true,
    },
  },
);

deviceSchema.index({ identifier: 1 }, { unique: true, name: 'uq_device_identifier' });
deviceSchema.index({ isEnabled: 1, status: 1, 'polling.enabled': 1 });
deviceSchema.index({ isEnabled: 1, 'polling.enabled': 1, nextPollAt: 1, pollLeaseUntil: 1 });
deviceSchema.index({ 'connection.protocol': 1, isEnabled: 1 });
deviceSchema.index({ site: 1, name: 1 });

deviceSchema.pre('validate', function validateTransportConfiguration(next) {
  if (!this.connection) {
    return next();
  }

  if (this.connection.protocol === MODBUS_PROTOCOLS.TCP && !this.connection.host) {
    this.invalidate('connection.host', 'host is required for a Modbus TCP device.');
  }

  if (this.connection.protocol === MODBUS_PROTOCOLS.RTU && !this.connection.serialPath) {
    this.invalidate('connection.serialPath', 'serialPath is required for a Modbus RTU device.');
  }

  if (this.polling && this.polling.jitterMs > this.polling.intervalMs) {
    this.invalidate('polling.jitterMs', 'jitterMs cannot exceed intervalMs.');
  }

  return next();
});

const Device = mongoose.model('Device', deviceSchema);

module.exports = Device;
