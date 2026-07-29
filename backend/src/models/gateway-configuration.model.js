'use strict';

const mongoose = require('mongoose');
const {
  BYTE_ORDER_VALUES,
  REGISTER_DATA_TYPE_VALUES,
  REGISTER_DATA_TYPES,
  REGISTER_TYPE_VALUES,
  REGISTER_TYPES,
  SERIAL_PARITY_VALUES,
  WORD_ORDER_VALUES,
} = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

const tcpEndpointSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    host: { type: String, trim: true, maxlength: 253, default: '0.0.0.0' },
    port: { type: Number, min: 1, max: 65535, default: 1502 },
  },
  { _id: false, strict: 'throw' },
);

const rtuEndpointSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    serialPath: { type: String, trim: true, maxlength: 512, default: '/dev/ttyUSB1' },
    baudRate: { type: Number, min: 300, max: 4000000, default: 9600 },
    dataBits: { type: Number, enum: [5, 6, 7, 8], default: 8 },
    stopBits: { type: Number, enum: [1, 2], default: 1 },
    parity: { type: String, enum: SERIAL_PARITY_VALUES, default: 'none' },
  },
  { _id: false, strict: 'throw' },
);

const forwardingMappingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      match: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sourceDeviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },
    sourceRegisterKey: {
      type: String,
      required: true,
      trim: true,
      match: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
    },
    registerType: { type: String, required: true, enum: REGISTER_TYPE_VALUES },
    address: { type: Number, required: true, min: 0, max: 65535 },
    dataType: { type: String, required: true, enum: REGISTER_DATA_TYPE_VALUES },
    length: { type: Number, required: true, min: 1, max: 125 },
    byteOrder: { type: String, enum: BYTE_ORDER_VALUES, default: 'BIG_ENDIAN' },
    wordOrder: { type: String, enum: WORD_ORDER_VALUES, default: 'BIG_ENDIAN' },
    bitIndex: { type: Number, min: 0, max: 15, default: 0 },
    scaleFactor: {
      type: Number,
      default: 1,
      validate: {
        validator: (value) => Number.isFinite(value) && value !== 0,
        message: 'scaleFactor must be a finite, non-zero number.',
      },
    },
    offset: {
      type: Number,
      default: 0,
      validate: { validator: Number.isFinite, message: 'offset must be a finite number.' },
    },
    unit: { type: String, trim: true, maxlength: 32, default: undefined },
    writable: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
  },
  { _id: false, strict: 'throw' },
);

const gatewayConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: 'primary', immutable: true },
    enabled: { type: Boolean, default: false },
    unitId: { type: Number, min: 1, max: 247, default: 1 },
    tcp: { type: tcpEndpointSchema, default: () => ({}) },
    rtu: { type: rtuEndpointSchema, default: () => ({}) },
    mappings: { type: [forwardingMappingSchema], default: [] },
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

gatewayConfigurationSchema.index({ key: 1 }, { unique: true, name: 'uq_gateway_configuration_key' });

gatewayConfigurationSchema.pre('validate', function validateMappings(next) {
  const keys = new Set();
  const addresses = new Set();

  for (const [index, mapping] of this.mappings.entries()) {
    const key = mapping.key?.toLowerCase();
    if (keys.has(key)) {
      this.invalidate(`mappings.${index}.key`, 'Forwarding mapping keys must be unique.');
    }
    keys.add(key);

    const expectedLength = expectedWordLength(mapping.dataType);
    if (expectedLength && mapping.length !== expectedLength) {
      this.invalidate(
        `mappings.${index}.length`,
        `${mapping.dataType} requires a register length of ${expectedLength}.`,
      );
    }

    const isBitArea = [REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(mapping.registerType);
    if (isBitArea && (mapping.dataType !== REGISTER_DATA_TYPES.BIT || mapping.length !== 1)) {
      this.invalidate(
        `mappings.${index}.dataType`,
        'Coil and discrete-input mappings must use BIT with length 1.',
      );
    }
    if (isBitArea && mapping.bitIndex !== 0) {
      this.invalidate(`mappings.${index}.bitIndex`, 'Coil mappings must use bitIndex 0.');
    }
    if (mapping.dataType !== REGISTER_DATA_TYPES.BIT && mapping.bitIndex !== 0) {
      this.invalidate(`mappings.${index}.bitIndex`, 'bitIndex is only valid for BIT mappings.');
    }
    if (
      mapping.writable &&
      [REGISTER_TYPES.INPUT, REGISTER_TYPES.DISCRETE_INPUT].includes(mapping.registerType)
    ) {
      this.invalidate(`mappings.${index}.writable`, 'Input and discrete-input mappings are read-only.');
    }
    if (mapping.address + mapping.length > 65536) {
      this.invalidate(`mappings.${index}.address`, 'Mapping range must not exceed address 65535.');
    }

    if (mapping.enabled) {
      for (let offset = 0; offset < mapping.length; offset += 1) {
        const addressKey = `${mapping.registerType}:${mapping.address + offset}`;
        if (addresses.has(addressKey)) {
          this.invalidate(
            `mappings.${index}.address`,
            'Enabled gateway mapping address ranges must not overlap within the same Modbus area.',
          );
        }
        addresses.add(addressKey);
      }
    }
  }

  if (this.enabled && !this.tcp?.enabled && !this.rtu?.enabled) {
    this.invalidate('enabled', 'Enable at least one TCP or RTU endpoint before starting the gateway.');
  }

  next();
});

const GatewayConfiguration = mongoose.model('GatewayConfiguration', gatewayConfigurationSchema);

module.exports = GatewayConfiguration;
