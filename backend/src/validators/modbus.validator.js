'use strict';

const { REGISTER_TYPES } = require('../constants/modbus');
const { objectIdSchema, z } = require('./common.validator');

const deviceIdParamSchema = z.object({
  deviceId: objectIdSchema,
});

const readModbusBodySchema = z
  .object({
    registerType: z.enum([
      REGISTER_TYPES.COIL,
      REGISTER_TYPES.DISCRETE_INPUT,
      REGISTER_TYPES.HOLDING,
      REGISTER_TYPES.INPUT,
    ]),
    address: z.number().int().min(0).max(65535),
    quantity: z.number().int().min(1).max(2000),
  })
  .strict()
  .superRefine((value, context) => {
    const isWordRead = [REGISTER_TYPES.HOLDING, REGISTER_TYPES.INPUT].includes(value.registerType);
    const maxQuantity = isWordRead ? 125 : 2000;

    if (value.quantity > maxQuantity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: `${value.registerType} reads cannot exceed ${maxQuantity} values per Modbus request.`,
      });
    }
    if (value.address + value.quantity > 65536) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: 'Requested Modbus range must not exceed address 65535.',
      });
    }
  });

const writeModbusBodySchema = z.discriminatedUnion('registerType', [
  z
    .object({
      registerType: z.literal(REGISTER_TYPES.COIL),
      address: z.number().int().min(0).max(65535),
      values: z.array(z.boolean()).min(1).max(1968),
    })
    .strict(),
  z
    .object({
      registerType: z.literal(REGISTER_TYPES.HOLDING),
      address: z.number().int().min(0).max(65535),
      values: z.array(z.number().int().min(0).max(65535)).min(1).max(123),
    })
    .strict(),
]).superRefine((value, context) => {
  if (value.address + value.values.length > 65536) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address'],
      message: 'Requested Modbus range must not exceed address 65535.',
    });
  }
});

module.exports = {
  deviceIdParamSchema,
  readModbusBodySchema,
  writeModbusBodySchema,
};
