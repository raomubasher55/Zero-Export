'use strict';

const { REGISTER_TYPES } = require('../constants/modbus');

const MAX_READ_QUANTITIES = Object.freeze({
  [REGISTER_TYPES.COIL]: 2000,
  [REGISTER_TYPES.DISCRETE_INPUT]: 2000,
  [REGISTER_TYPES.HOLDING]: 125,
  [REGISTER_TYPES.INPUT]: 125,
});

class RegisterReadPlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegisterReadPlanError';
    Error.captureStackTrace(this, this.constructor);
  }
}

function assertDefinition(definition) {
  const maxQuantity = MAX_READ_QUANTITIES[definition.registerType];
  if (!maxQuantity) {
    throw new RegisterReadPlanError(`Unsupported register type: ${definition.registerType}`);
  }
  if (!Number.isInteger(definition.address) || !Number.isInteger(definition.length) || definition.length < 1) {
    throw new RegisterReadPlanError(`Invalid register definition for ${definition.key}.`);
  }
  if (definition.length > maxQuantity || definition.address + definition.length > 65536) {
    throw new RegisterReadPlanError(`Register definition ${definition.key} exceeds Modbus read limits.`);
  }
}

function buildReadPlan(registers) {
  const enabledRegisters = registers.filter((definition) => definition.enabled !== false);
  const byType = new Map();

  enabledRegisters.forEach((definition) => {
    assertDefinition(definition);
    const definitions = byType.get(definition.registerType) || [];
    definitions.push(definition);
    byType.set(definition.registerType, definitions);
  });

  const batches = [];
  for (const [registerType, definitions] of byType.entries()) {
    const maxQuantity = MAX_READ_QUANTITIES[registerType];
    definitions.sort((left, right) => left.address - right.address || left.length - right.length);

    let currentBatch;
    for (const definition of definitions) {
      const definitionEnd = definition.address + definition.length;
      if (!currentBatch) {
        currentBatch = {
          registerType,
          address: definition.address,
          quantity: definition.length,
          registers: [definition],
        };
        continue;
      }

      const currentEnd = currentBatch.address + currentBatch.quantity;
      const isContiguousOrOverlapping = definition.address <= currentEnd;
      const nextQuantity = Math.max(currentEnd, definitionEnd) - currentBatch.address;

      if (isContiguousOrOverlapping && nextQuantity <= maxQuantity) {
        currentBatch.quantity = nextQuantity;
        currentBatch.registers.push(definition);
      } else {
        batches.push(currentBatch);
        currentBatch = {
          registerType,
          address: definition.address,
          quantity: definition.length,
          registers: [definition],
        };
      }
    }

    if (currentBatch) {
      batches.push(currentBatch);
    }
  }

  return batches.sort((left, right) => left.registerType.localeCompare(right.registerType) || left.address - right.address);
}

function rawValuesForDefinition(batch, rawValues, definition) {
  const offset = definition.address - batch.address;
  const values = rawValues.slice(offset, offset + definition.length);

  if (values.length !== definition.length) {
    throw new RegisterReadPlanError(`Incomplete response for register ${definition.key}.`);
  }

  return values;
}

module.exports = {
  MAX_READ_QUANTITIES,
  RegisterReadPlanError,
  buildReadPlan,
  rawValuesForDefinition,
};
