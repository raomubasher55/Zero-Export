'use strict';

const mongoose = require('mongoose');
const {
  BYTE_ORDER_VALUES,
  REGISTER_DATA_TYPE_VALUES,
  REGISTER_TYPE_VALUES,
  REGISTER_DATA_TYPES,
  REGISTER_TYPES,
  WORD_ORDER_VALUES,
} = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

const registerDefinitionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      match: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
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
      maxlength: 1000,
      default: undefined,
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
    length: {
      type: Number,
      required: true,
      min: 1,
      max: 125,
    },
    byteOrder: {
      type: String,
      enum: BYTE_ORDER_VALUES,
      default: 'BIG_ENDIAN',
    },
    wordOrder: {
      type: String,
      enum: WORD_ORDER_VALUES,
      default: 'BIG_ENDIAN',
    },
    bitIndex: {
      type: Number,
      min: 0,
      max: 15,
      default: 0,
    },
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
      validate: {
        validator: Number.isFinite,
        message: 'offset must be a finite number.',
      },
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 32,
      default: undefined,
    },
    group: {
      type: String,
      trim: true,
      maxlength: 80,
      default: undefined,
    },
    writable: {
      type: Boolean,
      default: false,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      min: 0,
      max: 100000,
      default: 0,
    },
  },
  {
    _id: false,
    strict: 'throw',
  },
);

const registerProfileSchema = new mongoose.Schema(
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
    manufacturer: {
      type: String,
      trim: true,
      maxlength: 120,
      default: undefined,
    },
    model: {
      type: String,
      trim: true,
      maxlength: 120,
      default: undefined,
    },
    registers: {
      type: [registerDefinitionSchema],
      required: true,
      validate: {
        validator: (registers) => Array.isArray(registers) && registers.length > 0,
        message: 'A register profile must contain at least one register definition.',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
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

registerProfileSchema.index({ identifier: 1 }, { unique: true, name: 'uq_register_profile_identifier' });
registerProfileSchema.index({ isActive: 1, updatedAt: -1 });

registerProfileSchema.pre('validate', function validateRegisterDefinitions(next) {
  const seenKeys = new Set();

  for (const [index, register] of this.registers.entries()) {
    const normalizedKey = register.key?.toLowerCase();
    if (normalizedKey && seenKeys.has(normalizedKey)) {
      this.invalidate(`registers.${index}.key`, 'Register keys must be unique within a profile.');
    }
    seenKeys.add(normalizedKey);

    const expectedLength = expectedWordLength(register.dataType);
    if (expectedLength && register.length !== expectedLength) {
      this.invalidate(
        `registers.${index}.length`,
        `${register.dataType} requires a register length of ${expectedLength}.`,
      );
    }

    if (register.dataType === REGISTER_DATA_TYPES.STRING && register.length > 125) {
      this.invalidate(`registers.${index}.length`, 'STRING register length cannot exceed 125 words.');
    }

    if (register.address + register.length > 65536) {
      this.invalidate(`registers.${index}.address`, 'Register range must not exceed address 65535.');
    }

    const isBitTransport = [REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(register.registerType);
    if (isBitTransport && register.dataType !== REGISTER_DATA_TYPES.BIT) {
      this.invalidate(`registers.${index}.dataType`, 'Coil and discrete-input registers must use BIT dataType.');
    }

    if (isBitTransport && register.bitIndex !== 0) {
      this.invalidate(`registers.${index}.bitIndex`, 'Coil and discrete-input registers must use bitIndex 0.');
    }

    if (
      [REGISTER_TYPES.INPUT, REGISTER_TYPES.DISCRETE_INPUT].includes(register.registerType) &&
      register.writable
    ) {
      this.invalidate(`registers.${index}.writable`, 'Input and discrete-input registers are read-only.');
    }

    if (register.dataType !== REGISTER_DATA_TYPES.BIT && register.bitIndex !== 0) {
      this.invalidate(`registers.${index}.bitIndex`, 'bitIndex can only be set for BIT dataType.');
    }
  }

  next();
});

const RegisterProfile = mongoose.model('RegisterProfile', registerProfileSchema);

module.exports = RegisterProfile;
