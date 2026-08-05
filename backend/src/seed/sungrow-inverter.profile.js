'use strict';

/**
 * Built-in Sungrow inverter register profile.
 *
 * Source: Sungrow inverter protocol register map.
 *
 * Section 1 (protocol/identity, holding registers FC03): protocol number and
 * version, ARM/DSP software versions (UTF-8 strings), serial number, device
 * type code, nominal active power, output grid type.
 *
 * Section 2 (live telemetry, input registers FC04): daily/total yield,
 * running time, internal temperature, apparent power, MPPT 1-8 DC voltages
 * and currents, total DC input power, grid phase/line voltages, phase AC
 * currents, total active (S32 W) and reactive power, power factor, grid
 * frequency (0.1 Hz), work state bitmask.
 *
 * Addresses are used directly as the wire address (protocol addresses).
 */

const { REGISTER_DATA_TYPES } = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

function register({ address, key, name, dataType, scaleFactor = 1, unit, group, holding = false, length }) {
  return {
    key,
    name,
    // Telemetry is FC04 input; protocol/identity registers are FC03 holding.
    registerType: holding ? 'HOLDING_REGISTER' : 'INPUT_REGISTER',
    address,
    dataType,
    length: length || expectedWordLength(dataType),
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor,
    offset: 0,
    unit: unit || undefined,
    group,
    writable: false,
    enabled: true,
    sortOrder: 0,
  };
}

function stringRegister({ address, key, name, words, group, holding = true }) {
  return register({
    address,
    key,
    name,
    dataType: REGISTER_DATA_TYPES.STRING,
    length: words,
    group,
    holding,
  });
}

const IDENTITY = 'Identity';
const MEASUREMENTS = 'Measurements';
const ENERGY = 'Energy';
const STATUS = 'Status';
const MPPT = 'MPPT';

const registers = [
  // --- Protocol / identity (FC03 holding) ---
  register({ address: 4950, key: 'protocol_number', name: 'Protocol number', dataType: REGISTER_DATA_TYPES.UINT32, group: IDENTITY, holding: true }),
  register({ address: 4952, key: 'protocol_version', name: 'Protocol version', dataType: REGISTER_DATA_TYPES.UINT32, group: IDENTITY, holding: true }),
  stringRegister({ address: 4954, key: 'arm_software_version', name: 'ARM software version', words: 15, group: IDENTITY }),
  stringRegister({ address: 4969, key: 'dsp_software_version', name: 'DSP software version', words: 15, group: IDENTITY }),
  stringRegister({ address: 4990, key: 'serial_number', name: 'Serial number', words: 10, group: IDENTITY }),
  register({ address: 5000, key: 'device_type_code', name: 'Device type code', dataType: REGISTER_DATA_TYPES.UINT16, group: IDENTITY, holding: true }),
  register({ address: 5001, key: 'nominal_active_power', name: 'Nominal active power', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'kW', group: IDENTITY, holding: true }),
  register({ address: 5002, key: 'output_grid_type', name: 'Output grid type', dataType: REGISTER_DATA_TYPES.UINT16, group: IDENTITY, holding: true }),

  // --- Live telemetry (FC04 input) ---
  register({ address: 5003, key: 'daily_yield', name: 'Daily energy yield', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'kWh', group: ENERGY }),
  register({ address: 5004, key: 'total_yield', name: 'Total energy yield', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),
  register({ address: 5006, key: 'total_running_time', name: 'Total running time', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'h', group: STATUS }),
  register({ address: 5008, key: 'internal_temperature', name: 'Internal temperature', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: '°C', group: STATUS }),
  register({ address: 5009, key: 'total_apparent_power', name: 'Total apparent power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'VA', group: MEASUREMENTS }),
  register({ address: 5011, key: 'mppt1_voltage', name: 'MPPT 1 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5012, key: 'mppt1_current', name: 'MPPT 1 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5013, key: 'mppt2_voltage', name: 'MPPT 2 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5014, key: 'mppt2_current', name: 'MPPT 2 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5015, key: 'mppt3_voltage', name: 'MPPT 3 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5016, key: 'mppt3_current', name: 'MPPT 3 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5017, key: 'total_dc_power', name: 'Total DC input power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: MPPT }),
  register({ address: 5019, key: 'grid_voltage_a', name: 'Grid phase A / AB line voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 5020, key: 'grid_voltage_b', name: 'Grid phase B / BC line voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 5021, key: 'grid_voltage_c', name: 'Grid phase C / CA line voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 5022, key: 'phase_a_current', name: 'Phase A AC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 5023, key: 'phase_b_current', name: 'Phase B AC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 5024, key: 'phase_c_current', name: 'Phase C AC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 5031, key: 'active_power', name: 'Total active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: MEASUREMENTS }),
  register({ address: 5033, key: 'reactive_power', name: 'Total reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'VAR', group: MEASUREMENTS }),
  register({ address: 5035, key: 'power_factor', name: 'Power factor', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.001, group: MEASUREMENTS }),
  register({ address: 5036, key: 'grid_frequency', name: 'Grid frequency', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'Hz', group: MEASUREMENTS }),
  register({ address: 5038, key: 'work_state', name: 'Work state (inverter status)', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 5115, key: 'mppt4_voltage', name: 'MPPT 4 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5116, key: 'mppt4_current', name: 'MPPT 4 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5117, key: 'mppt5_voltage', name: 'MPPT 5 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5118, key: 'mppt5_current', name: 'MPPT 5 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5119, key: 'mppt6_voltage', name: 'MPPT 6 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5120, key: 'mppt6_current', name: 'MPPT 6 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5121, key: 'mppt7_voltage', name: 'MPPT 7 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5122, key: 'mppt7_current', name: 'MPPT 7 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 5123, key: 'mppt8_voltage', name: 'MPPT 8 DC voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 5124, key: 'mppt8_current', name: 'MPPT 8 DC current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
];

const SUNGROW_PROFILE = Object.freeze({
  identifier: 'sungrow-inverter',
  name: 'Sungrow inverter',
  description:
    'Built-in Sungrow inverter register map: protocol/identity (FC03 holding: protocol number/version, ARM/DSP software versions, serial number, device type code, nominal power, grid type) and live telemetry (FC04 input: daily/total yield, running time, internal temperature, apparent power, MPPT 1-8 DC voltage/current, total DC power, grid phase/line voltages, phase currents, total active/reactive power, power factor, grid frequency, work state). Addresses are used directly as wire addresses.',
  manufacturer: 'Sungrow',
  model: 'SG series inverter',
  registers: Object.freeze(registers),
  isActive: true,
  maxReadQuantity: 50,
  tags: Object.freeze(['sungrow', 'inverter', 'built-in']),
  metadata: Object.freeze({
    profileVersion: 1,
    notes:
      'Protocol addresses used directly. Telemetry on FC04, identity on FC03. No writable power control registers were provided; add them once the site control map is confirmed.',
  }),
});

module.exports = {
  SUNGROW_PROFILE,
};
