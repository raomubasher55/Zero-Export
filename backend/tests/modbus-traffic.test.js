'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { ModbusTrafficAnalyzer } = require('../src/gateway/modbus-traffic-analyzer');
const { attachRtuTrafficObserver } = require('../src/gateway/modbus-traffic-observers');
const {
  extractTcpFrames,
  parseRtuRequest,
  parseTcpRequest,
  parseTcpResponse,
} = require('../src/gateway/modbus-traffic-protocol');
const { interpretRegisterWords } = require('../src/gateway/modbus-value-interpreter');

function tcpFrame(transactionId, unitId, pdu) {
  const frame = Buffer.alloc(7 + pdu.length);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(pdu.length + 1, 4);
  frame.writeUInt8(unitId, 6);
  pdu.copy(frame, 7);
  return frame;
}

test('traffic protocol parses fragmented TCP FC03 requests and responses', () => {
  const requestFrame = tcpFrame(25, 7, Buffer.from([3, 0, 100, 0, 2]));
  const first = extractTcpFrames(Buffer.alloc(0), requestFrame.subarray(0, 5));
  assert.equal(first.frames.length, 0);
  const second = extractTcpFrames(first.remaining, requestFrame.subarray(5));
  assert.equal(second.frames.length, 1);

  const request = parseTcpRequest(second.frames[0]);
  assert.equal(request.transactionId, 25);
  assert.equal(request.unitId, 7);
  assert.equal(request.functionCode, 3);
  assert.equal(request.registerType, 'HOLDING_REGISTER');
  assert.equal(request.address, 100);
  assert.equal(request.endAddress, 101);
  assert.equal(request.quantity, 2);
  assert.deepEqual(request.possibleDataTypes, ['UINT32', 'INT32', 'FLOAT32', 'TWO_UINT16_VALUES']);

  const responseFrame = tcpFrame(25, 7, Buffer.from([3, 4, 0x12, 0x34, 0xab, 0xcd]));
  const response = parseTcpResponse(responseFrame, request);
  assert.equal(response.success, true);
  assert.deepEqual(response.responseValues, [0x1234, 0xabcd]);
});

test('traffic protocol captures RTU FC16 write values', () => {
  const request = parseRtuRequest(
    Buffer.from([1, 16, 0, 20, 0, 2, 4, 0x12, 0x34, 0xab, 0xcd, 0, 0]),
  );
  assert.equal(request.functionCode, 16);
  assert.equal(request.operation, 'WRITE');
  assert.equal(request.address, 20);
  assert.equal(request.quantity, 2);
  assert.deepEqual(request.requestValues, [0x1234, 0xabcd]);
});

test('RTU observer correlates serial requests and responses without persistence', () => {
  const analyzer = new ModbusTrafficAnalyzer();
  const parser = new EventEmitter();
  const serialPort = {
    write() {
      return true;
    },
  };
  const cleanup = attachRtuTrafficObserver(
    { _server: parser, _serverPath: serialPort },
    analyzer,
    { serialPath: '/dev/ttyUSB1' },
  );

  parser.emit('data', Buffer.from([1, 4, 0, 10, 0, 2, 0, 0]));
  serialPort.write(Buffer.from([1, 4, 4, 0, 1, 0, 2, 0, 0]));

  const captured = analyzer.list({ limit: 10 }).events[0];
  assert.equal(captured.transport, 'RTU');
  assert.equal(captured.serialPath, '/dev/ttyUSB1');
  assert.equal(captured.functionCode, 4);
  assert.equal(captured.address, 10);
  assert.deepEqual(captured.responseValues, [1, 2]);
  assert.equal(analyzer.getSettings().persistence, 'NONE');
  cleanup();
});

test('in-memory traffic analyzer aggregates request patterns and never persists', () => {
  const analyzer = new ModbusTrafficAnalyzer({ capacity: 100 });
  const base = {
    id: 'event',
    transport: 'TCP',
    client: { address: '192.168.1.50', port: 50000 },
    unitId: 1,
    transactionId: 1,
    functionCode: 3,
    functionName: 'Read Holding Registers',
    operation: 'READ',
    registerType: 'HOLDING_REGISTER',
    address: 100,
    endAddress: 101,
    quantity: 2,
    registerReference: '40101',
    possibleDataTypes: ['UINT32', 'INT32', 'FLOAT32'],
    requestValues: [],
    responseValues: [0, 1000],
    requestHex: '00',
    responseHex: '00',
    success: true,
    exceptionCode: null,
    transportError: null,
    durationMs: 1,
    mappings: [{ key: 'grid_power', coveredAddresses: [100, 101] }],
  };
  analyzer.store({
    ...base,
    id: 'event-1',
    requestAt: '2026-01-01T00:00:00.000Z',
    responseAt: '2026-01-01T00:00:00.001Z',
  });
  analyzer.store({
    ...base,
    id: 'event-2',
    requestAt: '2026-01-01T00:00:00.500Z',
    responseAt: '2026-01-01T00:00:00.501Z',
  });

  const analysis = analyzer.analyze();
  assert.equal(analysis.summary.inMemoryOnly, true);
  assert.equal(analysis.summary.uniquePatterns, 1);
  assert.equal(analysis.patterns[0].count, 2);
  assert.equal(analysis.patterns[0].averageIntervalMs, 500);
  assert.equal(analysis.patterns[0].requestsPerMinute, 120);
  assert.deepEqual(analysis.patterns[0].mappings, ['grid_power']);
  assert.equal(analysis.mappingSuggestions[0].status, 'FULL');
  assert.match(analysis.mappingSuggestions[0].recommendation, /already mapped/);
  assert.equal(analyzer.getSettings().persistence, 'NONE');
});

test('traffic analyzer discards oldest events at its bounded memory limit', () => {
  const analyzer = new ModbusTrafficAnalyzer({ capacity: 100 });
  for (let index = 0; index < 101; index += 1) {
    analyzer.store({
      id: String(index),
      requestAt: new Date(2026, 0, 1, 0, 0, 0, index).toISOString(),
      transport: 'RTU',
      serialPath: '/dev/ttyUSB1',
      unitId: 1,
      functionCode: 3,
      functionName: 'Read Holding Registers',
      operation: 'READ',
      registerType: 'HOLDING_REGISTER',
      address: 0,
      endAddress: 0,
      quantity: 1,
      possibleDataTypes: ['UINT16'],
      responseValues: [index],
      mappings: [],
      success: true,
    });
  }

  assert.equal(analyzer.list({ limit: 500 }).events.length, 100);
  assert.equal(analyzer.getSettings().droppedEvents, 1);
  assert.equal(analyzer.list({ limit: 500 }).events.at(-1).id, '1');
});

test('value interpreter shows candidate type and byte-order interpretations', () => {
  const result = interpretRegisterWords([0x0001, 0x0002], {
    scaleFactor: 0.1,
    offset: 0,
  });
  const uint32Abcd = result.candidates.find(
    (candidate) => candidate.dataType === 'UINT32' && candidate.order === 'ABCD',
  );
  const uint32Cdab = result.candidates.find(
    (candidate) => candidate.dataType === 'UINT32' && candidate.order === 'CDAB',
  );

  assert.ok(Math.abs(uint32Abcd.value - 6553.8) < 1e-9);
  assert.ok(Math.abs(uint32Cdab.value - 13107.3) < 1e-9);
  assert.match(result.note, /candidate interpretations only/);
});
