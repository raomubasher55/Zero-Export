'use strict';

const { z } = require('zod');

const OBJECT_ID_PATTERN = /^[a-fA-F\d]{24}$/;

const objectIdSchema = z.string().regex(OBJECT_ID_PATTERN, 'Must be a valid MongoDB ObjectId.');
const nonEmptyString = z.string().trim().min(1, 'Cannot be empty.');
const optionalText = z.string().trim().min(1).max(2000).nullable().optional();

function numberFromQuery(schema) {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      return Number(value);
    }
    return value;
  }, schema);
}

function booleanFromQuery(defaultValue) {
  return z.preprocess((value) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  }, z.boolean().default(defaultValue));
}

const paginationSchema = z.object({
  page: numberFromQuery(z.number().int().min(1).max(100000).default(1)),
  limit: numberFromQuery(z.number().int().min(1).max(100).default(25)),
});

module.exports = {
  z,
  objectIdSchema,
  nonEmptyString,
  optionalText,
  numberFromQuery,
  booleanFromQuery,
  paginationSchema,
};
