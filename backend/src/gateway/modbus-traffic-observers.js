'use strict';

const {
  extractTcpFrames,
  parseRtuRequest,
  parseRtuResponse,
  parseTcpRequest,
  parseTcpResponse,
} = require('./modbus-traffic-protocol');

const RESPONSE_TIMEOUT_MS = 10000;

function pendingEntry(analyzer, details, request) {
  const token = analyzer.beginRequest(details, request);
  if (!token) return null;
  const entry = { token, request, timer: null };
  entry.timer = setTimeout(() => {
    analyzer.abortRequest(token, 'No Modbus response was captured within 10 seconds.');
  }, RESPONSE_TIMEOUT_MS);
  entry.timer.unref?.();
  return entry;
}

function finishEntry(analyzer, entry, response) {
  if (!entry) return;
  clearTimeout(entry.timer);
  analyzer.completeRequest(entry.token, response);
}

function abortEntry(analyzer, entry, reason) {
  if (!entry) return;
  clearTimeout(entry.timer);
  analyzer.abortRequest(entry.token, reason);
}

function attachTcpTrafficObserver(server, analyzer) {
  const netServer = server?._server;
  if (!netServer?.on) return () => undefined;
  const socketCleanups = new Set();

  const onConnection = (socket) => {
    const client = {
      address: socket.remoteAddress || null,
      port: socket.remotePort || null,
      localAddress: socket.localAddress || null,
      localPort: socket.localPort || null,
    };
    const sessionId = analyzer.openSession({ transport: 'TCP', client });
    const details = { transport: 'TCP', client, sessionId };
    const pendingByTransaction = new Map();
    let requestBuffer = Buffer.alloc(0);
    let responseBuffer = Buffer.alloc(0);
    const originalWrite = socket.write;

    const onRequestData = (chunk) => {
      const parsed = extractTcpFrames(requestBuffer, Buffer.from(chunk));
      requestBuffer = parsed.remaining;
      for (const frame of parsed.frames) {
        const request = parseTcpRequest(frame);
        if (!request) continue;
        const entry = pendingEntry(analyzer, details, request);
        if (!entry) continue;
        const queue = pendingByTransaction.get(request.transactionId) || [];
        queue.push(entry);
        pendingByTransaction.set(request.transactionId, queue);
      }
    };

    socket.write = function observedWrite(chunk, ...args) {
      if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
        const parsed = extractTcpFrames(responseBuffer, Buffer.from(chunk));
        responseBuffer = parsed.remaining;
        for (const frame of parsed.frames) {
          const transactionId = frame.readUInt16BE(0);
          const queue = pendingByTransaction.get(transactionId);
          const entry = queue?.shift();
          if (queue?.length === 0) pendingByTransaction.delete(transactionId);
          if (entry) finishEntry(analyzer, entry, parseTcpResponse(frame, entry.request));
        }
      }
      return originalWrite.call(this, chunk, ...args);
    };

    const cleanup = () => {
      socket.removeListener('data', onRequestData);
      if (socket.write !== originalWrite) socket.write = originalWrite;
      for (const queue of pendingByTransaction.values()) {
        queue.forEach((entry) =>
          abortEntry(analyzer, entry, 'TCP client disconnected before the Modbus response.'),
        );
      }
      pendingByTransaction.clear();
      analyzer.closeSession(sessionId);
      socketCleanups.delete(cleanup);
    };

    socket.on('data', onRequestData);
    socket.once('close', cleanup);
    socketCleanups.add(cleanup);
  };

  netServer.on('connection', onConnection);
  return () => {
    netServer.removeListener('connection', onConnection);
    for (const cleanup of [...socketCleanups]) cleanup();
  };
}

function attachRtuTrafficObserver(server, analyzer, endpoint) {
  const parser = server?._server;
  const serialPort = server?._serverPath;
  if (!parser?.on || !serialPort?.write) return () => undefined;

  const serialPath = endpoint.serialPath;
  const sessionId = analyzer.openSession({
    id: `RTU:${serialPath}`,
    transport: 'RTU',
    serialPath,
  });
  const details = { transport: 'RTU', serialPath, sessionId };
  const pending = [];
  const originalWrite = serialPort.write;

  const onRequestData = (chunk) => {
    const request = parseRtuRequest(Buffer.from(chunk));
    const entry = pendingEntry(analyzer, details, request);
    if (entry) pending.push(entry);
  };

  serialPort.write = function observedSerialWrite(chunk, ...args) {
    if ((Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) && pending.length > 0) {
      const entry = pending.shift();
      finishEntry(analyzer, entry, parseRtuResponse(Buffer.from(chunk), entry.request));
    }
    return originalWrite.call(this, chunk, ...args);
  };

  parser.on('data', onRequestData);
  return () => {
    parser.removeListener('data', onRequestData);
    if (serialPort.write !== originalWrite) serialPort.write = originalWrite;
    pending.forEach((entry) =>
      abortEntry(analyzer, entry, 'RTU endpoint stopped before the Modbus response.'),
    );
    pending.length = 0;
    analyzer.closeSession(sessionId);
  };
}

module.exports = {
  RESPONSE_TIMEOUT_MS,
  attachRtuTrafficObserver,
  attachTcpTrafficObserver,
};
