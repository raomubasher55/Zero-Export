'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SystemMonitoringService } = require('../src/services/system-monitoring.service');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('SystemMonitoringService reports live host and backend process usage without persistence', async () => {
  const service = new SystemMonitoringService();
  const first = await service.getSnapshot();
  await delay(20);
  const second = await service.getSnapshot();

  assert.equal(second.live, true);
  assert.equal(second.persistence, 'NONE');
  assert.equal(typeof second.identity.hostname, 'string');
  assert.ok(second.identity.logicalCores >= 1);
  assert.ok(second.cpu.cores.length >= 1);
  assert.equal(typeof second.cpu.utilizationPercent, 'number');
  assert.ok(second.memory.totalBytes > 0);
  assert.ok(second.memory.usedBytes >= 0);
  assert.ok(Array.isArray(second.thermal.zones));
  assert.ok(Array.isArray(second.filesystems));
  assert.ok(Array.isArray(second.network));
  assert.equal(second.process.pid, process.pid);
  assert.equal(typeof second.process.cpuPercent, 'number');
  assert.ok(second.uptime.seconds >= first.uptime.seconds);
  assert.ok(['HEALTHY', 'WARNING', 'CRITICAL'].includes(second.status));
});

test('SystemMonitoringService parses Linux identity files and creates threshold warnings', () => {
  const service = new SystemMonitoringService();
  const release = service.parseOsRelease('NAME="Armbian"\nVERSION_ID="24.2"\nPRETTY_NAME="Armbian 24.2"\n');
  const cpuInfo = service.parseCpuInfo('model name\t: Cortex-A53\nHardware\t: Allwinner H3\nRevision\t: 0001\n');

  assert.equal(release.PRETTY_NAME, 'Armbian 24.2');
  assert.equal(cpuInfo.model, 'Cortex-A53');
  assert.equal(cpuInfo.hardware, 'Allwinner H3');

  const warnings = service.buildWarnings({
    cpu: {
      utilizationPercent: 95,
      loadAverage: { oneMinutePerCore: 1.2 },
    },
    memory: { usedPercent: 92 },
    thermal: { maximumCelsius: 86 },
    filesystems: [{ mountPoint: '/', usedPercent: 96 }],
    network: [],
    processUsage: { heapLimitUsedPercent: 10 },
  });

  assert.ok(warnings.some((warning) => warning.code === 'CPU_HIGH'));
  assert.ok(warnings.some((warning) => warning.code === 'MEMORY_CRITICAL'));
  assert.ok(warnings.some((warning) => warning.code === 'TEMPERATURE_CRITICAL'));
  assert.ok(warnings.some((warning) => warning.code === 'DISK_CRITICAL'));
});
