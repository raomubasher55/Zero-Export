'use strict';

const { REGISTER_DATA_TYPES } = require('../constants/modbus');

function expectedWordLength(dataType) {
  switch (dataType) {
    case REGISTER_DATA_TYPES.INT16:
    case REGISTER_DATA_TYPES.UINT16:
    case REGISTER_DATA_TYPES.BIT:
      return 1;
    case REGISTER_DATA_TYPES.INT32:
    case REGISTER_DATA_TYPES.UINT32:
    case REGISTER_DATA_TYPES.FLOAT32:
      return 2;
    case REGISTER_DATA_TYPES.FLOAT64:
      return 4;
    case REGISTER_DATA_TYPES.STRING:
      return undefined;
    default:
      return undefined;
  }
}

module.exports = {
  expectedWordLength,
};
