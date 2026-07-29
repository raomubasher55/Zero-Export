'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REGISTER_TYPES } = require('../src/constants/modbus');
const { buildReadPlan, rawValuesForDefinition } = require('../src/modbus/register-read-planner');

function register(key, address, length, registerType = REGISTER_TYPES.INPUT) {
  return { key, address, length, registerType, enabled: true };
}

test('register read planner combines contiguous and overlapping registers without crossing Modbus limits', () => {
  const plan = buildReadPlan([
    register('voltage', 0, 2),
    register('current', 2, 2),
    register('power', 3, 2),
    register('frequency', 10, 2),
    register('coil_status', 0, 1, REGISTER_TYPES.COIL),
  ]);

  const inputBatches = plan.filter((batch) => batch.registerType === REGISTER_TYPES.INPUT);
  assert.equal(inputBatches.length, 2);
  assert.deepEqual(
    inputBatches.map((batch) => ({ address: batch.address, quantity: batch.quantity })),
    [
      { address: 0, quantity: 5 },
      { address: 10, quantity: 2 },
    ],
  );

  const firstBatch = inputBatches[0];
  assert.deepEqual(rawValuesForDefinition(firstBatch, [10, 11, 12, 13, 14], firstBatch.registers[2]), [13, 14]);
});
