'use strict';

const {
  BYTE_ORDER_VALUES,
  REGISTER_DATA_TYPES,
  REGISTER_DATA_TYPE_VALUES,
  REGISTER_TYPES,
  REGISTER_TYPE_VALUES,
  WORD_ORDER_VALUES,
} = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');
const {
  booleanFromQuery,
  nonEmptyString,
  objectIdSchema,
  optionalText,
  paginationSchema,
  z,
} = require('./common.validator');

const identifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'Use 1-64 lowercase letters, numbers, dots, underscores, or hyphens.');

const registerDefinitionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Use an identifier beginning with a letter.'),
    name: nonEmptyString.max(120),
    description: optionalText,
    registerType: z.enum(REGISTER_TYPE_VALUES),
    address: z.number().int().min(0).max(65535),
    dataType: z.enum(REGISTER_DATA_TYPE_VALUES),
    length: z.number().int().min(1).max(125).optional(),
    byteOrder: z.enum(BYTE_ORDER_VALUES).default('BIG_ENDIAN'),
    wordOrder: z.enum(WORD_ORDER_VALUES).default('BIG_ENDIAN'),
    bitIndex: z.number().int().min(0).max(15).optional(),
    scaleFactor: z.number().finite().refine((value) => value !== 0, 'scaleFactor cannot be zero.').default(1),
    offset: z.number().finite().default(0),
    unit: z.string().trim().min(1).max(32).nullable().optional(),
    group: z.string().trim().min(1).max(80).nullable().optional(),
    writable: z.boolean().default(false),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedLength = expectedWordLength(value.dataType);
    const length = value.length ?? expectedLength;

    if (value.dataType === REGISTER_DATA_TYPES.STRING && value.length === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['length'],
        message: 'STRING dataType requires the number of 16-bit registers to read.',
      });
    }

    if (expectedLength && value.length !== undefined && value.length !== expectedLength) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['length'],
        message: `${value.dataType} requires a register length of ${expectedLength}.`,
      });
    }

    if (value.address + length > 65536) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: 'Register range must not exceed address 65535.',
      });
    }

    const isBitTransport = [REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(value.registerType);
    if (isBitTransport && value.dataType !== REGISTER_DATA_TYPES.BIT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataType'],
        message: 'Coil and discrete-input registers must use BIT dataType.',
      });
    }

    const bitIndex = value.bitIndex ?? 0;
    if (isBitTransport && bitIndex !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bitIndex'],
        message: 'Coil and discrete-input registers must use bitIndex 0.',
      });
    }

    if (
      [REGISTER_TYPES.INPUT, REGISTER_TYPES.DISCRETE_INPUT].includes(value.registerType) &&
      value.writable
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['writable'],
        message: 'Input and discrete-input registers are read-only.',
      });
    }

    if (value.dataType !== REGISTER_DATA_TYPES.BIT && bitIndex !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bitIndex'],
        message: 'bitIndex can only be set for BIT dataType.',
      });
    }
  })
  .transform((value) => ({
    ...value,
    length: value.length ?? expectedWordLength(value.dataType),
    bitIndex: value.bitIndex ?? 0,
  }));

const tagsSchema = z.array(nonEmptyString.max(64)).max(50).transform((tags) => [...new Set(tags)]);
const metadataSchema = z.record(z.string().max(100), z.unknown()).nullable();

const createRegisterProfileBodySchema = z
  .object({
    identifier: identifierSchema,
    name: nonEmptyString.max(120),
    description: optionalText,
    manufacturer: z.string().trim().min(1).max(120).nullable().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    registers: z.array(registerDefinitionSchema).min(1).max(500).superRefine((registers, context) => {
      const keys = new Set();
      registers.forEach((register, index) => {
        const key = register.key.toLowerCase();
        if (keys.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'key'],
            message: 'Register keys must be unique within a profile.',
          });
        }
        keys.add(key);
      });
    }),
    isActive: z.boolean().default(true),
    maxReadQuantity: z.number().int().min(1).max(125).optional(),
    tags: tagsSchema.default([]),
    metadata: metadataSchema.optional(),
  })
  .strict();

const importRegisterProfilesBodySchema = z
  .object({
    format: z.literal('zero-export-register-profiles'),
    version: z.literal(1),
    conflictStrategy: z.enum(['UPDATE', 'SKIP', 'ERROR']).default('UPDATE'),
    profiles: z
      .array(createRegisterProfileBodySchema)
      .min(1)
      .max(100)
      .superRefine((profiles, context) => {
        const identifiers = new Set();
        profiles.forEach((profile, index) => {
          if (identifiers.has(profile.identifier)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, 'identifier'],
              message: 'Profile identifiers must be unique within an import file.',
            });
          }
          identifiers.add(profile.identifier);
        });
      }),
  })
  .strict();

const updateRegisterProfileBodySchema = z
  .object({
    identifier: identifierSchema.optional(),
    name: nonEmptyString.max(120).optional(),
    description: optionalText,
    manufacturer: z.string().trim().min(1).max(120).nullable().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    registers: z.array(registerDefinitionSchema).min(1).max(500).optional(),
    isActive: z.boolean().optional(),
    maxReadQuantity: z.number().int().min(1).max(125).optional(),
    tags: tagsSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one mutable register profile property is required.');

const registerProfileIdParamSchema = z.object({
  registerProfileId: objectIdSchema,
});

const listRegisterProfilesQuerySchema = paginationSchema
  .extend({
    search: z.string().trim().min(1).max(120).optional(),
    active: booleanFromQuery(undefined).optional(),
    manufacturer: z.string().trim().min(1).max(120).optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'identifier', 'manufacturer']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

module.exports = {
  createRegisterProfileBodySchema,
  importRegisterProfilesBodySchema,
  updateRegisterProfileBodySchema,
  registerProfileIdParamSchema,
  listRegisterProfilesQuerySchema,
};
