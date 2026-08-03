'use strict';

/**
 * Built-in Solis (Ginlong) inverter register profile.
 *
 * Source: Solis Inverter Modbus RTU Register Map.
 *
 * Wire Address = Document Register - 1. Real-time measurements are input
 * registers (FC04); the power-limit control register is a holding register
 * (FC03 read / FC06·FC16 write).
 *
 * Conflicts resolved from the source table:
 *  - Reactive power placed at 0x0BBD (wire 3005) instead of 0x0BBC so it
 *    does not overlap active power (wire 3003-3004).
 *  - Total generation was listed at the same address as Grid Voltage A
 *    (0x0BC0); omitted until the correct address is confirmed.
 *
 * maxReadQuantity: 50 — the protocol recommends frames of at most 100 bytes
 * (50 registers).
 */

const { REGISTER_DATA_TYPES } = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

function register({ address, key, name, dataType, scaleFactor = 1, unit, group, writable = false }) {
  return {
    key,
    name,
    // Solis real-time measurements are input registers (FC04) per the Solis
    // Modbus RTU protocol; the writable power limit is a holding register
    // (FC03 read / FC06·FC16 write).
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
const MPPT = 'MPPT';
const STRINGS = 'PV Strings';
const CONTROL = 'Control';

const registers = [
  // --- AC output & grid (FC04) ---
  register({ address: 3003, key: 'active_power', name: 'Active power (AC output)', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: MEASUREMENTS }),
  register({ address: 3005, key: 'reactive_power', name: 'Reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'VAr', group: MEASUREMENTS }),
  register({ address: 3008, key: 'grid_voltage_a', name: 'Grid voltage A (R-phase)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 3009, key: 'grid_voltage_b', name: 'Grid voltage B (S-phase)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 3010, key: 'grid_voltage_c', name: 'Grid voltage C (T-phase)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MEASUREMENTS }),
  register({ address: 3011, key: 'grid_current_a', name: 'Grid current A (R-phase)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 3012, key: 'grid_current_b', name: 'Grid current B (S-phase)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 3013, key: 'grid_current_c', name: 'Grid current C (T-phase)', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MEASUREMENTS }),
  register({ address: 3017, key: 'grid_frequency', name: 'Grid frequency', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: 'Hz', group: MEASUREMENTS }),
  register({ address: 3034, key: 'power_factor', name: 'Power factor', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.001, group: MEASUREMENTS }),
  register({ address: 3056, key: 'apparent_power', name: 'Apparent power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'VA', group: MEASUREMENTS }),

  // --- Generation & yield (FC04) ---
  register({ address: 3014, key: 'daily_generation', name: 'Daily generation', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'kWh', group: ENERGY }),
  register({ address: 3015, key: 'monthly_generation', name: 'Monthly generation', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'kWh', group: ENERGY }),
  register({ address: 3018, key: 'yesterday_generation', name: 'Yesterday generation', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'kWh', group: ENERGY }),

  // --- System status & temperatures (FC04) ---
  register({ address: 3040, key: 'inverter_temperature', name: 'Inverter temperature', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: '°C', group: STATUS }),
  register({ address: 3042, key: 'inverter_status', name: 'Inverter operating status', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3043, key: 'fault_code_1', name: 'Fault code 1', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 3044, key: 'fault_code_2', name: 'Fault code 2', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),

  // --- Meter & grid power flow (FC04) ---
  register({ address: 3205, key: 'meter_grid_active_power', name: 'Grid active power (meter)', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: METER }),
  register({ address: 3207, key: 'meter_active_power_a', name: 'Meter active power A', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: METER }),
  register({ address: 3209, key: 'meter_active_power_b', name: 'Meter active power B', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: METER }),
  register({ address: 3211, key: 'meter_active_power_c', name: 'Meter active power C', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: METER }),

  // --- MPPT 1-15 (FC04) ---
  register({ address: 3500, key: 'mppt1_voltage', name: 'MPPT 1 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3501, key: 'mppt2_voltage', name: 'MPPT 2 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3502, key: 'mppt3_voltage', name: 'MPPT 3 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3503, key: 'mppt4_voltage', name: 'MPPT 4 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3504, key: 'mppt5_voltage', name: 'MPPT 5 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3505, key: 'mppt6_voltage', name: 'MPPT 6 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3506, key: 'mppt7_voltage', name: 'MPPT 7 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3507, key: 'mppt8_voltage', name: 'MPPT 8 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3508, key: 'mppt9_voltage', name: 'MPPT 9 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3509, key: 'mppt10_voltage', name: 'MPPT 10 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3510, key: 'mppt11_voltage', name: 'MPPT 11 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3511, key: 'mppt12_voltage', name: 'MPPT 12 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3512, key: 'mppt13_voltage', name: 'MPPT 13 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3513, key: 'mppt14_voltage', name: 'MPPT 14 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3514, key: 'mppt15_voltage', name: 'MPPT 15 voltage', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: MPPT }),
  register({ address: 3530, key: 'mppt1_current', name: 'MPPT 1 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3531, key: 'mppt2_current', name: 'MPPT 2 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3532, key: 'mppt3_current', name: 'MPPT 3 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3533, key: 'mppt4_current', name: 'MPPT 4 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3534, key: 'mppt5_current', name: 'MPPT 5 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3535, key: 'mppt6_current', name: 'MPPT 6 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3536, key: 'mppt7_current', name: 'MPPT 7 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3537, key: 'mppt8_current', name: 'MPPT 8 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3538, key: 'mppt9_current', name: 'MPPT 9 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3539, key: 'mppt10_current', name: 'MPPT 10 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3540, key: 'mppt11_current', name: 'MPPT 11 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3541, key: 'mppt12_current', name: 'MPPT 12 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3542, key: 'mppt13_current', name: 'MPPT 13 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3543, key: 'mppt14_current', name: 'MPPT 14 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),
  register({ address: 3544, key: 'mppt15_current', name: 'MPPT 15 current', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: MPPT }),

  // --- DC string voltage & current channels 1-32 (FC04) ---
  // Voltage at even wire addresses 3022..3084, current at odd 3023..3085.
];

// String channels 1-32 (voltage + current pairs).
for (let channel = 1; channel <= 32; channel += 1) {
  const voltageAddress = 3022 + (channel - 1) * 2;
  registers.push(
    register({ address: voltageAddress, key: `string${channel}_voltage`, name: `PV string ${channel} voltage`, dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'V', group: STRINGS }),
    register({ address: voltageAddress + 1, key: `string${channel}_current`, name: `PV string ${channel} current`, dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: 'A', group: STRINGS }),
  );
}

// --- Power control (FC03/FC06/FC16, holding) ---
// Document register 3051 used directly as the wire address (per the site's
// control layout). 0-10000 = 0-1000.0% in 0.1% steps.
registers.push(
  register({ address: 3051, key: 'active_power_limit', name: 'Active power limit', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: '%', group: CONTROL, writable: true }),
);

const SOLIS_PROFILE = Object.freeze({
  identifier: 'solis-inverter',
  name: 'Solis inverter (Solics)',
  description:
    'Built-in Solis (Ginlong) inverter register map (Modbus RTU): AC grid voltages/currents/frequency, active/apparent/reactive power, power factor, generation yields, inverter status and faults, external-meter grid power (import/export signed), 15 MPPT channels, 32 DC string channels — real-time measurements are input registers (FC04); the active power limit at 3051 is a writable holding register (FC06/FC16, 0.1% steps).',
  manufacturer: 'Solis (Ginlong)',
  model: 'Solis inverter',
  registers: Object.freeze(registers),
  isActive: true,
  maxReadQuantity: 50,
  tags: Object.freeze(['solis', 'solics', 'inverter', 'built-in']),
  metadata: Object.freeze({
    profileVersion: 4,
    notes:
      'Real-time measurements served as input registers (FC04) per the Solis protocol; the active power limit stays a writable holding register at 3051. Reactive power placed at 0x0BBD to avoid overlapping active power; total generation omitted (listed at the same address as Grid Voltage A) until confirmed.',
  }),
});

module.exports = {
  SOLIS_PROFILE,
};
