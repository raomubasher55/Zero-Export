'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PollingScheduler } = require('../src/jobs/polling-scheduler');

test('PollingScheduler claims and executes due devices up to its configured concurrency', async () => {
  const claimed = [
    { device: { _id: 'first' }, leaseId: 'lease-first' },
    { device: { _id: 'second' }, leaseId: 'lease-second' },
    null,
  ];
  const executed = [];
  const scheduler = new PollingScheduler({
    enabled: true,
    concurrency: 2,
    tickIntervalMs: 60000,
    logger: { info() {}, warn() {}, error() {} },
    pollingService: {
      claimNextDueDevice: async () => claimed.shift(),
      pollClaimedDevice: async (device, leaseId) => executed.push(`${device._id}:${leaseId}`),
    },
  });

  scheduler.running = true;
  await scheduler.runCycle();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([...scheduler.activeTasks]);
  scheduler.running = false;

  assert.deepEqual(executed.sort(), ['first:lease-first', 'second:lease-second']);
  assert.equal(scheduler.getStatus().activePolls, 0);
});
