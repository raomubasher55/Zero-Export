'use strict';

const { z } = require('./common.validator');

const simulatorConfigurationSchema = z
  .object({
    host: z.string().trim().min(1).max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    unitId: z.number().int().min(1).max(247).optional(),
    updateIntervalMs: z.number().int().min(250).max(60000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one simulator setting is required.');

module.exports = {
  simulatorConfigurationSchema,
};
