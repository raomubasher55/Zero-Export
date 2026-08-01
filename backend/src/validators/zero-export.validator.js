'use strict';

const { objectIdSchema, z } = require('./common.validator');

const zeroExportConfigurationSchema = z
  .object({
    enabled: z.boolean().default(false),
    meterDeviceId: objectIdSchema,
    meterRegisterKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Use a valid register key.'),
    inverterDeviceId: objectIdSchema,
    inverterRegisterKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Use a valid register key.'),
    inverterRegisterAddress: z.number().int().min(0).max(65535).default(40201),
    targetGridKw: z.number().finite().default(0),
    deadbandKw: z.number().finite().min(0).max(10000).default(0.5),
    stepPerCycle: z.number().int().min(1).max(1000).default(20),
    minDerating: z.number().int().min(0).max(1000).default(0),
    maxDerating: z.number().int().min(0).max(1000).default(1000),
    intervalMs: z.number().int().min(1000).max(60000).default(5000),
    failsafeDerating: z.number().int().min(0).max(1000).default(0),
    failsafeAfterMisses: z.number().int().min(1).max(50).default(3),
    simulation: z
      .object({
        enabled: z.boolean().default(false),
        loadKw: z.number().finite().min(0).max(1000000).default(100),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minDerating > value.maxDerating) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minDerating'],
        message: 'minDerating cannot exceed maxDerating.',
      });
    }
    if (value.stepPerCycle > value.maxDerating - value.minDerating) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stepPerCycle'],
        message: 'stepPerCycle cannot exceed the derating range.',
      });
    }
  });

module.exports = {
  zeroExportConfigurationSchema,
};
