'use strict';

/**
 * Built-in Solis (Ginlong) inverter register profile — OFFICIAL 3X map.
 *
 * Source: Solis Inverter Official Modbus RTU Register Map (3X Series).
 *
 * Wire Address = Manual Register - 1. Real-time measurements, yields,
 * status, meter and DC values are input registers (FC04). The active power
 * limit is read at wire 3049 (FC04) and set through the 4X holding
 * equivalent at 4049 (FC06/FC16, 10000 = 100%, scale 0.01).
 */

const { REGISTER_DATA_TYPES } = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

function register({ address, key, name, dataType, scaleFactor = 1, unit, group, writable = false }) {
  return {
    key,
    name,
    // Solis measurements are input registers (FC04); the writable power
    // limit set register is a holding register (4X equivalent, FC06/FC16).
    registerType: writable ? 'HOLDING_REGISTER' : 'INPUT_REGISTER',
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
const STATUS = 'Status';
const METER = 'Meter';
const DC = 'DC Input';
const CONTROL = 'Control';

const registers = [
  // --- AC output & grid (FC04) ---
  register({ address: 3004, key: 'active_power', name: 'Active power (AC output)', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: MEASUREMENTS }),
  register({ address: 3033, key: 'grid_voltage_a', name: 'Grid voltage A (A phase / AB line)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 3034, key: 'grid_voltage_b', name: 'Grid voltage B (B phase / BC line)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 3035, key: 'grid_voltage_c', name: 'Grid voltage C (C phase / CA line)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 3036, key: 'grid_current_a', name: 'Grid current A', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 3037, key: 'grid_current_b', name: 'Grid current B', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 3038, key: 'grid_current_c', name: 'Grid current C', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 3042, key: 'grid_frequency', name: 'Grid frequency', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: 'Hz', group: MEASUREMENTS }),
  register({ address: 3050, key: 'power_factor', name: 'Power factor (actual adjust value)', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.001, group: MEASUREMENTS }),
  register({ address: 3055, key: 'reactive_power', name: 'Reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'Var', group: MEASUREMENTS }),
  register({ address: 3057, key: 'apparent_power', name: 'Apparent power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'VA', group: MEASUREMENTS }),

  // --- Generation & energy yield (FC04) ---
  register({ address: 3008, key: 'total_yield', name: 'Total energy (lifetime)', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),
  register({ address: 3010, key: 'monthly_generation', name: 'Energy this month', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),
  register({ address: 3012, key: 'last_month_generation', name: 'Energy last month', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),
  register({ address: 3014, key: 'daily_generation', name: 'Energy today', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'kWh', group: ENERGY }),
  register({ address: 3015, key: 'yesterday_generation', name: 'Energy last day (yesterday)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'kWh', group: ENERGY }),
  register({ address: 3016, key: 'yearly_generation', name: 'Energy this year', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),
  register({ address: 3018, key: 'last_year_generation', name: 'Energy last year', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),

  // --- System status & temperatures (FC04) ---
  register({ address: 2999, key: 'product_model', name: 'Product model', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3000, key: 'dsp_version', name: 'DSP software version', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3001, key: 'lcd_version', name: 'LCD software version', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3041, key: 'inverter_temperature', name: 'Inverter temperature', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: '°C', group: STATUS }),
  register({ address: 3043, key: 'inverter_status', name: 'Inverter status', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3060, key: 'serial_number_1', name: 'Serial number 1 (ASCII)', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3061, key: 'serial_number_2', name: 'Serial number 2 (ASCII)', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3062, key: 'serial_number_3', name: 'Serial number 3 (ASCII)', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3063, key: 'serial_number_4', name: 'Serial number 4 (ASCII)', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3066, key: 'fault_code_1', name: 'Fault code 1', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3067, key: 'fault_code_2', name: 'Fault code 2', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3068, key: 'fault_code_3', name: 'Fault code 3', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3069, key: 'fault_code_4', name: 'Fault code 4', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3070, key: 'fault_code_5', name: 'Fault code 5', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3071, key: 'working_status', name: 'Working status', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3092, key: 'igbt_temperature', name: 'AC NTC (IGBT) temperature', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: '°C', group: STATUS }),

  // --- Meter & grid power flow (FC04) ---
  register({ address: 3079, key: 'meter_total_active_generation', name: 'Meter total active generation', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'Wh', group: METER }),
  register({ address: 3081, key: 'meter_voltage', name: 'Meter voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: METER }),
  register({ address: 3082, key: 'meter_current', name: 'Meter current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: METER }),
  register({ address: 3083, key: 'meter_active_power', name: 'Meter active power (+ to grid / - from grid)', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: METER }),
  register({ address: 3110, key: 'internal_epm_switch', name: 'Internal EPM switch', dataType: REGISTER_DATA_TYPES.UINT16, group: METER }),
  register({ address: 3111, key: 'internal_epm_backflow_power', name: 'Internal EPM backflow power', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 100, unit: 'W', group: METER }),
  register({ address: 3113, key: 'epm_realtime_backflow_power', name: 'EPM real-time backflow power', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 10, unit: 'W', group: METER }),

  // --- DC input (FC04) ---
  register({ address: 3003, key: 'dc_input_type', name: 'DC input type', dataType: REGISTER_DATA_TYPES.UINT16, group: DC }),
  register({ address: 3006, key: 'total_dc_power', name: 'Total DC output power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: DC }),
  register({ address: 3031, key: 'dc_busbar_voltage', name: 'DC busbar voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 1, unit: 'V', group: DC }),
  register({ address: 3032, key: 'dc_half_busbar_voltage', name: 'DC half-busbar voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 1, unit: 'V', group: DC }),
  register({ address: 3021, key: 'dc_voltage_1', name: 'DC voltage 1', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: DC }),
  register({ address: 3022, key: 'dc_current_1', name: 'DC current 1', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: DC }),
  register({ address: 3023, key: 'dc_voltage_2', name: 'DC voltage 2', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: DC }),
  register({ address: 3024, key: 'dc_current_2', name: 'DC current 2', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: DC }),
  register({ address: 3025, key: 'dc_voltage_3', name: 'DC voltage 3', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: DC }),
  register({ address: 3026, key: 'dc_current_3', name: 'DC current 3', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: DC }),
  register({ address: 3027, key: 'dc_voltage_4', name: 'DC voltage 4', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: DC }),
  register({ address: 3028, key: 'dc_current_4', name: 'DC current 4', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: DC }),

  // --- Power control (FC04 read / 4X write) ---
  register({ address: 3049, key: 'active_power_limit', name: 'Power limit actual value', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: '%', group: CONTROL }),
  register({ address: 3052, key: 'reactive_power_limitation', name: 'Reactive power limitation', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 1, unit: '%', group: CONTROL }),
  register({ address: 3087, key: 'power_limit_switch_operation_bit', name: 'Power limit switch operation bit', dataType: REGISTER_DATA_TYPES.UINT16, group: CONTROL }),
  register({ address: 3089, key: 'power_limit_switch', name: 'Power limit switch', dataType: REGISTER_DATA_TYPES.UINT16, group: CONTROL }),
  register({ address: 3090, key: 'reactive_power_switch', name: 'Reactive power switch', dataType: REGISTER_DATA_TYPES.UINT16, group: CONTROL }),
  // 4X writable equivalent of the power limit (manual 3050 -> 4X wire 4049).
  register({ address: 4049, key: 'active_power_limit_set', name: 'Active power limit (set)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: '%', group: CONTROL, writable: true }),
];

const SOLIS_PROFILE = Object.freeze({
  identifier: 'solis-inverter',
  name: 'Solis inverter (Solics)',
  description:
    'Built-in Solis (Ginlong) inverter register map — official 3X series: AC grid voltages (phase/line), currents, frequency, active/reactive/apparent power, power factor, yields (today/yesterday/month/year/total), status, temperatures, serial number, fault codes, external meter (active power + to grid / - from grid), EPM, DC inputs, and power control. Wire address = manual register - 1; measurements are FC04 input registers; the power limit is read at 3049 and set at 4049 (FC06/FC16, 10000 = 100%).',
  manufacturer: 'Solis (Ginlong)',
  model: 'Solis 3X inverter',
  registers: Object.freeze(registers),
  isActive: true,
  maxReadQuantity: 50,
  tags: Object.freeze(['solis', 'solics', 'inverter', 'built-in']),
  metadata: Object.freeze({
    profileVersion: 6,
    notes:
      'Official 3X map. Wire address = manual - 1. Total lifetime yield at 3008; phase/line voltages at 3033-3035; meter active power at 3083 (+ export / - import); power limit read 3049, write 4049 (scale 0.01).',
  }),
});

module.exports = {
  SOLIS_PROFILE,
};
