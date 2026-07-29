'use strict';

const { randomUUID } = require('node:crypto');

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;

function requestId(req, res, next) {
  const suppliedId = req.get('x-request-id');
  const id = suppliedId && REQUEST_ID_PATTERN.test(suppliedId) ? suppliedId : randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
