'use strict';

const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');

const DEFAULT_CAPACITY = 2000;
const MAX_CAPACITY = 10000;

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function clientKey(event) {
  if (event.transport === 'TCP') {
    return event.client?.address
      ? `${event.client.address}:${event.client.port ?? 'unknown'}`
      : 'TCP client';
  }
  return event.serialPath || 'RTU line';
}

function eventSignature(event) {
  return [
    event.transport,
    clientKey(event),
    event.unitId,
    event.functionCode,
    event.address ?? '-',
    event.quantity ?? '-',
  ].join('|');
}

class ModbusTrafficAnalyzer {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.capacity = options.capacity || DEFAULT_CAPACITY;
    this.events = [];
    this.pending = new Map();
    this.sessions = new Map();
    this.mappingResolver = options.mappingResolver || (() => []);
    this.totalCaptured = 0;
    this.droppedEvents = 0;
  }

  setMappingResolver(resolver) {
    this.mappingResolver = typeof resolver === 'function' ? resolver : () => [];
  }

  updateSettings({ enabled, capacity } = {}) {
    if (enabled !== undefined) this.enabled = Boolean(enabled);
    if (capacity !== undefined) {
      this.capacity = Math.min(MAX_CAPACITY, Math.max(100, Number(capacity) || DEFAULT_CAPACITY));
      this.trim();
    }
    return this.getSettings();
  }

  getSettings() {
    return {
      enabled: this.enabled,
      capacity: this.capacity,
      inMemoryOnly: true,
      persistence: 'NONE',
      retainedEvents: this.events.length,
      totalCaptured: this.totalCaptured,
      droppedEvents: this.droppedEvents,
    };
  }

  openSession(details) {
    const id = details.id || randomUUID();
    const session = {
      id,
      transport: details.transport,
      client: details.client || null,
      serialPath: details.serialPath || null,
      connectedAt: new Date().toISOString(),
      disconnectedAt: null,
      active: true,
      requestCount: 0,
      lastRequestAt: null,
    };
    this.sessions.set(id, session);
    if (this.sessions.size > 500) {
      const removable = [...this.sessions.values()]
        .filter((item) => !item.active)
        .sort((left, right) => new Date(left.connectedAt) - new Date(right.connectedAt));
      while (this.sessions.size > 500 && removable.length > 0) {
        this.sessions.delete(removable.shift().id);
      }
    }
    return id;
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.active = false;
    session.disconnectedAt = new Date().toISOString();
  }

  beginRequest(details, request) {
    if (!this.enabled || !request) return null;
    const id = `${Date.now()}-${this.totalCaptured + this.pending.size + 1}`;
    const requestAt = new Date();
    const mappings = request.registerType && request.address !== null
      ? this.mappingResolver(request.registerType, request.address, request.quantity || 1)
      : [];
    const pending = {
      id,
      startedAt: performance.now(),
      event: {
        id,
        transport: details.transport,
        sessionId: details.sessionId || null,
        client: details.client || null,
        serialPath: details.serialPath || null,
        requestAt: requestAt.toISOString(),
        responseAt: null,
        durationMs: null,
        ...request,
        mappings,
        responseHex: null,
        responseValues: [],
        success: null,
        exceptionCode: null,
        exceptionName: null,
        transportError: null,
      },
    };
    this.pending.set(id, pending);

    const session = this.sessions.get(details.sessionId);
    if (session) {
      session.requestCount += 1;
      session.lastRequestAt = requestAt.toISOString();
    }
    return id;
  }

  completeRequest(token, response) {
    const pending = this.pending.get(token);
    if (!pending || !response) return null;
    this.pending.delete(token);
    const completedAt = new Date();
    const event = {
      ...pending.event,
      responseAt: completedAt.toISOString(),
      durationMs: round(performance.now() - pending.startedAt, 3),
      responseHex: response.responseHex,
      responseValues: response.responseValues,
      success: response.success,
      exceptionCode: response.exceptionCode,
      exceptionName: response.exceptionName,
    };
    this.store(event);
    return event;
  }

  abortRequest(token, message = 'Connection closed before a response was captured.') {
    const pending = this.pending.get(token);
    if (!pending) return null;
    this.pending.delete(token);
    const event = {
      ...pending.event,
      responseAt: new Date().toISOString(),
      durationMs: round(performance.now() - pending.startedAt, 3),
      success: false,
      transportError: message,
    };
    this.store(event);
    return event;
  }

  store(event) {
    this.events.push(event);
    this.totalCaptured += 1;
    this.trim();
  }

  trim() {
    if (this.events.length <= this.capacity) return;
    const overflow = this.events.length - this.capacity;
    this.events.splice(0, overflow);
    this.droppedEvents += overflow;
  }

  clear() {
    const cleared = this.events.length;
    this.events = [];
    this.totalCaptured = 0;
    this.droppedEvents = 0;
    for (const session of this.sessions.values()) {
      session.requestCount = 0;
      session.lastRequestAt = null;
    }
    return { cleared, pendingRequests: this.pending.size };
  }

  list(query = {}) {
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
    const filtered = this.events.filter((event) => {
      if (query.transport && event.transport !== query.transport) return false;
      if (query.functionCode && event.functionCode !== Number(query.functionCode)) return false;
      if (query.operation && event.operation !== query.operation) return false;
      if (query.client && !clientKey(event).toLowerCase().includes(query.client.toLowerCase())) return false;
      if (query.address !== undefined && query.address !== '') {
        const address = Number(query.address);
        if (event.address === null || address < event.address || address > event.endAddress) return false;
      }
      if (query.success !== undefined && query.success !== '') {
        if (event.success !== (query.success === true || query.success === 'true')) return false;
      }
      return true;
    });

    return {
      events: filtered.slice(-limit).reverse(),
      totalMatching: filtered.length,
      pendingRequests: this.pending.size,
      settings: this.getSettings(),
      capturedAt: new Date().toISOString(),
    };
  }

  analyze() {
    const chronological = [...this.events].sort(
      (left, right) => new Date(left.requestAt) - new Date(right.requestAt),
    );
    const patterns = new Map();
    const functionCodes = new Map();
    const clients = new Map();

    for (const event of chronological) {
      const signature = eventSignature(event);
      let pattern = patterns.get(signature);
      if (!pattern) {
        pattern = {
          signature,
          transport: event.transport,
          client: clientKey(event),
          unitId: event.unitId,
          functionCode: event.functionCode,
          functionName: event.functionName,
          operation: event.operation,
          registerType: event.registerType,
          address: event.address,
          endAddress: event.endAddress,
          registerReference: event.registerReference,
          quantity: event.quantity,
          possibleDataTypes: event.possibleDataTypes,
          count: 0,
          successCount: 0,
          exceptionCount: 0,
          firstRequestAt: event.requestAt,
          lastRequestAt: event.requestAt,
          intervals: [],
          lastTimestamp: null,
          mappings: new Set(),
          coveredAddresses: new Set(),
          latestResponseValues: [],
        };
        patterns.set(signature, pattern);
      }
      const timestamp = new Date(event.requestAt).getTime();
      if (pattern.lastTimestamp !== null) pattern.intervals.push(timestamp - pattern.lastTimestamp);
      pattern.lastTimestamp = timestamp;
      pattern.lastRequestAt = event.requestAt;
      pattern.count += 1;
      if (event.success) pattern.successCount += 1;
      if (event.exceptionCode || event.transportError) pattern.exceptionCount += 1;
      event.mappings.forEach((mapping) => {
        pattern.mappings.add(mapping.key);
        mapping.coveredAddresses?.forEach((address) => pattern.coveredAddresses.add(address));
      });
      pattern.latestResponseValues = event.responseValues;

      const functionEntry = functionCodes.get(event.functionCode) || {
        functionCode: event.functionCode,
        functionName: event.functionName,
        count: 0,
      };
      functionEntry.count += 1;
      functionCodes.set(event.functionCode, functionEntry);

      const key = clientKey(event);
      const client = clients.get(key) || {
        client: key,
        transport: event.transport,
        count: 0,
        firstRequestAt: event.requestAt,
        lastRequestAt: event.requestAt,
        unitIds: new Set(),
        functionCodes: new Set(),
      };
      client.count += 1;
      client.lastRequestAt = event.requestAt;
      client.unitIds.add(event.unitId);
      client.functionCodes.add(event.functionCode);
      clients.set(key, client);
    }

    const normalizedPatterns = [...patterns.values()]
      .map((pattern) => {
        const intervalTotal = pattern.intervals.reduce((sum, value) => sum + value, 0);
        return {
          ...pattern,
          mappings: [...pattern.mappings],
          mappedAddressCount: pattern.coveredAddresses.size,
          mappingCoverage:
            pattern.address === null || pattern.quantity === null
              ? 'NOT_APPLICABLE'
              : pattern.coveredAddresses.size >= pattern.quantity
                ? 'FULL'
                : pattern.coveredAddresses.size > 0
                  ? 'PARTIAL'
                  : 'NONE',
          coveredAddresses: undefined,
          averageIntervalMs: pattern.intervals.length
            ? round(intervalTotal / pattern.intervals.length)
            : null,
          minimumIntervalMs: pattern.intervals.length ? Math.min(...pattern.intervals) : null,
          maximumIntervalMs: pattern.intervals.length ? Math.max(...pattern.intervals) : null,
          requestsPerMinute:
            pattern.intervals.length && intervalTotal > 0
              ? round((pattern.intervals.length * 60000) / intervalTotal)
              : null,
          intervals: undefined,
          lastTimestamp: undefined,
        };
      })
      .sort((left, right) => right.count - left.count);

    const firstAt = chronological[0]?.requestAt;
    const lastAt = chronological.at(-1)?.requestAt;
    const observedMs = firstAt && lastAt ? new Date(lastAt) - new Date(firstAt) : 0;
    const mappingSuggestions = normalizedPatterns
      .filter((pattern) => pattern.address !== null && pattern.quantity)
      .map((pattern) => ({
        signature: pattern.signature,
        status: pattern.mappingCoverage,
        client: pattern.client,
        unitId: pattern.unitId,
        functionCode: pattern.functionCode,
        functionName: pattern.functionName,
        registerType: pattern.registerType,
        address: pattern.address,
        endAddress: pattern.endAddress,
        quantity: pattern.quantity,
        count: pattern.count,
        averageIntervalMs: pattern.averageIntervalMs,
        requestsPerMinute: pattern.requestsPerMinute,
        possibleDataTypes: pattern.possibleDataTypes,
        mappedKeys: pattern.mappings,
        priority:
          pattern.averageIntervalMs !== null && pattern.averageIntervalMs <= 2000
            ? 'HIGH_FREQUENCY'
            : 'NORMAL',
        recommendation:
          pattern.mappingCoverage === 'FULL'
            ? 'The complete requested range is already mapped. Verify value, unit, order, scale, and import/export sign on the inverter display.'
            : pattern.mappingCoverage === 'PARTIAL'
              ? 'Part of this requested range is unmapped. Add mappings for every missing address before compatibility testing.'
              : `Create an output mapping in ${pattern.registerType} at zero-based address ${pattern.address} with ${pattern.quantity} word(s)/bit(s), then confirm the encoding from the supported-meter manual.`,
      }));

    return {
      summary: {
        retainedRequests: this.events.length,
        totalCaptured: this.totalCaptured,
        pendingRequests: this.pending.size,
        successfulRequests: this.events.filter((event) => event.success).length,
        exceptions: this.events.filter((event) => event.exceptionCode || event.transportError).length,
        reads: this.events.filter((event) => event.operation === 'READ').length,
        writes: this.events.filter((event) => event.operation === 'WRITE').length,
        uniquePatterns: normalizedPatterns.length,
        uniqueClients: clients.size,
        observedFrom: firstAt || null,
        observedTo: lastAt || null,
        overallRequestsPerMinute:
          chronological.length > 1 && observedMs > 0
            ? round(((chronological.length - 1) * 60000) / observedMs)
            : null,
        inMemoryOnly: true,
      },
      patterns: normalizedPatterns,
      mappingSuggestions,
      addressRanges: normalizedPatterns
        .filter((pattern) => pattern.address !== null)
        .map((pattern) => ({
          signature: pattern.signature,
          registerType: pattern.registerType,
          address: pattern.address,
          endAddress: pattern.endAddress,
          quantity: pattern.quantity,
          functionCode: pattern.functionCode,
          count: pattern.count,
          client: pattern.client,
          mappings: pattern.mappings,
        })),
      functionCodes: [...functionCodes.values()].sort((left, right) => right.count - left.count),
      clients: [...clients.values()]
        .map((client) => ({
          ...client,
          unitIds: [...client.unitIds],
          functionCodes: [...client.functionCodes],
        }))
        .sort((left, right) => right.count - left.count),
      sessions: [...this.sessions.values()]
        .sort((left, right) => new Date(right.connectedAt) - new Date(left.connectedAt))
        .slice(0, 100),
      recentSequence: chronological.slice(-30).map((event) => ({
        id: event.id,
        requestAt: event.requestAt,
        client: clientKey(event),
        functionCode: event.functionCode,
        address: event.address,
        quantity: event.quantity,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  export(format = 'json') {
    if (format === 'json') {
      return JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          inMemoryOnly: true,
          events: [...this.events].reverse(),
          analysis: this.analyze(),
        },
        null,
        2,
      );
    }

    const headers = [
      'requestAt',
      'transport',
      'client',
      'unitId',
      'functionCode',
      'functionName',
      'registerType',
      'address',
      'quantity',
      'success',
      'exceptionCode',
      'durationMs',
      'requestValues',
      'responseValues',
      'requestHex',
      'responseHex',
    ];
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = this.events.map((event) =>
      [
        event.requestAt,
        event.transport,
        clientKey(event),
        event.unitId,
        event.functionCode,
        event.functionName,
        event.registerType,
        event.address,
        event.quantity,
        event.success,
        event.exceptionCode,
        event.durationMs,
        JSON.stringify(event.requestValues),
        JSON.stringify(event.responseValues),
        event.requestHex,
        event.responseHex,
      ]
        .map(escape)
        .join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }
}

const modbusTrafficAnalyzer = new ModbusTrafficAnalyzer();

module.exports = {
  DEFAULT_CAPACITY,
  MAX_CAPACITY,
  ModbusTrafficAnalyzer,
  clientKey,
  eventSignature,
  modbusTrafficAnalyzer,
};
