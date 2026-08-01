export const DEVICE_STATUSES = [
  "UNKNOWN",
  "ONLINE",
  "OFFLINE",
  "TIMEOUT",
  "ERROR",
];

export const REGISTER_TYPES = [
  "HOLDING_REGISTER",
  "INPUT_REGISTER",
  "COIL",
  "DISCRETE_INPUT",
];

export const DATA_TYPES = [
  "INT16",
  "UINT16",
  "INT32",
  "UINT32",
  "INT64",
  "UINT64",
  "FLOAT32",
  "FLOAT64",
  "STRING",
  "BIT",
];

export const REGISTER_ORDER_OPTIONS = ["ABCD", "BADC", "CDAB", "DCBA"];

export const REGISTER_ORDER_TO_API = {
  ABCD: { byteOrder: "BIG_ENDIAN", wordOrder: "BIG_ENDIAN" },
  BADC: { byteOrder: "LITTLE_ENDIAN", wordOrder: "BIG_ENDIAN" },
  CDAB: { byteOrder: "BIG_ENDIAN", wordOrder: "LITTLE_ENDIAN" },
  DCBA: { byteOrder: "LITTLE_ENDIAN", wordOrder: "LITTLE_ENDIAN" },
};

export const API_ORDER_TO_REGISTER = Object.fromEntries(
  Object.entries(REGISTER_ORDER_TO_API).map(([order, values]) => [
    `${values.byteOrder}:${values.wordOrder}`,
    order,
  ]),
);

export const STATUS_STYLES = {
  ONLINE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  OFFLINE: "border-slate-200 bg-slate-100 text-slate-600",
  TIMEOUT: "border-amber-200 bg-amber-50 text-amber-700",
  ERROR: "border-rose-200 bg-rose-50 text-rose-700",
  UNKNOWN: "border-indigo-200 bg-indigo-50 text-indigo-700",
};

export const OUTCOME_STYLES = {
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PARTIAL_SUCCESS: "border-amber-200 bg-amber-50 text-amber-700",
  FAILURE: "border-rose-200 bg-rose-50 text-rose-700",
};
