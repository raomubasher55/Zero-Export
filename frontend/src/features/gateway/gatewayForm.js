import {
  API_ORDER_TO_REGISTER,
  REGISTER_ORDER_TO_API,
} from "@/constants/modbus";
import { optionalText } from "@/lib/formatters";

export function createGatewayForm(configuration) {
  return {
    enabled: configuration?.enabled ?? false,
    unitId: String(configuration?.unitId ?? 1),
    tcp: {
      enabled: configuration?.tcp?.enabled ?? true,
      host: configuration?.tcp?.host || "0.0.0.0",
      port: String(configuration?.tcp?.port ?? 1502),
    },
    rtu: {
      enabled: configuration?.rtu?.enabled ?? false,
      serialPath: configuration?.rtu?.serialPath || "/dev/ttyUSB1",
      baudRate: String(configuration?.rtu?.baudRate ?? 9600),
      dataBits: String(configuration?.rtu?.dataBits ?? 8),
      stopBits: String(configuration?.rtu?.stopBits ?? 1),
      parity: configuration?.rtu?.parity || "none",
    },
    mappings: (configuration?.mappings || []).map(mappingToForm),
  };
}

function mappingToForm(mapping) {
  return {
    key: mapping.key,
    name: mapping.name,
    sourceDeviceId: String(mapping.sourceDeviceId),
    sourceRegisterKey: mapping.sourceRegisterKey,
    registerType: mapping.registerType,
    address: String(mapping.address),
    dataType: mapping.dataType,
    length: String(mapping.length),
    order:
      API_ORDER_TO_REGISTER[`${mapping.byteOrder}:${mapping.wordOrder}`] ||
      "ABCD",
    bitIndex: String(mapping.bitIndex ?? 0),
    scaleFactor: String(mapping.scaleFactor ?? 1),
    offset: String(mapping.offset ?? 0),
    unit: mapping.unit || "",
    writable: mapping.writable ?? false,
    enabled: mapping.enabled ?? true,
  };
}

function safeKey(value) {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(normalized) ? normalized.slice(0, 64) : `r_${normalized}`.slice(0, 64);
}

export function mappingFromSource(device, register, index, current = {}) {
  const sourceKey = `${device?.identifier || "device"}_${register?.key || `register_${index + 1}`}`;
  return {
    key: current.key || safeKey(sourceKey),
    name: current.name || register?.name || `Forwarded register ${index + 1}`,
    sourceDeviceId: String(device?._id || current.sourceDeviceId || ""),
    sourceRegisterKey: register?.key || current.sourceRegisterKey || "",
    registerType: register?.registerType || current.registerType || "INPUT_REGISTER",
    address: String(register?.address ?? current.address ?? index),
    dataType: register?.dataType || current.dataType || "UINT16",
    length: String(register?.length ?? current.length ?? 1),
    order:
      register
        ? API_ORDER_TO_REGISTER[`${register.byteOrder}:${register.wordOrder}`] || "ABCD"
        : current.order || "ABCD",
    bitIndex: String(register?.bitIndex ?? current.bitIndex ?? 0),
    scaleFactor: String(register?.scaleFactor ?? current.scaleFactor ?? 1),
    offset: String(register?.offset ?? current.offset ?? 0),
    unit: register?.unit || current.unit || "",
    writable:
      current.writable ??
      Boolean(
        register?.writable &&
          ["COIL", "HOLDING_REGISTER"].includes(register?.registerType),
      ),
    enabled: current.enabled ?? true,
  };
}

export function gatewayPayload(form) {
  return {
    enabled: form.enabled,
    unitId: Number(form.unitId),
    tcp: {
      enabled: form.tcp.enabled,
      host: form.tcp.host.trim(),
      port: Number(form.tcp.port),
    },
    rtu: {
      enabled: form.rtu.enabled,
      serialPath: form.rtu.serialPath.trim(),
      baudRate: Number(form.rtu.baudRate),
      dataBits: Number(form.rtu.dataBits),
      stopBits: Number(form.rtu.stopBits),
      parity: form.rtu.parity,
    },
    mappings: form.mappings.map((mapping) => {
      const order =
        REGISTER_ORDER_TO_API[mapping.order] || REGISTER_ORDER_TO_API.ABCD;
      return {
        key: mapping.key.trim(),
        name: mapping.name.trim(),
        sourceDeviceId: mapping.sourceDeviceId,
        sourceRegisterKey: mapping.sourceRegisterKey,
        registerType: mapping.registerType,
        address: Number(mapping.address),
        dataType: mapping.dataType,
        length: Number(mapping.length),
        byteOrder: order.byteOrder,
        wordOrder: order.wordOrder,
        bitIndex: Number(mapping.bitIndex || 0),
        scaleFactor: Number(mapping.scaleFactor),
        offset: Number(mapping.offset),
        unit: optionalText(mapping.unit) || null,
        writable: mapping.writable,
        enabled: mapping.enabled,
      };
    }),
  };
}
