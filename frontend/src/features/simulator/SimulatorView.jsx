import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CirclePlus,
  FlaskConical,
  LoaderCircle,
  Play,
  Save,
  Square,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorBanner, EmptyState, KeyValue } from "@/components/common/Feedback";
import { Field, SwitchRow } from "@/components/common/FormControls";
import { api } from "@/lib/api";
import { formatValue } from "@/lib/formatters";

const DEVICE_KEYS = ["em500", "huawei"];

const DEVICE_DEFAULTS = {
  em500: { label: "EM500 grid meter", port: "15020", unitId: "1", loadKw: "100" },
  huawei: {
    label: "Huawei SUN2000 inverter",
    port: "15021",
    unitId: "2",
    ratingKw: "100",
    availabilityPct: "80",
  },
};

export function SimulatorView({ devices, profiles, notify, onForwardProfile }) {
  const [status, setStatus] = useState(null);
  const [forms, setForms] = useState(() =>
    Object.fromEntries(
      DEVICE_KEYS.map((key) => [
        key,
        {
          host: "0.0.0.0",
          port: DEVICE_DEFAULTS[key].port,
          unitId: DEVICE_DEFAULTS[key].unitId,
          updateIntervalMs: "1000",
          ratingKw: "100",
          availabilityPct: "80",
          loadKw: "100",
        },
      ]),
    ),
  );
  const [values, setValues] = useState({ em500: [], huawei: [] });
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [deratingPct, setDeratingPct] = useState("100");

  const load = useCallback(async () => {
    try {
      const response = await api.getSimulator();
      setStatus(response.data);
      setForms((current) => {
        const next = { ...current };
        for (const [key, device] of Object.entries(response.data.devices || {})) {
          next[key] = {
            host: device.host ?? next[key]?.host ?? "0.0.0.0",
            port: String(device.port ?? next[key]?.port ?? 15020),
            unitId: String(device.unitId ?? next[key]?.unitId ?? 1),
            updateIntervalMs: String(
              device.updateIntervalMs ?? next[key]?.updateIntervalMs ?? 1000,
            ),
            ratingKw: String(
              device.options?.ratingKw ?? next[key]?.ratingKw ?? 100,
            ),
            availabilityPct: String(
              device.options?.availabilityPct ?? next[key]?.availabilityPct ?? 80,
            ),
            loadKw: String(
              device.options?.loadKw ?? next[key]?.loadKw ?? 100,
            ),
          };
        }
        return next;
      });
      setError("");
    } catch (loadError) {
      setError(loadError?.message || "Unable to load the simulator status.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [em500, huawei] = await Promise.all([
          api.getSimulatorValues("em500"),
          api.getSimulatorValues("huawei"),
        ]);
        setValues({ em500: em500.data || [], huawei: huawei.data || [] });
      } catch {
        // The simulator may be stopped; the status cards show the state.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const em500Profile = useMemo(
    () => profiles.find((profile) => profile.identifier === "em500"),
    [profiles],
  );
  const huaweiProfile = useMemo(
    () => profiles.find((profile) => profile.identifier === "huawei-sun2000"),
    [profiles],
  );
  const simulatorDevices = useMemo(
    () => ({
      em500: devices.find((device) => device.identifier === "em500-simulator"),
      huawei: devices.find((device) => device.identifier === "huawei-simulator"),
    }),
    [devices],
  );

  const run = async (deviceKey, operation, successMessage) => {
    setWorking(deviceKey);
    setError("");
    try {
      const response = await operation();
      const deviceStatus = response.data;
      setStatus((current) => ({
        ...current,
        devices: { ...current?.devices, [deviceKey]: deviceStatus },
      }));
      notify(successMessage);
    } catch (operationError) {
      setError(operationError?.message || "Simulator operation failed.");
      notify(operationError?.message || "Simulator operation failed.", "error");
    } finally {
      setWorking("");
    }
  };

  const save = (deviceKey) => {
    const form = forms[deviceKey];
    const payload = {
      host: form.host.trim(),
      port: Number(form.port),
      unitId: Number(form.unitId),
      updateIntervalMs: Number(form.updateIntervalMs),
    };
    if (deviceKey === "huawei") {
      payload.options = {
        ratingKw: Number(form.ratingKw),
        availabilityPct: Number(form.availabilityPct),
      };
    }
    if (deviceKey === "em500") {
      const loadKw = Number(form.loadKw);
      payload.options = { loadKw };
      // The Huawei inverter mirrors the same grid point, so keep its load
      // setting in sync too.
      void api
        .updateSimulatorDevice("huawei", { options: { loadKw } })
        .catch(() => undefined);
    }
    return run(
      deviceKey,
      () => api.updateSimulatorDevice(deviceKey, payload),
      `${DEVICE_DEFAULTS[deviceKey].label} settings saved.`,
    );
  };

  const start = (deviceKey) =>
    run(
      deviceKey,
      () => api.startSimulatorDevice(deviceKey),
      `${DEVICE_DEFAULTS[deviceKey].label} started.`,
    );
  const stop = (deviceKey) =>
    run(
      deviceKey,
      () => api.stopSimulatorDevice(deviceKey),
      `${DEVICE_DEFAULTS[deviceKey].label} stopped.`,
    );

  const setField = (deviceKey, field, value) =>
    setForms((current) => ({
      ...current,
      [deviceKey]: { ...current[deviceKey], [field]: value },
    }));

  const addSimulatorDevices = async () => {
    const missing = [];
    if (!em500Profile) missing.push("EM500 profile (restore built-ins)");
    if (!huaweiProfile) missing.push("Huawei profile (restore built-ins)");
    if (missing.length > 0) {
      notify(`Missing: ${missing.join(", ")}`, "error");
      return;
    }
    try {
      const em500UnitId = Number(forms.em500.unitId);
      const huaweiUnitId = Number(forms.huawei.unitId);
      const created = [];
      if (!simulatorDevices.em500) {
        await api.createDevice({
          identifier: "em500-simulator",
          name: "EM500 Simulator",
          site: "Simulator",
          unitId: em500UnitId,
          connection: { protocol: "TCP", host: "127.0.0.1", port: Number(forms.em500.port) },
          registerProfileId: em500Profile._id,
          polling: { enabled: true, intervalMs: 5000, jitterMs: 1000 },
          reconnect: { timeoutMs: 2000, retries: 1, retryDelayMs: 200 },
          tags: ["simulator"],
        });
        created.push("EM500 meter");
      }
      if (!simulatorDevices.huawei) {
        await api.createDevice({
          identifier: "huawei-simulator",
          name: "Huawei SUN2000 Simulator",
          site: "Simulator",
          unitId: huaweiUnitId,
          connection: { protocol: "TCP", host: "127.0.0.1", port: Number(forms.huawei.port) },
          registerProfileId: huaweiProfile._id,
          polling: { enabled: true, intervalMs: 5000, jitterMs: 1000 },
          reconnect: { timeoutMs: 2000, retries: 1, retryDelayMs: 200 },
          tags: ["simulator"],
        });
        created.push("Huawei inverter");
      }
      notify(
        created.length > 0
          ? `Simulator devices created and polling: ${created.join(", ")}.`
          : "Simulator devices already exist; open them from the Devices page.",
      );
    } catch (createError) {
      notify(createError?.message || "Unable to create simulator devices.", "error");
    }
  };

  const forward = async (profile) => {
    if (!profile) {
      notify("Restore the built-in profile before forwarding it.", "error");
      return;
    }
    await onForwardProfile(profile);
  };

  /** Write a derating percentage to the inverter like an external master would. */
  const setInverterDerating = async () => {
    const deviceRef = simulatorDevices.huawei;
    if (!deviceRef) {
      notify("Create the Huawei simulator device first.", "error");
      return;
    }
    const pct = Number(deratingPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      notify("Derating must be between 0 and 100 percent.", "error");
      return;
    }
    setWorking("huawei");
    try {
      await api.rawWrite(deviceRef._id, {
        registerType: "HOLDING_REGISTER",
        address: 40125,
        values: [Math.round(pct * 10)],
      });
      notify(
        `Inverter derating set to ${pct}% (raw ${Math.round(pct * 10)} on register 40125).`,
      );
    } catch (writeError) {
      notify(
        writeError?.message || "Unable to write the derating register.",
        "error",
      );
    } finally {
      setWorking("");
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">
            Test without a meter
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Device simulators
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Process-local Modbus TCP slaves for an EM500 grid meter and a
            Huawei SUN2000 inverter. Set each device's own unit ID and port,
            then poll, forward, or control them exactly like real hardware.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={addSimulatorDevices} disabled={Boolean(working)}>
            <CirclePlus className="h-4 w-4" /> Add simulator devices
          </Button>
          <Button variant="outline" onClick={load} disabled={Boolean(working)}>
            <Save className="h-4 w-4" /> Reload status
          </Button>
        </div>
      </section>

      <ErrorBanner message={error} />

      <div className="grid gap-5 xl:grid-cols-2">
        {DEVICE_KEYS.map((key) => {
          const deviceStatus = status?.devices?.[key];
          const running = deviceStatus?.state === "RUNNING";
          const busy = working === key;
          const form = forms[key];
          const defaults = DEVICE_DEFAULTS[key];
          const deviceRef = simulatorDevices[key];
          return (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4" /> {defaults.label}
                    </CardTitle>
                    <CardDescription>
                      {key === "huawei"
                        ? "Holding registers (FC03) plus writable derating (FC06/FC16)."
                        : "Input registers (FC04) with the EM500 map."}
                    </CardDescription>
                  </div>
                  <Badge className={running ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>
                    {deviceStatus?.state || "STOPPED"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="font-mono">
                    {deviceStatus?.host || form.host}:{deviceStatus?.port ?? form.port}
                  </span>
                  <span>·</span>
                  <span>Unit {deviceStatus?.unitId ?? form.unitId}</span>
                  {key === "huawei" && (
                    <>
                      <span>·</span>
                      <span>
                        {deviceStatus?.deratingPercent ?? 100}% derating
                      </span>
                    </>
                  )}
                  {deviceStatus?.lastError?.message && (
                    <span className="w-full text-rose-700">
                      {deviceStatus.lastError.message}
                    </span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Unit ID" hint="Slave ID this device answers on.">
                    <Input
                      type="number"
                      min="1"
                      max="247"
                      value={form.unitId}
                      onChange={(event) => setField(key, "unitId", event.target.value)}
                    />
                  </Field>
                  <Field label="TCP port">
                    <Input
                      type="number"
                      min="1"
                      max="65535"
                      value={form.port}
                      onChange={(event) => setField(key, "port", event.target.value)}
                    />
                  </Field>
                  <Field label="Update (ms)">
                    <Input
                      type="number"
                      min="250"
                      max="60000"
                      value={form.updateIntervalMs}
                      onChange={(event) => setField(key, "updateIntervalMs", event.target.value)}
                    />
                  </Field>
                  {key === "huawei" && (
                    <>
                      <Field label="Solar rating (kW)">
                        <Input
                          type="number"
                          min="0.1"
                          value={form.ratingKw}
                          onChange={(event) => setField(key, "ratingKw", event.target.value)}
                        />
                      </Field>
                      <Field label="Solar availability (%)" hint="Simulated irradiance.">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={form.availabilityPct}
                          onChange={(event) => setField(key, "availabilityPct", event.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  {key === "em500" && (
                    <Field
                      label="Site load (kW)"
                      hint="Grid = load − inverter output; synced from the zero-export page when simulation is on."
                    >
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={form.loadKw}
                        onChange={(event) => setField(key, "loadKw", event.target.value)}
                      />
                    </Field>
                  )}
                </div>

                {key === "huawei" && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <Field
                      label="Set derating (%)"
                      hint="Write like an external master: 40125 = percent × 10 (100 → 1000)."
                    >
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={deratingPct}
                        onChange={(event) => setDeratingPct(event.target.value)}
                      />
                    </Field>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={setInverterDerating}
                      disabled={!simulatorDevices.huawei || Boolean(working)}
                      title={
                        simulatorDevices.huawei
                          ? "Write the percentage to the inverter's derating register."
                          : "Create the Huawei simulator device first."
                      }
                    >
                      <Zap className="h-4 w-4" /> Write to inverter
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => save(key)} disabled={busy}>
                    <Save className="h-4 w-4" /> Save
                  </Button>
                  {running ? (
                    <Button variant="destructive" size="sm" onClick={() => stop(key)} disabled={busy}>
                      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                      Stop
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => start(key)} disabled={busy}>
                      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Start
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => forward(key === "em500" ? em500Profile : huaweiProfile)}
                    disabled={!deviceRef || Boolean(working)}
                    title={
                      deviceRef
                        ? "Add this profile to the forwarding gateway at the same addresses."
                        : "Create the simulator device first."
                    }
                  >
                    <ArrowRightLeft className="h-4 w-4" /> Forward profile
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
                  <KeyValue label="Registers" value={deviceStatus?.servedRegisterCount ?? 0} />
                  <KeyValue label="Ticks" value={deviceStatus?.tickCount ?? 0} />
                  <KeyValue label="Last request" value={deviceStatus?.lastRequestAt ? new Date(deviceStatus.lastRequestAt).toLocaleTimeString() : "—"} />
                  <KeyValue label="Last tick" value={deviceStatus?.lastTickAt ? new Date(deviceStatus.lastTickAt).toLocaleTimeString() : "—"} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {DEVICE_KEYS.map((key) => (
        <Card key={`values-${key}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" /> {DEVICE_DEFAULTS[key].label} values
              <Badge variant="outline">{values[key].length}</Badge>
            </CardTitle>
            <CardDescription>
              Live snapshot served by the {DEVICE_DEFAULTS[key].label} simulator;
              refreshes every three seconds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {values[key].length === 0 ? (
              <EmptyState
                title="No values yet"
                description="Start this simulator device to generate values."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Register</th>
                      <th className="px-3 py-2">Address</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2">Raw words</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {values[key].map((value) => (
                      <tr key={value.registerKey}>
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{value.registerName}</span>
                          <span className="ml-2 font-mono text-xs text-slate-400">
                            {value.registerKey}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                          0x{Number(value.address).toString(16).toUpperCase().padStart(4, "0")}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {formatValue(value.value)}{" "}
                          <span className="text-xs text-slate-400">{value.unit || ""}</span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                          {value.rawValues?.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
