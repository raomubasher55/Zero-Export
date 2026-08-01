'use strict';

const ModbusRTU = require('modbus-serial');
const logger = require('../config/logger');
const { REGISTER_TYPES } = require('../constants/modbus');
const { encodeRegister } = require('../modbus/register-encoder');
const { decodeRegister } = require('../modbus/register-decoder');

const SIMULATOR_STATES = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
});

function modbusError(message, modbusErrorCode = 0x04) {
  const error = new Error(message);
  error.modbusErrorCode = modbusErrorCode;
  return error;
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function waitForServer(server, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error('Timed out while starting the simulator device.')),
      timeoutMs,
    );
    timeout.unref?.();

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.removeListener('initialized', onInitialized);
      server.removeListener('serverError', onError);
      server.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onInitialized = () => finish();
    const onError = (error) => finish(error);

    server.once('initialized', onInitialized);
    // modbus-serial emits "serverError" on listen failures (EADDRINUSE, ...).
    server.once('serverError', onError);
    server.once('error', onError);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drift(value, range, min, max) {
  return clamp(value + (Math.random() - 0.5) * range, min, max);
}

const INTEGER_TYPES = new Set([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
]);

/**
 * A process-local Modbus TCP device simulator.
 *
 * Serves one register profile (input and/or holding registers) with live
 * values encoded through the same encoder the gateway uses, so the wire
 * format matches the profile exactly. Holding registers marked writable
 * accept FC06/FC16 writes, which feed back into the simulated model
 * (e.g. Huawei active-power derating).
 */
class SimulatorDevice {
  constructor({
    key,
    deviceType,
    profile,
    defaultConfiguration = {},
    options = {},
    logger: deviceLogger,
    serverFactory,
  } = {}) {
    this.key = key;
    this.deviceType = deviceType;
    this.profile = profile;
    this.logger = deviceLogger || logger;

    this.configuration = {
      host: '0.0.0.0',
      port: 15020,
      unitId: 1,
      updateIntervalMs: 1000,
      options: { ...options },
      ...defaultConfiguration,
    };
    this.serverFactory =
      serverFactory ||
      ((vector, configuration) =>
        new ModbusRTU.ServerTCP(vector, {
          host: configuration.host,
          port: configuration.port,
          unitID: configuration.unitId,
        }));

    this.definitionsByAddress = new Map(); // `${registerType}:${address}` -> definition
    this.writableDefinitions = new Map(); // `${registerType}:${address}` -> definition
    this.memory = new Map(); // `${registerType}:${address}` -> raw 16-bit word
    this.values = new Map(); // registerKey -> latest decoded snapshot
    this.controlValues = new Map(); // registerKey -> engineering value written by clients
    this.server = null;
    this.tickTimer = null;
    this.tickCount = 0;
    this.lastTickAt = null;
    this.lastRequestAt = null;
    this.lastError = null;
    this.state = SIMULATOR_STATES.STOPPED;
    this.startedAt = null;

    for (const register of profile.registers) {
      this.definitionsByAddress.set(this.addressKey(register.registerType, register.address), register);
      if (register.writable) {
        this.writableDefinitions.set(this.addressKey(register.registerType, register.address), register);
      }
    }

    // Device-specific model state.
    this.model = this.createModel();
  }

  createModel() {
    if (this.deviceType === 'Huawei SUN2000 inverter') {
      return {
        phaseVoltage: [230.4, 231.2, 229.8],
        frequency: 50.03,
        deratingRaw: 1000, // 0-1000 (0.1% steps), register 40125
        fixedDeratingW: 0, // register 40126 (0 = disabled)
        totalYieldKwh: 128734.55,
        dailyYieldKwh: 412.7,
        startedAt: null,
      };
    }
    // EM500 meter
    return {
      phase: {
        voltage: [232.4, 231.1, 230.2],
        current: [45.3, 48.7, 42.9],
        powerFactor: [0.932, 0.941, 0.925],
        frequency: 50.02,
      },
      energy: {
        totalImportActive: 12345.67,
        totalExportActive: 321.45,
        totalImportReactive: 5678.9,
        totalExportReactive: 98.7,
        totalApparent: 18888.88,
        partialImportActive: 0,
        partialExportActive: 0,
        partialImportReactive: 0,
        partialExportReactive: 0,
        partialApparent: 0,
        l1ImportActive: 4123.4,
        l2ImportActive: 4078.1,
        l3ImportActive: 4144.2,
        l1PartialApparent: 0,
        l2PartialApparent: 0,
        l3PartialApparent: 0,
      },
    };
  }

  addressKey(registerType, address) {
    return `${registerType}:${address}`;
  }

  assertUnitId(unitId) {
    if (
      unitId !== undefined &&
      this.configuration.unitId !== undefined &&
      unitId !== 0 &&
      unitId !== this.configuration.unitId
    ) {
      throw modbusError(`Unexpected unit id ${unitId}.`, 0x02);
    }
  }

  configure(patch) {
    if (this.state === SIMULATOR_STATES.RUNNING || this.state === SIMULATOR_STATES.STARTING) {
      throw new Error('Stop the simulator before changing its configuration.');
    }
    const { options, ...rest } = patch;
    this.configuration = {
      ...this.configuration,
      ...rest,
      options: { ...this.configuration.options, ...(options || {}) },
    };
    return this.getStatus();
  }

  async start() {
    if (this.state === SIMULATOR_STATES.RUNNING || this.state === SIMULATOR_STATES.STARTING) {
      return this.getStatus();
    }

    this.state = SIMULATOR_STATES.STARTING;
    try {
      this.server = this.serverFactory(this.createVector(), this.configuration);
      await waitForServer(this.server);
      this.state = SIMULATOR_STATES.RUNNING;
      this.startedAt = new Date();
      this.model.startedAt = this.startedAt;
      this.lastError = null;

      this.tick();
      this.tickTimer = setInterval(() => {
        try {
          this.tick();
        } catch (error) {
          this.logger.error('Simulator device tick failed', {
            device: this.key,
            error: error.stack || error.message,
          });
        }
      }, this.configuration.updateIntervalMs);
      this.tickTimer.unref?.();

      this.logger.info('Simulator device started', {
        device: this.key,
        deviceType: this.deviceType,
        host: this.configuration.host,
        port: this.configuration.port,
        unitId: this.configuration.unitId,
        registerCount: this.profile.registers.length,
      });
      return this.getStatus();
    } catch (error) {
      await this.stop();
      this.state = SIMULATOR_STATES.ERROR;
      this.lastError = { message: error.message, occurredAt: new Date() };
      throw error;
    }
  }

  async stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    const server = this.server;
    this.server = null;
    await closeServer(server);
    this.state = SIMULATOR_STATES.STOPPED;
    this.startedAt = null;
    return this.getStatus();
  }

  createVector() {
    return {
      getCoil: (address, unitId) => this.unavailable(REGISTER_TYPES.COIL, address, unitId),
      getDiscreteInput: (address, unitId) => this.unavailable(REGISTER_TYPES.DISCRETE_INPUT, address, unitId),
      getHoldingRegister: (address, unitId) => this.read(REGISTER_TYPES.HOLDING, address, unitId),
      getInputRegister: (address, unitId) => this.read(REGISTER_TYPES.INPUT, address, unitId),
      getMultipleHoldingRegisters: (address, length, unitId) =>
        Array.from({ length }, (_, offset) => this.read(REGISTER_TYPES.HOLDING, address + offset, unitId)),
      getMultipleInputRegisters: (address, length, unitId) =>
        Array.from({ length }, (_, offset) => this.read(REGISTER_TYPES.INPUT, address + offset, unitId)),
      setCoil: (address, _value, unitId) => this.unavailable(REGISTER_TYPES.COIL, address, unitId),
      setRegister: (address, value, unitId) => this.write(REGISTER_TYPES.HOLDING, address, [value], unitId),
      setRegisterArray: (address, values, unitId) =>
        this.write(REGISTER_TYPES.HOLDING, address, values, unitId),
      readDeviceIdentification: () => ({
        0x00: this.model?.manufacturer || 'Zero Export',
        0x01: this.deviceType,
        0x02: '1.0.0',
        0x03: 'Zero Export device simulator',
      }),
    };
  }

  unavailable(registerType, address, unitId) {
    this.assertUnitId(unitId);
    throw modbusError(
      `The ${this.deviceType} simulator does not serve ${registerType} address ${address}.`,
      0x02,
    );
  }

  read(registerType, address, unitId) {
    this.assertUnitId(unitId);
    this.lastRequestAt = new Date();
    const key = this.addressKey(registerType, address);
    const word = this.memory.get(key);
    if (word === undefined) {
      throw modbusError(`Address ${address} is not simulated in ${registerType}.`, 0x02);
    }
    return word;
  }

  write(registerType, address, rawValues, unitId) {
    this.assertUnitId(unitId);
    this.lastRequestAt = new Date();

    const definition = this.writableDefinitions.get(this.addressKey(registerType, address));
    if (!definition) {
      throw modbusError(`Address ${address} is not writable in ${registerType}.`, 0x02);
    }

    if (rawValues.length !== definition.length) {
      throw modbusError(
        `Write to ${definition.key} requires ${definition.length} register(s).`,
        0x03,
      );
    }

    rawValues.forEach((word, offset) => {
      this.memory.set(this.addressKey(registerType, address + offset), word);
    });

    const decoded = decodeRegister(definition, [...rawValues]);
    this.controlValues.set(definition.key, decoded.value);

    if (definition.key === 'active_power_derating') {
      this.model.deratingRaw = Math.round(decoded.value / 0.1);
    }
    if (definition.key === 'active_power_fixed_derating') {
      this.model.fixedDeratingW = decoded.value;
    }

    return rawValues;
  }

  /** Recompute simulated values and refresh the raw register memory. */
  tick() {
    const now = new Date();
    const values =
      this.deviceType === 'Huawei SUN2000 inverter'
        ? this.computeHuawei()
        : this.computeEm500();

    for (const register of this.profile.registers) {
      let engineeringValue = values[register.key];

      if (engineeringValue === undefined) {
        this.logger.warn('Simulator has no value generator for register', {
          device: this.key,
          registerKey: register.key,
        });
        continue;
      }

      // A real device quantizes to its raw integer resolution.
      if (INTEGER_TYPES.has(register.dataType)) {
        engineeringValue =
          Math.round(engineeringValue / register.scaleFactor) * register.scaleFactor;
      }

      const encoded = encodeRegister(register, engineeringValue);
      encoded.rawValues.forEach((rawValue, offset) => {
        this.memory.set(
          this.addressKey(register.registerType, register.address + offset),
          rawValue,
        );
      });

      this.values.set(register.key, {
        registerKey: register.key,
        registerName: register.name,
        address: register.address,
        dataType: register.dataType,
        group: register.group,
        unit: register.unit || null,
        value: engineeringValue,
        rawValues: [...encoded.rawValues],
        sampledAt: now,
      });
    }

    this.tickCount += 1;
    this.lastTickAt = now;
    return this.getStatus();
  }

  computeEm500() {
    const model = this.model;
    const p = model.phase;
    p.voltage = p.voltage.map((v) => drift(v, 0.6, 225, 245));
    p.current = p.current.map((i) => drift(i, 1.6, 25, 75));
    p.powerFactor = p.powerFactor.map((pf) => drift(pf, 0.006, 0.85, 0.99));
    p.frequency = drift(p.frequency, 0.02, 49.9, 50.1);

    const [v1, v2, v3] = p.voltage;
    const [i1, i2, i3] = p.current;
    const [pf1, pf2, pf3] = p.powerFactor;

    const active = [v1 * i1 * pf1, v2 * i2 * pf2, v3 * i3 * pf3];
    const apparent = [v1 * i1, v2 * i2, v3 * i3];
    const reactive = [
      apparent[0] * Math.sqrt(Math.max(0, 1 - pf1 * pf1)),
      apparent[1] * Math.sqrt(Math.max(0, 1 - pf2 * pf2)),
      apparent[2] * Math.sqrt(Math.max(0, 1 - pf3 * pf3)),
    ];

    const avgVoltage = (v1 + v2 + v3) / 3;
    const avgCurrent = (i1 + i2 + i3) / 3;
    const sumActive = active[0] + active[1] + active[2];
    const sumReactive = reactive[0] + reactive[1] + reactive[2];
    const sumApparent = apparent[0] + apparent[1] + apparent[2];

    const dtHours = this.configuration.updateIntervalMs / 3600000;
    const e = model.energy;
    const dImport = (sumActive / 1000) * dtHours;
    const dExport = 0.02 * dtHours;
    const dReactive = (sumReactive / 1000) * dtHours;
    const dApparent = (sumApparent / 1000) * dtHours;

    e.totalImportActive += dImport;
    e.totalExportActive += dExport;
    e.totalImportReactive += dReactive;
    e.totalExportReactive += dReactive * 0.15;
    e.totalApparent += dApparent;
    e.partialImportActive += dImport;
    e.partialExportActive += dExport;
    e.partialImportReactive += dReactive;
    e.partialExportReactive += dReactive * 0.15;
    e.partialApparent += dApparent;

    const total = sumActive || 1;
    e.l1ImportActive += dImport * (active[0] / total);
    e.l2ImportActive += dImport * (active[1] / total);
    e.l3ImportActive += dImport * (active[2] / total);
    e.l1PartialApparent += dApparent * (active[0] / total);
    e.l2PartialApparent += dApparent * (active[1] / total);
    e.l3PartialApparent += dApparent * (active[2] / total);

    return {
      l1_phase_voltage: v1,
      l2_phase_voltage: v2,
      l3_phase_voltage: v3,
      l1_current: i1,
      l2_current: i2,
      l3_current: i3,
      neutral_current: Math.abs(drift(0.18, 0.2, 0, 1.5)),
      l1_l2_voltage: ((v1 + v2) / 2) * Math.sqrt(3),
      l2_l3_voltage: ((v2 + v3) / 2) * Math.sqrt(3),
      l3_l1_voltage: ((v3 + v1) / 2) * Math.sqrt(3),
      l1_active_power: active[0],
      l2_active_power: active[1],
      l3_active_power: active[2],
      l1_reactive_power: reactive[0],
      l2_reactive_power: reactive[1],
      l3_reactive_power: reactive[2],
      l1_apparent_power: apparent[0],
      l2_apparent_power: apparent[1],
      l3_apparent_power: apparent[2],
      l1_power_factor: pf1,
      l2_power_factor: pf2,
      l3_power_factor: pf3,
      frequency: p.frequency,
      eqv_phase_voltage: avgVoltage,
      eqv_phase_to_phase_voltage: avgVoltage * Math.sqrt(3),
      eqv_current: avgCurrent,
      eqv_active_power: sumActive,
      eqv_reactive_power: sumReactive,
      eqv_apparent_power: sumApparent,
      eqv_power_factor: sumActive / sumApparent,
      phase_phase_voltage_asymmetry: 1.5,
      phase_neutral_voltage_asymmetry: 1.1,
      current_asymmetry: 2.2,
      total_import_active_energy: e.totalImportActive,
      total_export_active_energy: e.totalExportActive,
      total_import_reactive_energy: e.totalImportReactive,
      total_export_reactive_energy: e.totalExportReactive,
      total_apparent_energy: e.totalApparent,
      partial_import_active_energy: e.partialImportActive,
      partial_export_active_energy: e.partialExportActive,
      partial_import_reactive_energy: e.partialImportReactive,
      partial_export_reactive_energy: e.partialExportReactive,
      partial_apparent_energy: e.partialApparent,
      import_active_energy_tariff_1: e.totalImportActive * 0.6,
      export_active_energy_tariff_1: e.totalExportActive * 0.6,
      import_reactive_energy_tariff_1: e.totalImportReactive * 0.6,
      export_reactive_energy_tariff_1: e.totalExportReactive * 0.6,
      apparent_energy_tariff_1: e.totalApparent * 0.6,
      import_active_energy_tariff_2: e.totalImportActive * 0.4,
      apparent_energy_tariff_2: e.totalApparent * 0.4,
      l1_import_active_energy_tariff_1: e.l1ImportActive * 0.6,
      l1_apparent_energy_tariff_1: e.l1PartialApparent * 0.6,
      l1_import_active_energy_tariff_2: e.l1ImportActive * 0.4,
      l1_apparent_energy_tariff_2: e.l1PartialApparent * 0.4,
      l2_import_active_energy_tariff_1: e.l2ImportActive * 0.6,
      l2_apparent_energy_tariff_1: e.l2PartialApparent * 0.6,
      l2_import_active_energy_tariff_2: e.l2ImportActive * 0.4,
      l2_apparent_energy_tariff_2: e.l2PartialApparent * 0.4,
      l3_import_active_energy_tariff_1: e.l3ImportActive * 0.6,
      l3_apparent_energy_tariff_1: e.l3PartialApparent * 0.6,
      l3_import_active_energy_tariff_2: e.l3ImportActive * 0.4,
      l3_apparent_energy_tariff_2: e.l3PartialApparent * 0.4,
      l1_import_active_energy: e.l1ImportActive,
      l1_partial_apparent_energy: e.l1PartialApparent,
      l2_import_active_energy: e.l2ImportActive,
      l2_partial_apparent_energy: e.l2PartialApparent,
      l3_import_active_energy: e.l3ImportActive,
      l3_partial_apparent_energy: e.l3PartialApparent,
    };
  }

  computeHuawei() {
    const model = this.model;
    const options = this.configuration.options;

    model.phaseVoltage = model.phaseVoltage.map((v) => drift(v, 0.5, 225, 240));
    model.frequency = drift(model.frequency, 0.02, 49.9, 50.1);

    const ratingKw = options.ratingKw || 100;
    const availabilityPct = clamp(options.availabilityPct ?? 100, 0, 100);

    const deratingFraction = clamp(model.deratingRaw, 0, 1000) / 1000;
    let outputKw = ratingKw * (availabilityPct / 100) * deratingFraction;
    if (model.fixedDeratingW > 0) {
      outputKw = Math.min(outputKw, model.fixedDeratingW / 1000);
    }
    outputKw = Math.max(0, outputKw * (0.97 + Math.random() * 0.06));

    const dtHours = this.configuration.updateIntervalMs / 3600000;
    model.totalYieldKwh += outputKw * dtHours;
    model.dailyYieldKwh += outputKw * dtHours;

    const avgVoltage = model.phaseVoltage.reduce((a, b) => a + b, 0) / 3;
    const pf = 0.99;
    const current = (outputKw * 1000) / (3 * avgVoltage * pf);

    return {
      uab_voltage: model.phaseVoltage[0] * Math.sqrt(3),
      ubc_voltage: model.phaseVoltage[1] * Math.sqrt(3),
      uca_voltage: model.phaseVoltage[2] * Math.sqrt(3),
      phase_a_voltage: model.phaseVoltage[0],
      phase_b_voltage: model.phaseVoltage[1],
      phase_c_voltage: model.phaseVoltage[2],
      phase_a_current: current,
      phase_b_current: current,
      phase_c_current: current,
      active_power: outputKw,
      grid_frequency: model.frequency,
      total_yield: model.totalYieldKwh,
      daily_yield: model.dailyYieldKwh,
      active_power_derating: (model.deratingRaw * 0.1), // engineering % for read-back
      active_power_fixed_derating: model.fixedDeratingW,
    };
  }

  getStatus() {
    return {
      key: this.key,
      deviceType: this.deviceType,
      state: this.state,
      host: this.configuration.host,
      port: this.configuration.port,
      unitId: this.configuration.unitId,
      updateIntervalMs: this.configuration.updateIntervalMs,
      options: { ...this.configuration.options },
      startedAt: this.startedAt,
      lastRequestAt: this.lastRequestAt,
      lastTickAt: this.lastTickAt,
      tickCount: this.tickCount,
      lastError: this.lastError,
      registerCount: this.profile.registers.length,
      servedRegisterCount: this.values.size,
      deratingPercent: this.model.deratingRaw !== undefined
        ? Math.round((this.model.deratingRaw / 10) * 10) / 10
        : undefined,
    };
  }

  getValues() {
    return [...this.values.values()].sort(
      (left, right) =>
        String(left.group).localeCompare(String(right.group)) ||
        left.address - right.address,
    );
  }
}

module.exports = {
  SIMULATOR_STATES,
  SimulatorDevice,
};
