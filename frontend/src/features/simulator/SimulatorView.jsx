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

const DEVICE_KEYS = ["em500", "huawei", "solis"];

const DEVICE_DEFAULTS = {
  em500: { label: "EM500 grid meter", port: "15020", unitId: "1", loadKw: "100" },
  huawei: {
    label: "Huawei SUN2000 inverter",
    port: "15021",
    unitId: "2",
    ratingKw: "100",
    availabilityPct: "80",
  },
  solis: {
    label: "Solis inverter",
    port: "15022",
    unitId: "3",
    ratingKw: "100",
    availabilityPct: "80",
  },
};

// Inverter simulator keys that expose a writable derating/power-limit
// register in their profile.
const DERATING_DEVICE_KEYS = ["huawei", "solis"];

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
          maxReadQuantity: "",
        },
      ]),
    ),
  );
  const [values, setValues] = useState({ em500: [], huawei: [] });
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [deratingPct, setDeratingPct] = useState("100");
  const [deratingTarget, setDeratingTarget] = useState("");

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
            maxReadQuantity: String(
              device.options?.maxReadQuantity ?? next[key]?.maxReadQuantity ?? "",
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
    let cancelled = false;
    let timer;
    let failures = 0;

    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          const [em500, huawei, solis] = await Promise.all([
            api.getSimulatorValues("em500"),
            api.getSimulatorValues("huawei"),
            api.getSimulatorValues("solis"),
          ]);
          setValues({ em500: em500.data || [], huawei: huawei.data || [], solis: solis.data || [] });
          failures = 0;
        } catch {
          failures += 1;
        }
      }
      // Back off when the backend is down: 3s normally, 15s after failures.
      timer = setTimeout(tick, failures >= 3 ? 15000 : 3000);
    };

    timer = setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const em500Profile = useMemo(
    () => profiles.find((profile) => profile.identifier === "em500"),
    [profiles],
  );
  const huaweiProfile = useMemo(
    () => profiles.find((profile) => profile.identifier === "huawei-sun2000"),
    [profiles],
  );
  const solisProfile = useMemo(
    () => profiles.find((profile) => profile.identifier === "solis-inverter"),
    [profiles],
  );
  const simulatorDevices = useMemo(
    () => ({
      em500: devices.find((device) => device.identifier === "em500-simulator"),
      huawei: devices.find((device) => device.identifier === "huawei-simulator"),
      solis: devices.find((device) => device.identifier === "solis-simulator"),
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
    if (deviceKey === "huawei" || deviceKey === "solis") {
      payload.options = {
        ratingKw: Number(form.ratingKw),
        availabilityPct: Number(form.availabilityPct),
      };
    }
    if (deviceKey === "em500") {
      const loadKw = Number(form.loadKw);
      payload.options = { loadKw };
      // The inverters mirror the same grid point, so keep their load
      // settings in sync too.
      void api
        .updateSimulatorDevice("huawei", { options: { loadKw } })
        .catch(() => undefined);
      void api
        .updateSimulatorDevice("solis", { options: { loadKw } })
        .catch(() => undefined);
    }
    const maxReadQuantity = form.maxReadQuantity.trim();
    if (maxReadQuantity !== "") {
      payload.options = { ...payload.options, maxReadQuantity: Number(maxReadQuantity) };
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
    if (!solisProfile) missing.push("Solis profile (restore built-ins)");
    if (missing.length > 0) {
      notify(`Missing: ${missing.join(", ")}`, "error");
      return;
    }
    try {
      const em500UnitId = Number(forms.em500.unitId);
      const huaweiUnitId = Number(forms.huawei.unitId);
      const solisUnitId = Number(forms.solis.unitId);
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
      if (!simulatorDevices.solis) {
        await api.createDevice({
          identifier: "solis-simulator",
          name: "Solis Inverter Simulator",
          site: "Simulator",
          unitId: solisUnitId,
          connection: { protocol: "TCP", host: "127.0.0.1", port: Number(forms.solis.port) },
          registerProfileId: solisProfile._id,
          polling: { enabled: true, intervalMs: 5000, jitterMs: 1000 },
          reconnect: { timeoutMs: 2000, retries: 1, retryDelayMs: 200 },
          tags: ["simulator"],
        });
        created.push("Solis inverter");
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

  /** Derating targets derived from each simulator device's assigned profile:
   *  the writable holding register whose key suggests derating / power limit. */
  const deratingTargets = useMemo(() => {
    const targets = [];
    for (const key of DERATING_DEVICE_KEYS) {
      const device = simulatorDevices[key];
      if (!device) continue;
      const profileId = device.registerProfile?._id;
      const profile = profiles.find((item) => String(item._id) === String(profileId));
      const register = profile?.registers?.find(
        (item) =>
          item.writable &&
          item.registerType === "HOLDING_REGISTER" &&
          /derating|power.?limit|limit/i.test(item.key),
      );
      if (register) {
        targets.push({
          key,
          device,
          register,
          label: `${DEVICE_DEFAULTS[key].label} — ${register.key} @ ${register.address}`,
        });
      }
    }
    return targets;
  }, [simulatorDevices, profiles]);

  useEffect(() => {
    if (!deratingTarget && deratingTargets.length > 0) {
      setDeratingTarget(deratingTargets[0].key);
    }
  }, [deratingTarget, deratingTargets]);

  const activeTarget = deratingTargets.find((target) => target.key === deratingTarget);

  /** Write a derating percentage to the selected profile's register. */
  const writeDerating = async () => {
    const target = activeTarget;
    if (!target) {
      notify(
        "Select an inverter profile first (create the simulator device).",
        "error",
      );
      return;
    }
    const pct = Number(deratingPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      notify("Derating must be between 0 and 100 percent.", "error");
      return;
    }
    const raw = Math.round(pct / target.register.scaleFactor);
    setWorking(target.key);
    try {
      await api.rawWrite(target.device._id, {
        registerType: "HOLDING_REGISTER",
        address: target.register.address,
        values: [raw],
      });
      notify(
        `${DEVICE_DEFAULTS[target.key].label}: ${pct}% written to ${target.register.key} (raw ${raw} @ ${target.register.address}).`,
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

  const liveDeratingValue = activeTarget
    ? values[activeTarget.key]?.find(
        (value) => value.registerKey === activeTarget.register.key,
      )?.value
    : null;

  /** Toggle the EM500 tariff register (8448): 0 = off, 1 = on. */
  const setTariff = async (enabled) => {
    const deviceRef = simulatorDevices.em500;
    if (!deviceRef) {
      notify("Create the EM500 simulator device first.", "error");
      return;
    }
    setWorking("em500");
    try {
      await api.rawWrite(deviceRef._id, {
        registerType: "HOLDING_REGISTER",
        address: 8448,
        values: [enabled ? 1 : 0],
      });
      notify(
        `Tariff ${enabled ? "ON" : "OFF"} (register 8448 = ${enabled ? 1 : 0}).`,
      );
    } catch (writeError) {
      notify(
        writeError?.message || "Unable to write the tariff register.",
        "error",
      );
    } finally {
      setWorking("");
    }
  };

  // Live tariff state from the simulator values (register 8448 read-back).
  const tariffValue = values.em500?.find(
    (value) => value.registerKey === "tariff_enable",
  )?.value;

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Power control
            <Badge variant="outline">profile-driven</Badge>
          </CardTitle>
          <CardDescription>
            Select the inverter profile — the writable derating register from
            that profile is used automatically (Huawei 40125, Solis 3051).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deratingTargets.length === 0 ? (
            <p className="text-sm text-slate-500">
              No inverter devices with a derating register yet. Start the
              simulators and create the simulator devices first.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Inverter profile" className="min-w-[260px] flex-1">
                <Select
                  value={deratingTarget}
                  onChange={(event) => setDeratingTarget(event.target.value)}
                  options={deratingTargets.map((target) => ({
                    value: target.key,
                    label: target.label,
                  }))}
                />
              </Field>
              <Field
                label="Derating (%)"
                hint={
                  activeTarget
                    ? `Writes ${activeTarget.register.scaleFactor}-step raw value to register ${activeTarget.register.address} (${activeTarget.register.key}).`
                    : undefined
                }
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
                onClick={writeDerating}
                disabled={!activeTarget || Boolean(working)}
              >
                {working ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Write {deratingPct}%
              </Button>
              <div className="text-sm text-slate-500">
                Read-back:{" "}
                <span className="font-mono font-medium text-slate-800">
                  {liveDeratingValue === null || liveDeratingValue === undefined
                    ? "—"
                    : `${liveDeratingValue}%`}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                  {(key === "huawei" || key === "solis") && (
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
                  {(key === "huawei" || key === "solis") && (
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
                  <Field
                    label="Max read quantity"
                    hint="Raise to 125 to read big batches (e.g. 32016 × 80); empty = profile default (15)."
                  >
                    <Input
                      type="number"
                      min="1"
                      max="125"
                      value={form.maxReadQuantity}
                      onChange={(event) => setField(key, "maxReadQuantity", event.target.value)}
                    />
                  </Field>
                </div>

                {key === "em500" && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="min-w-[220px] flex-1">
                      <SwitchRow
                        label="Tariff"
                        description="Register 8448 (0x2100): ON = 1, OFF = 0"
                        checked={Number(tariffValue) === 1}
                        onCheckedChange={setTariff}
                      />
                    </div>
                    <p className="w-full text-[11px] text-slate-500">
                      Writes the tariff selection like an external master (FC06,
                      holding register 8448). Live state comes from the polled
                      read-back.
                    </p>
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
                    onClick={() =>
                      forward(
                        key === "em500"
                          ? em500Profile
                          : key === "huawei"
                            ? huaweiProfile
                            : solisProfile,
                      )
                    }
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

                {deviceStatus?.readBlocks?.length > 0 && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Defined FC03 read blocks (gaps read as 0)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {deviceStatus.readBlocks.map((block) => (
                        <span
                          key={`${block.registerType}-${block.address}`}
                          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600"
                        >
                          {block.address}–{block.address + block.length - 1} ({block.length})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
