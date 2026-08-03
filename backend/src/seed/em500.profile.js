'use strict';

/**
 * Built-in Eastron EM500 register profile.
 *
 * Source: EM500 register data manual — table 1 (instantaneous measurements,
 * 2-word values) and table 2 (energy counters, 4-word 64-bit values).
 *
 * All entries are Modbus input registers (FC04 reads). Addresses are the
 * zero-based input-register addresses from the manual's hex column.
 * scaleFactor follows the manual's UNIT column (e.g. V/100 -> 0.01,
 * A/10000 -> 0.0001, Hz/1000 -> 0.001).
 *
 * Byte/word order defaults to big-endian (ABCD), which is the common
 * Eastron/Modbus default; adjust per register if a site meter reports a
 * different order.
 *
 * The tariff control register (8448 / 0x2100) is a writable holding
 * register (FC06/FC16): 0 = tariff off, 1 = tariff on.
 */

const { REGISTER_DATA_TYPES } = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

function register({ hexAddress, key, name, dataType, scaleFactor, unit, group }) {
  return {
    key,
    name,
    registerType: 'INPUT_REGISTER',
    address: Number.parseInt(hexAddress, 16),
    dataType,
    length: expectedWordLength(dataType),
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

function controlRegister({ address, key, name, unit, group }) {
  return {
    key,
    name,
    registerType: 'HOLDING_REGISTER',
    address,
    dataType: 'UINT16',
    length: 1,
    byteOrder: 'BIG_ENDIAN',
    wordOrder: 'BIG_ENDIAN',
    bitIndex: 0,
    scaleFactor: 1,
    offset: 0,
    unit: unit || undefined,
    group,
    writable: true,
    enabled: true,
    sortOrder: 0,
  };
}

const MEASUREMENTS = 'Measurements';
const ENERGY = 'Energy';
const CONTROL = 'Control';

const registers = [
  // --- Table 1: instantaneous measurements (2 words each) ---
  register({ hexAddress: '0002', key: 'l1_phase_voltage', name: 'L1 phase voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0004', key: 'l2_phase_voltage', name: 'L2 phase voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0006', key: 'l3_phase_voltage', name: 'L3 phase voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0008', key: 'l1_current', name: 'L1 current', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.0001, unit: 'A', group: MEASUREMENTS }),
  register({ hexAddress: '000A', key: 'l2_current', name: 'L2 current', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.0001, unit: 'A', group: MEASUREMENTS }),
  register({ hexAddress: '000C', key: 'l3_current', name: 'L3 current', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.0001, unit: 'A', group: MEASUREMENTS }),
  register({ hexAddress: '0048', key: 'neutral_current', name: 'Neutral current', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.0001, unit: 'A', group: MEASUREMENTS }),
  register({ hexAddress: '000E', key: 'l1_l2_voltage', name: 'L1-L2 voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0010', key: 'l2_l3_voltage', name: 'L2-L3 voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0012', key: 'l3_l1_voltage', name: 'L3-L1 voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0014', key: 'l1_active_power', name: 'L1 active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'W', group: MEASUREMENTS }),
  register({ hexAddress: '0016', key: 'l2_active_power', name: 'L2 active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'W', group: MEASUREMENTS }),
  register({ hexAddress: '0018', key: 'l3_active_power', name: 'L3 active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'W', group: MEASUREMENTS }),
  register({ hexAddress: '001A', key: 'l1_reactive_power', name: 'L1 reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'var', group: MEASUREMENTS }),
  register({ hexAddress: '001C', key: 'l2_reactive_power', name: 'L2 reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'var', group: MEASUREMENTS }),
  register({ hexAddress: '001E', key: 'l3_reactive_power', name: 'L3 reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'var', group: MEASUREMENTS }),
  register({ hexAddress: '0020', key: 'l1_apparent_power', name: 'L1 apparent power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'VA', group: MEASUREMENTS }),
  register({ hexAddress: '0022', key: 'l2_apparent_power', name: 'L2 apparent power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'VA', group: MEASUREMENTS }),
  register({ hexAddress: '0024', key: 'l3_apparent_power', name: 'L3 apparent power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'VA', group: MEASUREMENTS }),
  register({ hexAddress: '0026', key: 'l1_power_factor', name: 'L1 power factor', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.0001, group: MEASUREMENTS }),
  register({ hexAddress: '0028', key: 'l2_power_factor', name: 'L2 power factor', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.0001, group: MEASUREMENTS }),
  register({ hexAddress: '002A', key: 'l3_power_factor', name: 'L3 power factor', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.0001, group: MEASUREMENTS }),
  register({ hexAddress: '0032', key: 'frequency', name: 'Frequency', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.001, unit: 'Hz', group: MEASUREMENTS }),
  register({ hexAddress: '0034', key: 'eqv_phase_voltage', name: 'Equivalent phase voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0036', key: 'eqv_phase_to_phase_voltage', name: 'Equivalent phase-to-phase voltage', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'V', group: MEASUREMENTS }),
  register({ hexAddress: '0038', key: 'eqv_current', name: 'Equivalent current', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.0001, unit: 'A', group: MEASUREMENTS }),
  register({ hexAddress: '003A', key: 'eqv_active_power', name: 'Equivalent active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'W', group: MEASUREMENTS }),
  register({ hexAddress: '003C', key: 'eqv_reactive_power', name: 'Equivalent reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'var', group: MEASUREMENTS }),
  register({ hexAddress: '003E', key: 'eqv_apparent_power', name: 'Equivalent apparent power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'VA', group: MEASUREMENTS }),
  register({ hexAddress: '0040', key: 'eqv_power_factor', name: 'Equivalent power factor', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.0001, group: MEASUREMENTS }),
  register({ hexAddress: '0042', key: 'phase_phase_voltage_asymmetry', name: 'Phase-to-phase voltage asymmetry', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: '%', group: MEASUREMENTS }),
  register({ hexAddress: '0044', key: 'phase_neutral_voltage_asymmetry', name: 'Phase-to-neutral voltage asymmetry', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: '%', group: MEASUREMENTS }),
  register({ hexAddress: '0046', key: 'current_asymmetry', name: 'Current asymmetry', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: '%', group: MEASUREMENTS }),

  // --- Table 2: energy counters (4 words = 64-bit each) ---
  register({ hexAddress: '1B20', key: 'total_import_active_energy', name: 'Total imported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B24', key: 'total_export_active_energy', name: 'Total exported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B28', key: 'total_import_reactive_energy', name: 'Total imported reactive energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kvarh', group: ENERGY }),
  register({ hexAddress: '1B2C', key: 'total_export_reactive_energy', name: 'Total exported reactive energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kvarh', group: ENERGY }),
  register({ hexAddress: '1B30', key: 'total_apparent_energy', name: 'Total apparent energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1B34', key: 'partial_import_active_energy', name: 'Partial imported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B38', key: 'partial_export_active_energy', name: 'Partial exported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B3C', key: 'partial_import_reactive_energy', name: 'Partial imported reactive energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kvarh', group: ENERGY }),
  register({ hexAddress: '1B40', key: 'partial_export_reactive_energy', name: 'Partial exported reactive energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kvarh', group: ENERGY }),
  register({ hexAddress: '1B44', key: 'partial_apparent_energy', name: 'Partial apparent energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1B48', key: 'import_active_energy_tariff_1', name: 'Imported active energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B4C', key: 'export_active_energy_tariff_1', name: 'Exported active energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B50', key: 'import_reactive_energy_tariff_1', name: 'Imported reactive energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kvarh', group: ENERGY }),
  register({ hexAddress: '1B54', key: 'export_reactive_energy_tariff_1', name: 'Exported reactive energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kvarh', group: ENERGY }),
  register({ hexAddress: '1B58', key: 'apparent_energy_tariff_1', name: 'Apparent energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1B5C', key: 'import_active_energy_tariff_2', name: 'Imported active energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1B6C', key: 'apparent_energy_tariff_2', name: 'Apparent energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1B98', key: 'l1_import_active_energy_tariff_1', name: 'L1 imported active energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1BA8', key: 'l1_apparent_energy_tariff_1', name: 'L1 apparent energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1BAC', key: 'l1_import_active_energy_tariff_2', name: 'L1 imported active energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1BBC', key: 'l1_apparent_energy_tariff_2', name: 'L1 apparent energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1BC0', key: 'l2_import_active_energy_tariff_1', name: 'L2 imported active energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1BD0', key: 'l2_apparent_energy_tariff_1', name: 'L2 apparent energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1BD4', key: 'l2_import_active_energy_tariff_2', name: 'L2 imported active energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1BE4', key: 'l2_apparent_energy_tariff_2', name: 'L2 apparent energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1BE8', key: 'l3_import_active_energy_tariff_1', name: 'L3 imported active energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1BF8', key: 'l3_apparent_energy_tariff_1', name: 'L3 apparent energy tariff 1', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1BFC', key: 'l3_import_active_energy_tariff_2', name: 'L3 imported active energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1C0C', key: 'l3_apparent_energy_tariff_2', name: 'L3 apparent energy tariff 2', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1E20', key: 'l1_import_active_energy', name: 'L1 imported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1E44', key: 'l1_partial_apparent_energy', name: 'L1 partial apparent energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1E48', key: 'l2_import_active_energy', name: 'L2 imported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1E6C', key: 'l2_partial_apparent_energy', name: 'L2 partial apparent energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),
  register({ hexAddress: '1E70', key: 'l3_import_active_energy', name: 'L3 imported active energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ hexAddress: '1E94', key: 'l3_partial_apparent_energy', name: 'L3 partial apparent energy', dataType: REGISTER_DATA_TYPES.UINT64, scaleFactor: 0.01, unit: 'kVAh', group: ENERGY }),

  // --- Control (writable holding register, FC06/FC16) ---
  // 8448 (0x2100): tariff selection. 0 = tariff off, 1 = tariff on.
  controlRegister({ address: 8448, key: 'tariff_enable', name: 'Tariff enable', unit: null, group: CONTROL }),
];

const EM500_PROFILE = Object.freeze({
  identifier: 'em500',
  name: 'Eastron EM500 energy meter',
  description:
    'Built-in Eastron EM500 register map: instantaneous phase measurements (2-word) and energy counters (4-word 64-bit), input registers, scaling per the EM500 register data manual. Energy counters ship disabled because many EM500 units reject reads above the real-time area; enable them per site once the meter confirms those addresses. Tariff enable (8448/0x2100) is a writable holding register: 0 = off, 1 = on.',
  manufacturer: 'Eastron',
  model: 'EM500',
  registers: Object.freeze(
    registers.map((register) =>
      register.group === ENERGY ? { ...register, enabled: false } : register,
    ),
  ),
  isActive: true,
  tags: Object.freeze(['em500', 'meter', 'built-in']),
  metadata: Object.freeze({
    profileVersion: 3,
    notes:
      'Version 3: adds the tariff control register at 8448 (0x2100), a writable holding register with 0 = tariff off, 1 = tariff on.',
  }),
});

module.exports = {
  EM500_PROFILE,
};
