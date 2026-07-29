'use strict';

const {
  COMMUNICATION_OPERATIONS,
  COMMUNICATION_OUTCOMES,
  COMMUNICATION_SOURCES,
} = require('../models/communication-log.model');
const { VALUE_QUALITIES } = require('../models/latest-value.model');
const { nonEmptyString, objectIdSchema, paginationSchema, z } = require('./common.validator');

const registerKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Must be a valid register key.');

const deviceIdParamSchema = z.object({
  deviceId: objectIdSchema,
});

const deviceRegisterParamSchema = z.object({
  deviceId: objectIdSchema,
  registerKey: registerKeySchema,
});

const latestValuesQuerySchema = paginationSchema
  .extend({
    group: nonEmptyString.max(80).optional(),
    quality: z.enum(Object.values(VALUE_QUALITIES)).optional(),
    registerKey: registerKeySchema.optional(),
  })
  .strict();

const communicationLogsQuerySchema = paginationSchema
  .extend({
    outcome: z.enum(Object.values(COMMUNICATION_OUTCOMES)).optional(),
    operation: z.enum(Object.values(COMMUNICATION_OPERATIONS)).optional(),
    source: z.enum(Object.values(COMMUNICATION_SOURCES)).optional(),
  })
  .strict();

module.exports = {
  deviceIdParamSchema,
  deviceRegisterParamSchema,
  latestValuesQuerySchema,
  communicationLogsQuerySchema,
};
