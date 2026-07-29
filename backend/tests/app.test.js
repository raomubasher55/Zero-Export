'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const app = require('../src/app');

async function request(path, options = {}) {
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
    const contentType = response.headers.get('content-type') || '';

    return {
      status: response.status,
      headers: response.headers,
      body: contentType.includes('application/json') ? await response.json() : undefined,
    };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('GET /health returns a liveness response and a request ID', async () => {
  const response = await request('/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.service, 'zero-export-modbus-core');
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
});

test('GET /api/v1 advertises the versioned EMS domain resources', async () => {
  const response = await request('/api/v1');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.resources.devices, '/api/v1/devices');
  assert.equal(response.body.data.resources.registerProfiles, '/api/v1/register-profiles');
  assert.equal(response.body.data.resources.modbusRead, '/api/v1/devices/:deviceId/modbus/read');
  assert.equal(response.body.data.resources.pollDevice, '/api/v1/devices/:deviceId/poll');
  assert.equal(response.body.data.resources.latestValues, '/api/v1/devices/:deviceId/values');
  assert.equal(response.body.data.resources.gateway, '/api/v1/gateway');
  assert.equal(response.body.data.resources.gatewayTraffic, '/api/v1/gateway/traffic');
  assert.equal(response.body.data.resources.system, '/api/v1/system');
  assert.equal(
    response.body.data.resources.registerProfileImport,
    '/api/v1/register-profiles/import',
  );
  assert.equal(
    response.body.data.resources.registerProfileExport,
    '/api/v1/register-profiles/export',
  );
});

test('device routes reject malformed commands before accessing the database', async () => {
  const response = await request('/api/v1/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Missing required device configuration' }),
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.ok(response.body.error.details.length > 0);
});

test('GET /api/v1/polling/status returns scheduler state without requiring a device query', async () => {
  const response = await request('/api/v1/polling/status');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.data.running, 'boolean');
});

test('register-profile import rejects invalid files before database access', async () => {
  const response = await request('/api/v1/register-profiles/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'unknown', version: 1, profiles: [] }),
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('gateway traffic analyzer is process-memory-only and available without database traffic storage', async () => {
  const response = await request('/api/v1/gateway/traffic?limit=10');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.settings.inMemoryOnly, true);
  assert.equal(response.body.data.settings.persistence, 'NONE');
  assert.ok(Array.isArray(response.body.data.events));
});

test('system endpoint returns live process-memory-only Orange Pi diagnostics', async () => {
  const response = await request('/api/v1/system');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.live, true);
  assert.equal(response.body.data.persistence, 'NONE');
  assert.ok(response.body.data.identity.logicalCores >= 1);
  assert.ok(response.body.data.memory.totalBytes > 0);
  assert.ok(Array.isArray(response.body.data.network));
});

test('gateway route rejects unsafe configuration before accessing the database', async () => {
  const response = await request('/api/v1/gateway', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enabled: true,
      unitId: 1,
      tcp: { enabled: false, host: '0.0.0.0', port: 1502 },
      rtu: {
        enabled: false,
        serialPath: '/dev/ttyUSB1',
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      },
      mappings: [],
    }),
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('Modbus command routes reject unsafe raw requests before accessing the database', async () => {
  const response = await request('/api/v1/devices/507f1f77bcf86cd799439011/modbus/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registerType: 'HOLDING_REGISTER',
      address: 0,
      quantity: 126,
    }),
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('unknown paths receive the standardized not-found error contract', async () => {
  const response = await request('/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.ok(response.body.error.requestId);
});
