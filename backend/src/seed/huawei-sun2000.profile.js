'use strict';

/**
 * Built-in Huawei SUN2000 solar inverter register profile.
 *
 * Source: Huawei Solar Inverter Modbus Interface Definitions (V3.0) —
 * full register map: identification, status/alarms, PV strings, AC
 * measurements, energy yields, external meter, battery, and writable
 * active-power control registers.
 *
 * All entries are Modbus holding registers (FC03 reads). Addresses are used
 * directly as the wire address, matching Huawei's register numbering.
 * scaleFactor follows the manual's scale column (e.g. V/10 -> 0.1,
 * A/1000 -> 0.001, kW/1000 -> 0.001, Hz/100 -> 0.01, kWh/100 -> 0.01).
 *
 * maxReadQuantity: 15 — the SUN2000 rejects FC03 reads of more than 15
 * registers per request; the polling planner splits accordingly and the
 * simulator enforces the same limit.
 */

const { REGISTER_DATA_TYPES } = require('../constants/modbus');
const { expectedWordLength } = require('../utils/register-length');

function register({
  address,
  key,
  name,
  dataType,
  scaleFactor = 1,
  unit,
  group,
  writable = false,
  length,
}) {
  return {
    key,
    name,
    registerType: 'HOLDING_REGISTER',
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
    writable,
    enabled: true,
    sortOrder: 0,
  };
}

const IDENTIFICATION = 'Identification';
const STATUS = 'Status';
const PV = 'PV Strings';
const MEASUREMENTS = 'Measurements';
const ENERGY = 'Energy';
const METER = 'Meter';
const BATTERY = 'Battery';
const CONTROL = 'Control';

const registers = [
  // --- Identification (30000-30077) ---
  register({ address: 30000, key: 'model_name', name: 'Model name', dataType: REGISTER_DATA_TYPES.STRING, length: 15, group: IDENTIFICATION }),
  register({ address: 30015, key: 'serial_number', name: 'Serial number', dataType: REGISTER_DATA_TYPES.STRING, length: 10, group: IDENTIFICATION }),
  register({ address: 30025, key: 'pn_code', name: 'PN code', dataType: REGISTER_DATA_TYPES.STRING, length: 10, group: IDENTIFICATION }),
  register({ address: 30070, key: 'model_id', name: 'Model ID', dataType: REGISTER_DATA_TYPES.UINT16, group: IDENTIFICATION }),
  register({ address: 30071, key: 'pv_strings_count', name: 'PV strings count', dataType: REGISTER_DATA_TYPES.UINT16, group: IDENTIFICATION }),
  register({ address: 30072, key: 'mppt_count', name: 'MPPT count', dataType: REGISTER_DATA_TYPES.UINT16, group: IDENTIFICATION }),
  register({ address: 30073, key: 'rated_power', name: 'Rated power (Pn)', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.001, unit: 'kW', group: IDENTIFICATION }),
  register({ address: 30075, key: 'max_active_power', name: 'Max active power (Pmax)', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.001, unit: 'kW', group: IDENTIFICATION }),
  register({ address: 30077, key: 'max_apparent_power', name: 'Max apparent power (Smax)', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.001, unit: 'kVA', group: IDENTIFICATION }),

  // --- Status / alarms (32000-32010) ---
  register({ address: 32000, key: 'state_1', name: 'State 1', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 32002, key: 'state_2', name: 'State 2', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 32008, key: 'alarm_1', name: 'Alarm bitfield 1', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 32009, key: 'alarm_2', name: 'Alarm bitfield 2', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),
  register({ address: 32010, key: 'alarm_3', name: 'Alarm bitfield 3', dataType: REGISTER_DATA_TYPES.UINT16, group: STATUS }),

  // --- PV strings (32016-32064) ---
  register({ address: 32016, key: 'pv1_voltage', name: 'PV1 voltage', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: 'V', group: PV }),
  register({ address: 32017, key: 'pv1_current', name: 'PV1 current', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.01, unit: 'A', group: PV }),
  register({ address: 32018, key: 'pv2_voltage', name: 'PV2 voltage', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: 'V', group: PV }),
  register({ address: 32019, key: 'pv2_current', name: 'PV2 current', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.01, unit: 'A', group: PV }),
  register({ address: 32020, key: 'pv3_voltage', name: 'PV3 voltage', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: 'V', group: PV }),
  register({ address: 32021, key: 'pv3_current', name: 'PV3 current', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.01, unit: 'A', group: PV }),
  register({ address: 32022, key: 'pv4_voltage', name: 'PV4 voltage', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: 'V', group: PV }),
  register({ address: 32023, key: 'pv4_current', name: 'PV4 current', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.01, unit: 'A', group: PV }),
  register({ address: 32064, key: 'total_input_power', name: 'Total input power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.001, unit: 'kW', group: PV }),

  // --- AC measurements (32066-32089) ---
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
  register({ address: 32082, key: 'reactive_power', name: 'Reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.001, unit: 'kVAR', group: MEASUREMENTS }),
  register({ address: 32084, key: 'power_factor', name: 'Power factor', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.001, group: MEASUREMENTS }),
  register({ address: 32085, key: 'grid_frequency', name: 'Grid frequency', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: 'Hz', group: MEASUREMENTS }),
  register({ address: 32086, key: 'efficiency', name: 'Efficiency', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.01, unit: '%', group: MEASUREMENTS }),
  register({ address: 32087, key: 'cabinet_temperature', name: 'Cabinet temperature', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.1, unit: '°C', group: MEASUREMENTS }),
  register({ address: 32088, key: 'insulation_resistance', name: 'Insulation resistance', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.001, unit: 'MΩ', group: MEASUREMENTS }),
  register({ address: 32089, key: 'device_status', name: 'Device status', dataType: REGISTER_DATA_TYPES.UINT16, group: MEASUREMENTS }),

  // --- Energy (32106-32114) ---
  register({ address: 32106, key: 'total_yield', name: 'Total energy yield', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),
  register({ address: 32114, key: 'daily_yield', name: 'Daily energy yield', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'kWh', group: ENERGY }),

  // --- Battery (37000-37017) ---
  register({ address: 37000, key: 'battery_status', name: 'Battery status', dataType: REGISTER_DATA_TYPES.UINT16, group: BATTERY }),
  register({ address: 37001, key: 'battery_charge_discharge_power', name: 'Battery charge/discharge power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: BATTERY }),
  register({ address: 37004, key: 'battery_soc', name: 'Battery SOC', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: '%', group: BATTERY }),
  register({ address: 37015, key: 'battery_daily_charge_energy', name: 'Battery daily charge energy', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'kWh', group: BATTERY }),
  register({ address: 37017, key: 'battery_daily_discharge_energy', name: 'Battery daily discharge energy', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 0.01, unit: 'kWh', group: BATTERY }),

  // --- External meter (37100-37121) ---
  register({ address: 37100, key: 'meter_status', name: 'Meter status', dataType: REGISTER_DATA_TYPES.UINT16, group: METER }),
  register({ address: 37101, key: 'meter_phase_a_voltage', name: 'Meter phase A voltage', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.1, unit: 'V', group: METER }),
  register({ address: 37103, key: 'meter_phase_b_voltage', name: 'Meter phase B voltage', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.1, unit: 'V', group: METER }),
  register({ address: 37105, key: 'meter_phase_c_voltage', name: 'Meter phase C voltage', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.1, unit: 'V', group: METER }),
  register({ address: 37107, key: 'meter_phase_a_current', name: 'Meter phase A current', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'A', group: METER }),
  register({ address: 37109, key: 'meter_phase_b_current', name: 'Meter phase B current', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'A', group: METER }),
  register({ address: 37111, key: 'meter_phase_c_current', name: 'Meter phase C current', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'A', group: METER }),
  register({ address: 37113, key: 'meter_grid_active_power', name: 'Meter grid active power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'W', group: METER }),
  register({ address: 37115, key: 'meter_grid_reactive_power', name: 'Meter grid reactive power', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 1, unit: 'VAR', group: METER }),
  register({ address: 37117, key: 'meter_power_factor', name: 'Meter power factor', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.001, group: METER }),
  register({ address: 37118, key: 'meter_frequency', name: 'Meter frequency', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.01, unit: 'Hz', group: METER }),
  register({ address: 37119, key: 'meter_total_export_energy', name: 'Meter total export energy', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'kWh', group: METER }),
  register({ address: 37121, key: 'meter_total_import_energy', name: 'Meter total import energy', dataType: REGISTER_DATA_TYPES.INT32, scaleFactor: 0.01, unit: 'kWh', group: METER }),

  // --- Active power / remote control (writable) ---
  // 40125/40126 follow the site's established control layout (derating in
  // 0.1% steps, fixed limit in W); 40200+ mirror the V3.0 remote-control map.
  register({ address: 40200, key: 'remote_power_control_enable', name: 'Remote power control enable', dataType: REGISTER_DATA_TYPES.UINT16, group: CONTROL, writable: true }),
  register({ address: 40125, key: 'active_power_derating', name: 'Active power derating', dataType: REGISTER_DATA_TYPES.UINT16, scaleFactor: 0.1, unit: '%', group: CONTROL, writable: true }),
  register({ address: 40126, key: 'active_power_fixed_limit', name: 'Active power fixed limit', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: CONTROL, writable: true }),
  register({ address: 40208, key: 'reactive_power_pf_command', name: 'Reactive power PF command', dataType: REGISTER_DATA_TYPES.INT16, scaleFactor: 0.001, group: CONTROL, writable: true }),
  register({ address: 40212, key: 'zero_export_mode', name: 'Zero-export mode', dataType: REGISTER_DATA_TYPES.UINT16, group: CONTROL, writable: true }),
  register({ address: 40213, key: 'max_grid_feed_in_power', name: 'Max grid feed-in power', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: CONTROL, writable: true }),

  // --- Battery control (47075-47086, writable) ---
  register({ address: 47075, key: 'battery_max_charge_power_limit', name: 'Battery max charge power limit', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: CONTROL, writable: true }),
  register({ address: 47077, key: 'battery_max_discharge_power_limit', name: 'Battery max discharge power limit', dataType: REGISTER_DATA_TYPES.UINT32, scaleFactor: 1, unit: 'W', group: CONTROL, writable: true }),
  register({ address: 47086, key: 'battery_force_control_command', name: 'Battery force control command', dataType: REGISTER_DATA_TYPES.UINT16, group: CONTROL, writable: true }),
];

const HUAWEI_SUN2000_PROFILE = Object.freeze({
  identifier: 'huawei-sun2000',
  name: 'Huawei SUN2000 inverter',
  description:
    'Built-in Huawei SUN2000 register map (Modbus Interface Definitions V3.0): identification, status/alarms, PV strings, AC measurements, yields, external meter, battery, and writable active-power control (40125 derating 0-1000, 40126 fixed limit W, 40200 remote control enable, 40212 zero-export mode, 40213 max feed-in W). Read batches are capped at 15 registers per FC03 request.',
  manufacturer: 'Huawei',
  model: 'SUN2000',
  registers: Object.freeze(registers),
  isActive: true,
  maxReadQuantity: 15,
  tags: Object.freeze(['huawei', 'sun2000', 'inverter', 'built-in']),
  metadata: Object.freeze({
    profileVersion: 3,
    notes:
      'Full V3.0 register map. maxReadQuantity 15 mirrors the SUN2000 FC03 batch limit. Derating control lives at 40125 (0.1% steps) with fixed limit at 40126 (W), matching the site control layout.',
  }),
});

module.exports = {
  HUAWEI_SUN2000_PROFILE,
};
