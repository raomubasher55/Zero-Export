'use strict';

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
const { nonEmptyString, objectIdSchema, z } = require('./common.validator');

const tcpEndpointSchema = z
  .object({
    enabled: z.boolean(),
    host: nonEmptyString.max(253),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

const rtuEndpointSchema = z
  .object({
    enabled: z.boolean(),
    serialPath: nonEmptyString.max(512),
    baudRate: z.number().int().min(300).max(4000000),
    dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
    stopBits: z.union([z.literal(1), z.literal(2)]),
    parity: z.enum(SERIAL_PARITY_VALUES),
  })
  .strict();

const mappingSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Use a letter followed by letters, numbers, or underscores.'),
    name: nonEmptyString.max(120),
    sourceDeviceId: objectIdSchema,
    sourceRegisterKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Select a valid source register key.'),
    registerType: z.enum(REGISTER_TYPE_VALUES),
    address: z.number().int().min(0).max(65535),
    dataType: z.enum(REGISTER_DATA_TYPE_VALUES),
    length: z.number().int().min(1).max(125),
    byteOrder: z.enum(BYTE_ORDER_VALUES),
    wordOrder: z.enum(WORD_ORDER_VALUES),
    bitIndex: z.number().int().min(0).max(15).default(0),
    scaleFactor: z.number().finite().refine((value) => value !== 0, 'scaleFactor cannot be zero.'),
    offset: z.number().finite(),
    unit: z.string().trim().min(1).max(32).nullable().optional(),
    writable: z.boolean(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((mapping, context) => {
    const expectedLength = expectedWordLength(mapping.dataType);
    if (expectedLength && mapping.length !== expectedLength) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['length'],
        message: `${mapping.dataType} requires length ${expectedLength}.`,
      });
    }

    const isBitArea = [REGISTER_TYPES.COIL, REGISTER_TYPES.DISCRETE_INPUT].includes(mapping.registerType);
    if (isBitArea && (mapping.dataType !== REGISTER_DATA_TYPES.BIT || mapping.length !== 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataType'],
        message: 'Coil and discrete-input mappings must use BIT with length 1.',
      });
    }
    if (isBitArea && mapping.bitIndex !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bitIndex'],
        message: 'Coil and discrete-input mappings must use bitIndex 0.',
      });
    }
    if (mapping.dataType !== REGISTER_DATA_TYPES.BIT && mapping.bitIndex !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bitIndex'],
        message: 'bitIndex is only valid for BIT mappings.',
      });
    }
    if (
      mapping.writable &&
      [REGISTER_TYPES.INPUT, REGISTER_TYPES.DISCRETE_INPUT].includes(mapping.registerType)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['writable'],
        message: 'Input and discrete-input mappings cannot accept downstream writes.',
      });
    }
    if (mapping.address + mapping.length > 65536) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: 'Mapping range must not exceed address 65535.',
      });
    }
  });

const generateMappingsSchema = z
  .object({
    sourceDeviceId: objectIdSchema,
    // When omitted, each output mapping keeps its source register's own
    // Modbus area (EM500 input registers stay FC04 with the same addresses).
    registerType: z.enum(REGISTER_TYPE_VALUES).optional(),
    addressOffset: z.number().int().min(0).max(65535).default(0),
  })
  .strict();

const gatewayConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    unitId: z.number().int().min(1).max(247),
    tcp: tcpEndpointSchema,
    rtu: rtuEndpointSchema,
    mappings: z.array(mappingSchema).max(1000),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.enabled && !configuration.tcp.enabled && !configuration.rtu.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['enabled'],
        message: 'Enable at least one TCP or RTU endpoint before starting the gateway.',
      });
    }

    const keys = new Set();
    const addresses = new Set();
    configuration.mappings.forEach((mapping, index) => {
      const normalizedKey = mapping.key.toLowerCase();
      if (keys.has(normalizedKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mappings', index, 'key'],
          message: 'Mapping keys must be unique.',
        });
      }
      keys.add(normalizedKey);

      if (!mapping.enabled) return;
      for (let offset = 0; offset < mapping.length; offset += 1) {
        const addressKey = `${mapping.registerType}:${mapping.address + offset}`;
        if (addresses.has(addressKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mappings', index, 'address'],
            message: 'Enabled mapping ranges cannot overlap in the same Modbus area.',
          });
          break;
        }
        addresses.add(addressKey);
      }
    });
  });

module.exports = {
  gatewayConfigurationSchema,
  generateMappingsSchema,
  mappingSchema,
};
