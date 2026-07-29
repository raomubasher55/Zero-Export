'use strict';

const { booleanFromQuery, numberFromQuery, z } = require('./common.validator');

const trafficQuerySchema = z
  .object({
    limit: numberFromQuery(z.number().int().min(1).max(500).default(100)),
    transport: z.enum(['TCP', 'RTU']).optional(),
    functionCode: numberFromQuery(z.number().int().min(1).max(127)).optional(),
    operation: z.enum(['READ', 'WRITE', 'OTHER']).optional(),
    client: z.string().trim().min(1).max(253).optional(),
    address: numberFromQuery(z.number().int().min(0).max(65535)).optional(),
    success: booleanFromQuery(undefined).optional(),
  })
  .strict();

const trafficSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    capacity: z.number().int().min(100).max(10000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required.');

const interpretationSchema = z
  .object({
    rawValues: z.array(z.number().int().min(0).max(65535)).min(1).max(125),
    scaleFactor: z.number().finite().refine((value) => value !== 0, 'scaleFactor cannot be zero.').default(1),
    offset: z.number().finite().default(0),
  })
  .strict();

const exportQuerySchema = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();

module.exports = {
  exportQuerySchema,
  interpretationSchema,
  trafficQuerySchema,
  trafficSettingsSchema,
};
