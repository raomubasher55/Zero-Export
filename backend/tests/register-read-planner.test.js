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

test('register read planner honors a per-profile batch limit like the Huawei SUN2000 (15)', () => {
  const registers = [];
  for (let index = 0; index < 40; index += 1) {
    registers.push(register(`word_${index}`, 32000 + index, 1));
  }

  const plan = buildReadPlan(registers, 15);

  assert.ok(plan.every((batch) => batch.quantity <= 15), 'no batch exceeds 15');
  assert.ok(plan.length >= 3, 'the 40-word block is split into at least 3 batches');
  assert.deepEqual(
    plan.map((batch) => batch.quantity),
    [15, 15, 10],
  );

  const addresses = plan.flatMap((batch) =>
    Array.from({ length: batch.quantity }, (_, offset) => batch.address + offset),
  );
  assert.deepEqual(addresses, Array.from({ length: 40 }, (_, index) => 32000 + index));
});

test('register read planner rejects a single definition larger than the batch limit', () => {
  assert.throws(
    () => buildReadPlan([register('big_string', 30000, 20)], 15),
    (error) => error.name === 'RegisterReadPlanError',
  );
});
