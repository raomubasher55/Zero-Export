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
    coupledInverterKw,
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

    // Reads the current Huawei inverter output for grid-point coupling.
    // Overridable in tests; defaults to the shared simulator farm (lazy
    // require avoids the simulator <-> simulator-device circular import).
    this.coupledInverterKw = coupledInverterKw || (() => this.defaultCoupledInverterKw());

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
    if (this.deviceType === 'Sungrow inverter') {
      return {
        manufacturer: 'Sungrow',
        phaseVoltage: [230.1, 231.0, 229.5],
        frequency: 50.0,
        deratingRaw: 10000, // active power control 0-10000 (0.01%), register 5007
        totalYieldKwh: 98765.4,
        dailyYieldKwh: 420.3,
        runningHours: 12345,
        startedAt: null,
      };
    }
    if (this.deviceType === 'Solis inverter') {
      return {
        manufacturer: 'Solis',
        phaseVoltage: [230.2, 231.5, 229.6],
        frequency: 50.02,
        deratingRaw: 10000, // active power limit 0-10000 (0.1%), register 3050
        totalYieldKwh: 65432.1,
        dailyYieldKwh: 310.5,
        monthlyYieldKwh: 9876.5,
        yesterdayYieldKwh: 305.2,
        meterImportKwh: 1521.3,
        meterExportKwh: 118.7,
        startedAt: null,
      };
    }
    if (this.deviceType === 'Huawei SUN2000 inverter') {
      return {
        manufacturer: 'Huawei',
        phaseVoltage: [230.4, 231.2, 229.8],
        pvVoltage: [610.2, 608.4, 605.1, 600.8],
        frequency: 50.03,
        deratingRaw: 1000, // 0-1000 (0.1% steps), register 40125
        fixedDeratingW: 0, // register 40206 (0 = disabled)
        remoteControl: 1, // register 40200
        pfCommand: 0, // register 40208
        zeroExportMode: 0, // register 40212
        maxFeedInW: 0, // register 40213 (0 = unlimited)
        batteryMaxChargeW: 50000,
        batteryMaxDischargeW: 50000,
        batteryForceCommand: 0, // register 47086
        batterySoc: 78.5,
        batteryDailyChargeKwh: 12.34,
        batteryDailyDischargeKwh: 9.87,
        meterImportKwh: 4521.3,
        meterExportKwh: 218.7,
        totalYieldKwh: 128734.55,
        dailyYieldKwh: 412.7,
        startedAt: null,
      };
    }
    // EM500 meter
    return {
      tariff: 0, // register 8448 (0x2100): 0 = tariff off, 1 = tariff on
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

  /** Begin the value-generation loop (tick once, then every interval). */
  startTicking() {
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

      this.startTicking();

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

  /**
   * Attach to a farm-managed shared server instead of owning one. The shared
   * server dispatches requests by unit ID, so several devices can share one
   * TCP port (like an RS485 bus bridged over TCP).
   */
  attachSharedServer(server) {
    if (this.state === SIMULATOR_STATES.RUNNING || this.state === SIMULATOR_STATES.STARTING) {
      return this.getStatus();
    }
    this.sharedServer = server;
    this.server = server;
    this.state = SIMULATOR_STATES.RUNNING;
    this.startedAt = new Date();
    this.model.startedAt = this.startedAt;
    this.lastError = null;
    this.startTicking();
    this.logger.info('Simulator device attached to shared server', {
      device: this.key,
      host: this.configuration.host,
      port: this.configuration.port,
      unitId: this.configuration.unitId,
    });
    return this.getStatus();
  }

  async stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    // Shared servers are owned by the farm; only close self-owned servers.
    const server = this.sharedServer ? null : this.server;
    this.server = null;
    this.sharedServer = null;
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
        this.readMany(REGISTER_TYPES.HOLDING, address, length, unitId),
      getMultipleInputRegisters: (address, length, unitId) =>
        this.readMany(REGISTER_TYPES.INPUT, address, length, unitId),
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

  /** Per-profile FC03/FC04 batch limit (Huawei SUN2000: 15 registers).
   *  The simulator option maxReadQuantity raises/lowers it (up to 125). */
  batchLimit() {
    const option = this.configuration.options?.maxReadQuantity;
    if (typeof option === 'number' && option >= 1 && option <= 125) {
      return option;
    }
    return this.profile?.maxReadQuantity || 125;
  }

  readMany(registerType, address, length, unitId) {
    if (length > this.batchLimit()) {
      throw modbusError(
        `Read quantity ${length} exceeds the ${this.batchLimit()} register batch limit of this device.`,
        0x03,
      );
    }
    return Array.from({ length }, (_, offset) => this.read(registerType, address + offset, unitId));
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
      // Reserved/gap addresses read as 0 instead of an exception unless
      // zeroFillGaps is disabled explicitly.
      if (this.configuration.options?.zeroFillGaps === false) {
        throw modbusError(`Address ${address} is not simulated in ${registerType}.`, 0x02);
      }
      return 0;
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
    if (definition.key === 'active_power_fixed_limit') {
      this.model.fixedDeratingW = decoded.value;
    }
    if (definition.key === 'remote_power_control_enable') {
      this.model.remoteControl = Math.round(decoded.value);
    }
    if (definition.key === 'tariff_enable') {
      this.model.tariff = Math.round(decoded.value) ? 1 : 0;
    }
    if (definition.key === 'active_power_limit_set') {
      this.model.deratingRaw = Math.min(10000, Math.max(0, Math.round(decoded.value / 0.01)));
    }
    if (definition.key === 'sungrow_active_power_limit') {
      this.model.deratingRaw = Math.min(10000, Math.max(0, Math.round(decoded.value / 0.01)));
    }
    if (definition.key === 'reactive_power_pf_command') {
      this.model.pfCommand = decoded.value;
    }
    if (definition.key === 'zero_export_mode') {
      this.model.zeroExportMode = Math.round(decoded.value);
    }
    if (definition.key === 'max_grid_feed_in_power') {
      this.model.maxFeedInW = Math.round(decoded.value);
    }
    if (definition.key === 'battery_force_control_command') {
      this.model.batteryForceCommand = Math.round(decoded.value);
    }

    return rawValues;
  }

  /** Recompute simulated values and refresh the raw register memory. */
  tick() {
    const now = new Date();
    const values =
      this.deviceType === 'Huawei SUN2000 inverter'
        ? this.computeHuawei()
        : this.deviceType === 'Solis inverter'
          ? this.computeSolis()
          : this.deviceType === 'Sungrow inverter'
            ? this.computeSungrow()
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

  /** Sum of all running inverter simulators (Huawei + Solis), so the meter's
   *  grid reading reflects every inverter on the site. */
  defaultCoupledInverterKw() {
    try {
      const { getDevice } = require('../simulator');
      const keys = ['huawei', 'solis', 'sungrow'];
      let total = 0;
      for (const key of keys) {
        const inverter = getDevice(key);
        if (!inverter || inverter.getStatus().state !== 'RUNNING') continue;
        const value = inverter.values.get('active_power');
        if (value) {
          // Huawei publishes kW; Solis and Sungrow publish W (scale 1).
          total += ['solis', 'sungrow'].includes(key)
            ? Number(value.value) / 1000
            : Number(value.value);
          continue;
        }
        // Fallback: deterministic model output before the first published tick.
        const model = inverter.model;
        if (!model || model.deratingRaw === undefined) continue;
        const ratingKw = inverter.configuration.options?.ratingKw ?? 100;
        const availabilityPct = inverter.configuration.options?.availabilityPct ?? 100;
        const deratingFraction =
          key === 'solis'
            ? clamp(model.deratingRaw, 0, 10000) / 10000
            : clamp(model.deratingRaw, 0, 1000) / 1000;
        let kw = ratingKw * (availabilityPct / 100) * deratingFraction;
        if (model.fixedDeratingW > 0) {
          kw = Math.min(kw, model.fixedDeratingW / 1000);
        }
        total += Math.max(0, kw);
      }
      return total;
    } catch {
      return 0;
    }
  }

  computeEm500() {
    const model = this.model;
    const p = model.phase;
    p.voltage = p.voltage.map((v) => drift(v, 0.6, 225, 245));
    p.powerFactor = p.powerFactor.map((pf) => drift(pf, 0.006, 0.85, 0.99));
    p.frequency = drift(p.frequency, 0.02, 49.9, 50.1);

    const [v1, v2, v3] = p.voltage;
    const [pf1, pf2, pf3] = p.powerFactor;

    // Grid-point coupling: when a site load is configured, the meter's grid
    // power follows load - inverter output (signed: import positive, export
    // negative), exactly like a real grid connection. This makes the meter
    // react when the inverter is derated from anywhere.
    const loadKw = this.configuration.options?.loadKw;
    const coupled = typeof loadKw === 'number' && loadKw > 0;

    let gridW;
    let currents;
    if (coupled) {
      const inverterKw = this.coupledInverterKw();
      gridW = (loadKw - inverterKw) * 1000;
      // The EM500 registers use INT32 raw with /100 scaling (max ±21.4 MW).
      // Clamp so a huge mismatch never overflows the wire format; the meter
      // simply pegs at its maximum reading.
      gridW = clamp(gridW, -2000000, 2000000);
      currents = [0, 1, 2].map(
        (index) => Math.abs(gridW / 3) / (p.voltage[index] * p.powerFactor[index]),
      );
    } else {
      p.current = p.current.map((i) => drift(i, 1.6, 25, 75));
      currents = [...p.current];
      gridW = v1 * currents[0] * pf1 + v2 * currents[1] * pf2 + v3 * currents[2] * pf3;
    }

    const [i1, i2, i3] = currents;
    const active = coupled
      ? [gridW / 3, gridW / 3, gridW / 3]
      : [v1 * i1 * pf1, v2 * i2 * pf2, v3 * i3 * pf3];
    const reactive = active.map(
      (power, index) =>
        power * Math.sqrt(Math.max(0, 1 - p.powerFactor[index] * p.powerFactor[index])),
    );
    const apparent = active.map((power) => Math.abs(power));

    const avgVoltage = (v1 + v2 + v3) / 3;
    const avgCurrent = (i1 + i2 + i3) / 3;
    const sumActive = active[0] + active[1] + active[2];
    const sumReactive = reactive[0] + reactive[1] + reactive[2];
    const sumApparent = apparent[0] + apparent[1] + apparent[2];

    const dtHours = this.configuration.updateIntervalMs / 3600000;
    const e = model.energy;
    const dImport = (Math.max(sumActive, 0) / 1000) * dtHours;
    const dExport = (Math.max(-sumActive, 0) / 1000) * dtHours;
    const dReactive = (Math.abs(sumReactive) / 1000) * dtHours;
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

    const total = Math.abs(sumActive) || 1;
    e.l1ImportActive += dImport * (Math.abs(active[0]) / total);
    e.l2ImportActive += dImport * (Math.abs(active[1]) / total);
    e.l3ImportActive += dImport * (Math.abs(active[2]) / total);
    e.l1PartialApparent += dApparent * (Math.abs(active[0]) / total);
    e.l2PartialApparent += dApparent * (Math.abs(active[1]) / total);
    e.l3PartialApparent += dApparent * (Math.abs(active[2]) / total);

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
      tariff_enable: model.tariff,
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

  computeSolis() {
    const model = this.model;
    const options = this.configuration.options;

    model.phaseVoltage = model.phaseVoltage.map((v) => drift(v, 0.5, 225, 240));
    model.frequency = drift(model.frequency, 0.02, 49.9, 50.1);

    const ratingKw = options.ratingKw || 100;
    const availabilityPct = clamp(options.availabilityPct ?? 100, 0, 100);
    const loadKw = options.loadKw ?? 100;

    const limitFraction = clamp(model.deratingRaw, 0, 10000) / 10000;
    let outputKw = ratingKw * (availabilityPct / 100) * limitFraction;
    outputKw = Math.max(0, outputKw * (0.97 + Math.random() * 0.06));

    const dtHours = this.configuration.updateIntervalMs / 3600000;
    model.totalYieldKwh += outputKw * dtHours;
    model.dailyYieldKwh += outputKw * dtHours;
    model.monthlyYieldKwh += outputKw * dtHours;
    model.yesterdayYieldKwh += outputKw * dtHours;
    model.yearlyYieldKwh = (model.yearlyYieldKwh || 0) + outputKw * dtHours;
    model.lastYearYieldKwh = model.lastYearYieldKwh || 25000;
    model.lastMonthYieldKwh = model.lastMonthYieldKwh || 1800;

    const avgVoltage = model.phaseVoltage.reduce((a, b) => a + b, 0) / 3;
    const pf = 0.99;
    const current = (outputKw * 1000) / (3 * avgVoltage * pf);

    // External-meter view: grid = load - inverter output (import positive).
    // The Solis meter register reports + to grid / - from grid.
    const gridW = (loadKw - outputKw) * 1000;
    const importKw = Math.max(gridW, 0) / 1000;
    const exportKw = Math.max(-gridW, 0) / 1000;
    model.meterImportKwh += importKw * dtHours;
    model.meterExportKwh += exportKw * dtHours;
    model.meterTotalWh = model.meterTotalWh || 0;
    model.meterTotalWh += outputKw * 1000 * dtHours;

    const dcPowerKw = outputKw / 0.982;
    const dcVoltages = Array.from({ length: 4 }, (_, index) => drift(600 + index * 8, 2, 560, 660));
    const dcCurrents = dcVoltages.map((voltage) => clamp((dcPowerKw * 1000) / 4 / voltage, 0.5, 25));

    return {
      // AC output & grid (FC04)
      active_power: outputKw * 1000,
      grid_voltage_a: model.phaseVoltage[0],
      grid_voltage_b: model.phaseVoltage[1],
      grid_voltage_c: model.phaseVoltage[2],
      grid_current_a: current,
      grid_current_b: current,
      grid_current_c: current,
      grid_frequency: model.frequency,
      power_factor: pf,
      reactive_power: outputKw * 1000 * 0.08,
      apparent_power: (outputKw * 1000) / pf,

      // Generation & yield (FC04)
      total_yield: model.totalYieldKwh,
      monthly_generation: model.monthlyYieldKwh,
      last_month_generation: model.lastMonthYieldKwh,
      daily_generation: model.dailyYieldKwh,
      yesterday_generation: model.yesterdayYieldKwh,
      yearly_generation: model.yearlyYieldKwh,
      last_year_generation: model.lastYearYieldKwh,

      // System status & temperatures (FC04)
      product_model: 0x0114,
      dsp_version: 0x0103,
      lcd_version: 0x0102,
      inverter_temperature: 41.2,
      inverter_status: model.startedAt || this.state === 'RUNNING' ? 1 : 0,
      serial_number_1: 0x5353, // 'SS'
      serial_number_2: 0x3030, // '00'
      serial_number_3: 0x3030, // '00'
      serial_number_4: 0x3132, // '12'
      fault_code_1: 0,
      fault_code_2: 0,
      fault_code_3: 0,
      fault_code_4: 0,
      fault_code_5: 0,
      working_status: 0,
      igbt_temperature: 39.8,

      // Meter & grid power flow (FC04)
      meter_total_active_generation: model.meterTotalWh,
      meter_voltage: avgVoltage,
      meter_current: Math.abs(gridW / 1000) / (avgVoltage * pf),
      meter_active_power: -gridW, // + to grid / - from grid
      internal_epm_switch: 2,
      internal_epm_backflow_power: exportKw * 10, // 100W units
      epm_realtime_backflow_power: exportKw * 100, // 10W units

      // DC input (FC04)
      dc_input_type: 4,
      total_dc_power: dcPowerKw * 1000,
      dc_busbar_voltage: dcVoltages[0] * 2,
      dc_half_busbar_voltage: dcVoltages[0],
      dc_voltage_1: dcVoltages[0],
      dc_current_1: dcCurrents[0],
      dc_voltage_2: dcVoltages[1],
      dc_current_2: dcCurrents[1],
      dc_voltage_3: dcVoltages[2],
      dc_current_3: dcCurrents[2],
      dc_voltage_4: dcVoltages[3],
      dc_current_4: dcCurrents[3],

      // Power control
      active_power_limit: model.deratingRaw * 0.01, // engineering % (10000 -> 100%)
      active_power_limit_set: model.deratingRaw * 0.01,
      reactive_power_limitation: 0,
      power_limit_switch_operation_bit: 3,
      power_limit_switch: 0xaa,
      reactive_power_switch: 0x55,
    };
  }

  computeSungrow() {
    const model = this.model;
    const options = this.configuration.options;

    model.phaseVoltage = model.phaseVoltage.map((v) => drift(v, 0.5, 225, 240));
    model.frequency = drift(model.frequency, 0.02, 49.9, 50.1);

    const ratingKw = options.ratingKw || 100;
    const availabilityPct = clamp(options.availabilityPct ?? 100, 0, 100);

    // Active power control via 5007: 0-10000 = 0-100% in 0.01% steps.
    const limitFraction = clamp(model.deratingRaw, 0, 10000) / 10000;
    let outputKw = ratingKw * (availabilityPct / 100) * limitFraction;
    outputKw = Math.max(0, outputKw * (0.97 + Math.random() * 0.06));

    const dtHours = this.configuration.updateIntervalMs / 3600000;
    model.totalYieldKwh += outputKw * dtHours;
    model.dailyYieldKwh += outputKw * dtHours;
    model.runningHours += dtHours;

    const avgVoltage = model.phaseVoltage.reduce((a, b) => a + b, 0) / 3;
    const pf = 0.99;
    const current = (outputKw * 1000) / (3 * avgVoltage * pf);

    const dcPowerKw = outputKw / 0.985;
    const mpptVoltages = Array.from({ length: 8 }, (_, index) => drift(600 + index * 5, 2, 560, 660));
    const mpptCurrents = mpptVoltages.map((voltage) =>
      clamp((dcPowerKw * 1000) / 8 / voltage, 0.5, 20),
    );

    return {
      // Identity (FC03 holding)
      protocol_number: 0x00010001,
      protocol_version: 0x00020003,
      arm_software_version: 'V100.01.02',
      dsp_software_version: 'V200.01.03',
      serial_number: 'SN-SG100-000001',
      device_type_code: 0x0138,
      nominal_active_power: ratingKw,
      output_grid_type: 1,

      // Live telemetry (FC04 input)
      daily_yield: model.dailyYieldKwh,
      total_yield: model.totalYieldKwh,
      total_running_time: model.runningHours,
      internal_temperature: 43.5,
      total_apparent_power: (outputKw * 1000) / pf,
      mppt1_voltage: mpptVoltages[0],
      mppt1_current: mpptCurrents[0],
      mppt2_voltage: mpptVoltages[1],
      mppt2_current: mpptCurrents[1],
      mppt3_voltage: mpptVoltages[2],
      mppt3_current: mpptCurrents[2],
      total_dc_power: dcPowerKw * 1000,
      grid_voltage_a: model.phaseVoltage[0],
      grid_voltage_b: model.phaseVoltage[1],
      grid_voltage_c: model.phaseVoltage[2],
      phase_a_current: current,
      phase_b_current: current,
      phase_c_current: current,
      active_power: outputKw * 1000,
      reactive_power: outputKw * 1000 * 0.05,
      power_factor: pf,
      grid_frequency: model.frequency,
      work_state: model.startedAt || this.state === 'RUNNING' ? 0 : 0x0020,
      active_power_limit_set: model.deratingRaw * 0.01,
      mppt4_voltage: mpptVoltages[3],
      mppt4_current: mpptCurrents[3],
      mppt5_voltage: mpptVoltages[4],
      mppt5_current: mpptCurrents[4],
      mppt6_voltage: mpptVoltages[5],
      mppt6_current: mpptCurrents[5],
      mppt7_voltage: mpptVoltages[6],
      mppt7_current: mpptCurrents[6],
      mppt8_voltage: mpptVoltages[7],
      mppt8_current: mpptCurrents[7],
    };
  }

  computeHuawei() {
    const model = this.model;
    const options = this.configuration.options;

    model.phaseVoltage = model.phaseVoltage.map((v) => drift(v, 0.5, 225, 240));
    model.pvVoltage = model.pvVoltage.map((v) => drift(v, 1.2, 580, 640));
    model.frequency = drift(model.frequency, 0.02, 49.9, 50.1);

    const ratingKw = options.ratingKw || 100;
    const availabilityPct = clamp(options.availabilityPct ?? 100, 0, 100);
    const loadKw = options.loadKw ?? 100;

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
    const dcPowerKw = outputKw / 0.983;
    const pvCurrents = model.pvVoltage.map((voltage) => {
      const currentPerString = (dcPowerKw * 1000) / 4 / voltage;
      return clamp(currentPerString, 0.5, 25);
    });

    // The inverter's own external-meter view mirrors the grid connection:
    // grid = load - inverter output (import positive, export negative).
    const gridW = (loadKw - outputKw) * 1000;
    const importKw = Math.max(gridW, 0) / 1000;
    const exportKw = Math.max(-gridW, 0) / 1000;
    model.meterImportKwh += importKw * dtHours;
    model.meterExportKwh += exportKw * dtHours;

    const running = model.startedAt ? true : false;
    const state1 = running
      ? (2 | 4 | (model.deratingRaw < 1000 ? 8 : 0)) // grid connected + normal + derating?
      : 0;
    const state2 = running ? (1 | 4) : 0; // PV connected + DSP collection

    const meterCurrents = (Math.abs(gridW) / 3) / (avgVoltage * 0.99);

    return {
      model_name: 'SUN2000-100KTL-M0',
      serial_number: 'SN0123456789',
      pn_code: 'PN0100123456',
      model_id: 1,
      pv_strings_count: 4,
      mppt_count: 2,
      rated_power: ratingKw,
      max_active_power: ratingKw * 1.1,
      max_apparent_power: ratingKw * 1.1,
      state_1: state1,
      state_2: state2,
      alarm_1: 0,
      alarm_2: 0,
      alarm_3: 0,
      pv1_voltage: model.pvVoltage[0],
      pv1_current: pvCurrents[0],
      pv2_voltage: model.pvVoltage[1],
      pv2_current: pvCurrents[1],
      pv3_voltage: model.pvVoltage[2],
      pv3_current: pvCurrents[2],
      pv4_voltage: model.pvVoltage[3],
      pv4_current: pvCurrents[3],
      total_input_power: dcPowerKw,
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
      reactive_power: outputKw * 0.1,
      power_factor: pf,
      grid_frequency: model.frequency,
      efficiency: 98.3,
      cabinet_temperature: 42.5,
      insulation_resistance: 50.0,
      device_status: running ? 1 : 2,
      total_yield: model.totalYieldKwh,
      daily_yield: model.dailyYieldKwh,
      battery_status: 2,
      battery_charge_discharge_power: -800,
      battery_soc: model.batterySoc,
      battery_daily_charge_energy: model.batteryDailyChargeKwh,
      battery_daily_discharge_energy: model.batteryDailyDischargeKwh,
      meter_status: 1,
      meter_phase_a_voltage: model.phaseVoltage[0],
      meter_phase_b_voltage: model.phaseVoltage[1],
      meter_phase_c_voltage: model.phaseVoltage[2],
      meter_phase_a_current: meterCurrents,
      meter_phase_b_current: meterCurrents,
      meter_phase_c_current: meterCurrents,
      meter_grid_active_power: gridW,
      meter_grid_reactive_power: Math.abs(gridW) * 0.1,
      meter_power_factor: 0.99,
      meter_frequency: model.frequency,
      meter_total_export_energy: model.meterExportKwh,
      meter_total_import_energy: model.meterImportKwh,
      remote_power_control_enable: model.remoteControl,
      active_power_derating: model.deratingRaw * 0.1, // engineering % for read-back
      active_power_fixed_limit: model.fixedDeratingW,
      reactive_power_pf_command: model.pfCommand,
      zero_export_mode: model.zeroExportMode,
      max_grid_feed_in_power: model.maxFeedInW,
      battery_max_charge_power_limit: model.batteryMaxChargeW,
      battery_max_discharge_power_limit: model.batteryMaxDischargeW,
      battery_force_control_command: model.batteryForceCommand,
    };
  }

  /** Contiguous defined blocks per area; crossing between blocks returns
   *  exception 02 on the real device and the simulator alike. */
  readBlocks() {
    const byType = new Map();
    for (const register of this.profile.registers) {
      if (register.enabled === false) continue;
      const list = byType.get(register.registerType) || [];
      list.push(register);
      byType.set(register.registerType, list);
    }

    const blocks = [];
    for (const [registerType, list] of byType) {
      list.sort((left, right) => left.address - right.address);
      let current = null;
      for (const register of list) {
        if (current && register.address <= current.address + current.length) {
          current.length = Math.max(
            current.length,
            register.address + register.length - current.address,
          );
        } else {
          current = { registerType, address: register.address, length: register.length };
          blocks.push(current);
        }
      }
    }
    return blocks.sort((left, right) => left.address - right.address);
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
      readBlocks: this.readBlocks(),
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
  waitForServer,
};
