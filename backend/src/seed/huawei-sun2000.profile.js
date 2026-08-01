'use strict';

/**
 * Built-in Huawei SUN2000 solar inverter register profile.
 *
 * Source: Huawei Solar Inverter Modbus Interface Definitions (V3.0).
 *
 * All entries are Modbus holding registers (FC03 reads). Addresses are used
 * directly as the wire address, matching Huawei's register numbering.
 * scaleFactor follows the manual's scale column (e.g. V/10 -> 0.1,
 * A/1000 -> 0.001, kW/1000 -> 0.001, Hz/100 -> 0.01, kWh/100 -> 0.01).
 */

const { REGISTER_DATA_TYPES } = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

function register({
  address,
  key,
  name,
  dataType,
  scaleFactor,
  unit,
  group,
  writable = false,
}) {
  return {
    key,
    name,
    registerType: 'HOLDING_REGISTER',
    address,
    dataType,
    length: expectedWordLength(dataType),
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor,
    offset: 0,
    unit: unit || undefined,
    group,
    writable,
    enabled: true,
    sortOrder: 0,
  };
}

const MEASUREMENTS = 'Measurements';
const ENERGY = 'Energy';
const CONTROL = 'Control';

const registers = [
  // --- Read registers (FC03) ---
  register({ address: 32066, key: 'uab_voltage', name: 'Line voltage Uab (L1-L2)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 32067, key: 'ubc_voltage', name: 'Line voltage Ubc (L2-L3)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 32068, key: 'uca_voltage', name: 'Line voltage Uca (L3-L1)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 32069, key: 'phase_a_voltage', name: 'Phase A voltage (L1-N)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 32070, key: 'phase_b_voltage', name: 'Phase B voltage (L2-N)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 32071, key: 'phase_c_voltage', name: 'Phase C voltage (L3-N)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 32072, key: 'phase_a_current', name: 'Phase A current (A1)', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.001, unit: 'A', group: MEASUREMENTS }),
  register({ address: 32074, key: 'phase_b_current', name: 'Phase B current (A2)', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.001, unit: 'A', group: MEASUREMENTS }),
  register({ address: 32076, key: 'phase_c_current', name: 'Phase C current (A3)', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.001, unit: 'A', group: MEASUREMENTS }),
  register({ address: 32080, key: 'active_power', name: 'Active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.001, unit: 'kW', group: MEASUREMENTS }),
  register({ address: 32085, key: 'grid_frequency', name: 'Grid frequency', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: 'Hz', group: MEASUREMENTS }),
  register({ address: 32106, key: 'total_yield', name: 'Total yield', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ address: 32114, key: 'daily_yield', name: 'Daily yield', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),

  // --- Active power control / write registers (FC06 / FC16) ---
  register({ address: 40125, key: 'active_power_derating', name: 'Active power derating', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: '%', group: CONTROL, writable: true }),
  register({ address: 40126, key: 'active_power_fixed_derating', name: 'Active power fixed derating', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: CONTROL, writable: true }),
];

const HUAWEI_SUN2000_PROFILE = Object.freeze({
  identifier: 'huawei-sun2000',
  name: 'Huawei SUN2000 inverter',
  description:
    'Built-in Huawei SUN2000 register map (Modbus Interface Definitions V3.0): line/phase voltages, phase currents, active power, grid frequency, daily/total yield (FC03 holding registers), plus writable active-power derating registers 40125 (0.1% steps) and 40126 (W).',
  manufacturer: 'Huawei',
  model: 'SUN2000',
  registers: Object.freeze(registers),
  isActive: true,
  tags: Object.freeze(['huawei', 'sun2000', 'inverter', 'built-in']),
  metadata: Object.freeze({
    profileVersion: 1,
    notes:
      'Huawei registers are used directly as wire addresses with FC03; derating register 40125 accepts 0-1000 (0.1% per step).',
  }),
});

module.exports = {
  HUAWEI_SUN2000_PROFILE,
};
