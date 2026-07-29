import {
  API_ORDER_TO_REGISTER,
  REGISTER_ORDER_TO_API,
} from "@/constants/modbus";
import { optionalText } from "@/lib/formatters";

export function createRegister() {
  return {
    key: "",
    name: "",
    registerType: "INPUT_REGISTER",
    address: "0",
    dataType: "UINT16",
    length: "",
    order: "ABCD",
    scaleFactor: "1",
    offset: "0",
    unit: "",
    group: "",
    writable: false,
    enabled: true,
    sortOrder: "0",
  };
}

function apiOrderToCombined(register) {
  return (
    API_ORDER_TO_REGISTER[`${register.byteOrder}:${register.wordOrder}`] ||
    "ABCD"
  );
}

export function profileToForm(profile) {
  return {
    identifier: profile?.identifier || "",
    name: profile?.name || "",
    description: profile?.description || "",
    manufacturer: profile?.manufacturer || "",
    model: profile?.model || "",
    isActive: profile?.isActive ?? true,
    registers: profile?.registers?.length
      ? profile.registers.map((register) => ({
          ...createRegister(),
          ...register,
          address: String(register.address),
          length: register.length ? String(register.length) : "",
          order: apiOrderToCombined(register),
          scaleFactor: String(register.scaleFactor ?? 1),
          offset: String(register.offset ?? 0),
          sortOrder: String(register.sortOrder ?? 0),
          unit: register.unit || "",
          group: register.group || "",
        }))
      : [createRegister()],
  };
}

export function profilePayload(form) {
  return {
    identifier: form.identifier.trim(),
    name: form.name.trim(),
    description: optionalText(form.description) || null,
    manufacturer: optionalText(form.manufacturer) || null,
    model: optionalText(form.model) || null,
    isActive: form.isActive,
    registers: form.registers.map((register) => {
      const order =
        REGISTER_ORDER_TO_API[register.order] || REGISTER_ORDER_TO_API.ABCD;
      const payload = {
        key: register.key.trim(),
        name: register.name.trim(),
        registerType: register.registerType,
        address: Number(register.address),
        dataType: register.dataType,
        byteOrder: order.byteOrder,
        wordOrder: order.wordOrder,
        scaleFactor: Number(register.scaleFactor),
        offset: Number(register.offset),
        writable: register.writable,
        enabled: register.enabled,
        sortOrder: Number(register.sortOrder || 0),
        unit: optionalText(register.unit) || null,
        group: optionalText(register.group) || null,
      };
      if (register.length !== "") payload.length = Number(register.length);
      return payload;
    }),
  };
}
