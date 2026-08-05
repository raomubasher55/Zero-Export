'use strict';

const { z } = require('./common.validator');

const SIMULATOR_DEVICE_KEYS = ['em500', 'huawei', 'solis', 'sungrow'];

const simulatorDeviceKeyParamSchema = z.object({
  deviceKey: z.enum(SIMULATOR_DEVICE_KEYS),
});

const simulatorDeviceUpdateSchema = z
  .object({
    host: z.string().trim().min(1).max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    unitId: z.number().int().min(1).max(247).optional(),
    updateIntervalMs: z.number().int().min(250).max(60000).optional(),
    options: z
      .object({
        ratingKw: z.number().finite().min(0.1).max(100000).optional(),
        availabilityPct: z.number().finite().min(0).max(100).optional(),
        loadKw: z.number().finite().min(0).max(100000).optional(),
        zeroFillGaps: z.boolean().optional(),
        maxReadQuantity: z.number().int().min(1).max(125).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one simulator setting is required.');

const simulatorValuesQuerySchema = z.object({
  device: z.enum(SIMULATOR_DEVICE_KEYS).default('em500'),
});

module.exports = {
  SIMULATOR_DEVICE_KEYS,
  simulatorDeviceKeyParamSchema,
  simulatorDeviceUpdateSchema,
  simulatorValuesQuerySchema,
};
