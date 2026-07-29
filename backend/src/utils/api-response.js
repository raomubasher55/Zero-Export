'use strict';

const HTTP_STATUS = require('../constants/http-status');

function sendSuccess(res, { statusCode = HTTP_STATUS.OK, data, meta } = {}) {
  const payload = {
    success: true,
    data,
  };

  if (meta) {
    payload.meta = meta;
  }

  return res.status(statusCode).json(payload);
}

function sendNoContent(res) {
  return res.status(HTTP_STATUS.NO_CONTENT).send();
}

module.exports = {
  sendSuccess,
  sendNoContent,
};
