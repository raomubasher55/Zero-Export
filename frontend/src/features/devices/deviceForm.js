import { optionalText } from "@/lib/formatters";

export function deviceToForm(device) {
  return {
    identifier: device?.identifier || "",
    name: device?.name || "",
    description: device?.description || "",
    site: device?.site || "",
    unitId: String(device?.unitId ?? 1),
    registerProfileId: device?.registerProfile?._id || "",
    tags: device?.tags?.join(", ") || "",
    isEnabled: device?.isEnabled ?? true,
    connection: {
      protocol: device?.connection?.protocol || "TCP",
      host: device?.connection?.host || "",
      port: String(device?.connection?.port ?? 502),
      serialPath: device?.connection?.serialPath || "",
      baudRate: String(device?.connection?.baudRate ?? 9600),
      dataBits: String(device?.connection?.dataBits ?? 8),
      stopBits: String(device?.connection?.stopBits ?? 1),
      parity: device?.connection?.parity || "none",
    },
    polling: {
      enabled: device?.polling?.enabled ?? true,
      intervalMs: String(device?.polling?.intervalMs ?? 5000),
      jitterMs: String(device?.polling?.jitterMs ?? 0),
    },
    reconnect: {
      timeoutMs: String(device?.reconnect?.timeoutMs ?? 3000),
      retries: String(device?.reconnect?.retries ?? 2),
      retryDelayMs: String(device?.reconnect?.retryDelayMs ?? 500),
    },
  };
}

export function devicePayload(form) {
  const connection =
    form.connection.protocol === "TCP"
      ? {
          protocol: "TCP",
          host: form.connection.host.trim(),
          port: Number(form.connection.port),
        }
      : {
          protocol: "RTU",
          serialPath: form.connection.serialPath.trim(),
          baudRate: Number(form.connection.baudRate),
          dataBits: Number(form.connection.dataBits),
          stopBits: Number(form.connection.stopBits),
          parity: form.connection.parity,
        };

  return {
    identifier: form.identifier.trim(),
    name: form.name.trim(),
    description: optionalText(form.description) || null,
    site: optionalText(form.site) || null,
    unitId: Number(form.unitId),
    connection,
    registerProfileId: form.registerProfileId || null,
    polling: {
      enabled: form.polling.enabled,
      intervalMs: Number(form.polling.intervalMs),
      jitterMs: Number(form.polling.jitterMs),
    },
    reconnect: {
      timeoutMs: Number(form.reconnect.timeoutMs),
      retries: Number(form.reconnect.retries),
      retryDelayMs: Number(form.reconnect.retryDelayMs),
    },
    isEnabled: form.isEnabled,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}
