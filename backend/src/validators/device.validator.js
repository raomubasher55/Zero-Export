'use strict';

const net = require('node:net');
const {
  DEVICE_STATUS_VALUES,
  MODBUS_PROTOCOLS,
  MODBUS_PROTOCOL_VALUES,
  SERIAL_PARITY_VALUES,
} = require('../constants/modbus');
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

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (host) => {
      if (net.isIP(host) !== 0) {
        return true;
      }

      return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host);
    },
    'Must be a valid IPv4 address, IPv6 address, or DNS hostname.',
  );

const tcpConnectionSchema = z
  .object({
    protocol: z.literal(MODBUS_PROTOCOLS.TCP),
    host: hostnameSchema,
    port: z.number().int().min(1).max(65535).default(502),
  })
  .strict();

const rtuConnectionSchema = z
  .object({
    protocol: z.literal(MODBUS_PROTOCOLS.RTU),
    serialPath: nonEmptyString.max(512),
    baudRate: z.number().int().min(300).max(4000000).default(9600),
    dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).default(8),
    stopBits: z.union([z.literal(1), z.literal(2)]).default(1),
    parity: z.enum(SERIAL_PARITY_VALUES).default('none'),
  })
  .strict();

const connectionSchema = z.discriminatedUnion('protocol', [tcpConnectionSchema, rtuConnectionSchema]);

const pollingSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().min(1000).max(86400000).default(60000),
    jitterMs: z.number().int().min(0).max(300000).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.jitterMs > value.intervalMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jitterMs'],
        message: 'jitterMs cannot exceed intervalMs.',
      });
    }
  });

const pollingPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalMs: z.number().int().min(1000).max(86400000).optional(),
    jitterMs: z.number().int().min(0).max(300000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one polling property is required.')
  .superRefine((value, context) => {
    if (
      value.intervalMs !== undefined &&
      value.jitterMs !== undefined &&
      value.jitterMs > value.intervalMs
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jitterMs'],
        message: 'jitterMs cannot exceed intervalMs.',
      });
    }
  });

const reconnectSchema = z
  .object({
    timeoutMs: z.number().int().min(100).max(120000).default(3000),
    retries: z.number().int().min(0).max(20).default(2),
    retryDelayMs: z.number().int().min(0).max(60000).default(500),
  })
  .strict();

const reconnectPatchSchema = z
  .object({
    timeoutMs: z.number().int().min(100).max(120000).optional(),
    retries: z.number().int().min(0).max(20).optional(),
    retryDelayMs: z.number().int().min(0).max(60000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one reconnect property is required.');

const tagsSchema = z.array(nonEmptyString.max(64)).max(50).transform((tags) => [...new Set(tags)]);
const metadataSchema = z.record(z.string().max(100), z.unknown()).nullable();

const createDeviceBodySchema = z
  .object({
    identifier: identifierSchema,
    name: nonEmptyString.max(120),
    description: optionalText,
    site: z.string().trim().min(1).max(120).nullable().optional(),
    unitId: z.number().int().min(1).max(247).default(1),
    connection: connectionSchema,
    registerProfileId: objectIdSchema.nullable().optional(),
    polling: pollingSchema.default({ enabled: true, intervalMs: 60000, jitterMs: 0 }),
    reconnect: reconnectSchema.default({ timeoutMs: 3000, retries: 2, retryDelayMs: 500 }),
    isEnabled: z.boolean().default(true),
    tags: tagsSchema.default([]),
    metadata: metadataSchema.optional(),
  })
  .strict();

const updateDeviceBodySchema = z
  .object({
    identifier: identifierSchema.optional(),
    name: nonEmptyString.max(120).optional(),
    description: optionalText,
    site: z.string().trim().min(1).max(120).nullable().optional(),
    unitId: z.number().int().min(1).max(247).optional(),
    connection: connectionSchema.optional(),
    registerProfileId: objectIdSchema.nullable().optional(),
    polling: pollingPatchSchema.optional(),
    reconnect: reconnectPatchSchema.optional(),
    isEnabled: z.boolean().optional(),
    tags: tagsSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one mutable device property is required.');

const deviceIdParamSchema = z.object({
  deviceId: objectIdSchema,
});

const listDevicesQuerySchema = paginationSchema
  .extend({
    search: z.string().trim().min(1).max(120).optional(),
    protocol: z.enum(MODBUS_PROTOCOL_VALUES).optional(),
    status: z.enum(DEVICE_STATUS_VALUES).optional(),
    enabled: booleanFromQuery(undefined).optional(),
    registerProfileId: objectIdSchema.optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'identifier', 'status', 'lastSeenAt']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

module.exports = {
  createDeviceBodySchema,
  updateDeviceBodySchema,
  deviceIdParamSchema,
  listDevicesQuerySchema,
};
