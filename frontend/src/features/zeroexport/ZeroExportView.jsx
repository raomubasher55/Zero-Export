import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
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
import { Field, Select, SwitchRow } from "@/components/common/FormControls";
import { api } from "@/lib/api";
import { getErrorMessage, formatValue } from "@/lib/formatters";

function registerOptions(device, devices, profiles) {
  const fullDevice = devices.find((item) => String(item._id) === String(device?._id));
  const profileId = fullDevice?.registerProfile?._id;
  const profile = profiles.find((item) => String(item._id) === String(profileId));
  return (profile?.registers || []).map((register) => ({
    value: register.key,
    label: `${register.name} (${register.key})`,
  }));
}

export function ZeroExportView({ devices, profiles, notify }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [latestByDevice, setLatestByDevice] = useState({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.getZeroExport();
      setData(response.data);
      setForm((current) => {
        const configuration = response.data.configuration;
        return {
          enabled: configuration.enabled ?? false,
          meterDeviceId: String(configuration.meterDeviceId || current?.meterDeviceId || ""),
          meterRegisterKey: configuration.meterRegisterKey || "eqv_active_power",
          inverterDeviceId: String(configuration.inverterDeviceId || current?.inverterDeviceId || ""),
          inverterRegisterKey: configuration.inverterRegisterKey || "active_power_derating",
          targetGridKw: String(configuration.targetGridKw ?? 0),
          deadbandKw: String(configuration.deadbandKw ?? 0.5),
          stepPerCycle: String(configuration.stepPerCycle ?? 20),
          minDerating: String(configuration.minDerating ?? 0),
          maxDerating: String(configuration.maxDerating ?? 1000),
          intervalMs: String(configuration.intervalMs ?? 5000),
          failsafeDerating: String(configuration.failsafeDerating ?? 0),
          failsafeAfterMisses: String(configuration.failsafeAfterMisses ?? 3),
          simulationEnabled: configuration.simulation?.enabled ?? false,
          loadKw: String(configuration.simulation?.loadKw ?? 100),
        };
      });
      setError("");
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await api.getZeroExport();
        setData(response.data);
        const configuration = response.data.configuration;
        const ids = [configuration?.meterDeviceId, configuration?.inverterDeviceId].filter(Boolean);
        const entries = await Promise.all(
          ids.map(async (deviceId) => {
            try {
              const values = await api.listLatestValues(deviceId, { limit: 100 });
              return [String(deviceId), values.data || []];
            } catch {
              return [String(deviceId), []];
            }
          }),
        );
        setLatestByDevice(Object.fromEntries(entries));
      } catch {
        // The controller may be stopping; the next poll retries.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const meterDevice = devices.find(
    (device) => String(device._id) === String(form?.meterDeviceId),
  );
  const inverterDevice = devices.find(
    (device) => String(device._id) === String(form?.inverterDeviceId),
  );

  const deviceOptions = useMemo(
    () =>
      devices
        .filter((device) => device.registerProfile?._id)
        .map((device) => ({
          value: String(device._id),
          label: `${device.name} (${device.identifier})`,
        })),
    [devices],
  );

  const devicesSelected = Boolean(form?.meterDeviceId && form?.inverterDeviceId);

  const run = async (operation, successMessage) => {
    setWorking(true);
    setError("");
    try {
      const response = await operation();
      setData(response.data);
      notify(successMessage);
    } catch (operationError) {
      const message = getErrorMessage(operationError);
      setError(message);
      notify(message, "error");
    } finally {
      setWorking(false);
    }
  };

  const payload = () => ({
    enabled: form.enabled,
    meterDeviceId: form.meterDeviceId,
    meterRegisterKey: form.meterRegisterKey,
    inverterDeviceId: form.inverterDeviceId,
    inverterRegisterKey: form.inverterRegisterKey,
    targetGridKw: Number(form.targetGridKw),
    deadbandKw: Number(form.deadbandKw),
    stepPerCycle: Number(form.stepPerCycle),
    minDerating: Number(form.minDerating),
    maxDerating: Number(form.maxDerating),
    intervalMs: Number(form.intervalMs),
    failsafeDerating: Number(form.failsafeDerating),
    failsafeAfterMisses: Number(form.failsafeAfterMisses),
    simulation: {
      enabled: form.simulationEnabled,
      loadKw: Number(form.loadKw),
    },
  });

  /** Keep the meter simulator's site load in sync with the planned load. */
  const syncSimulatorLoad = async (simulation) => {
    if (!simulation?.enabled) return;
    try {
      await api.updateSimulatorDevice("em500", {
        options: { loadKw: Number(simulation.loadKw) },
      });
    } catch {
      // The meter simulator may not exist; the controller still works.
    }
  };

  const saveAndMaybeSync = (body, message) =>
    run(
      async () => {
        const response = await api.updateZeroExport(body);
        await syncSimulatorLoad(body.simulation);
        return response;
      },
      message,
    );

  const save = () =>
    saveAndMaybeSync(payload(), "Zero-export controller saved.");
  const start = () =>
    saveAndMaybeSync(
      { ...payload(), enabled: true },
      "Zero-export controller started.",
    );
  const stop = () =>
    run(() => api.stopZeroExport(), "Zero-export controller stopped.");

  const status = data?.status || {};
  const configuration = data?.configuration || {};
  const running = Boolean(status.running);
  const deratingPercent = status.lastDerating === null || status.lastDerating === undefined
    ? "—"
    : `${(status.lastDerating / 10).toFixed(1)}%`;

  // --- Live power flow: grid + inverter = load ---
  const latestValue = (deviceId, key) =>
    latestByDevice[String(deviceId || "")]?.find(
      (value) => value.registerKey === key,
    );

  const meterId = configuration.meterDeviceId;
  const inverterId = configuration.inverterDeviceId;
  const meterReading = latestValue(
    meterId,
    configuration.meterRegisterKey || "eqv_active_power",
  );
  const gridKwFromMeter =
    meterReading && meterReading.value !== null && meterReading.value !== undefined
      ? (String(meterReading.unit || "").toLowerCase() === "w"
          ? Number(meterReading.value) / 1000
          : Number(meterReading.value))
      : null;
  const gridKw = gridKwFromMeter ?? status.lastGridKw ?? null;

  const inverterReading = latestValue(inverterId, "active_power");
  const inverterKw =
    inverterReading && inverterReading.value !== null && inverterReading.value !== undefined
      ? Number(inverterReading.value)
      : null;

  const loadKw =
    form?.simulationEnabled && Number(form.loadKw) > 0
      ? Number(form.loadKw)
      : gridKw !== null && inverterKw !== null
        ? gridKw + inverterKw
        : null;

  const deratingReading = latestValue(inverterId, "active_power_derating");
  const liveDeratingPct =
    deratingReading && deratingReading.value !== null && deratingReading.value !== undefined
      ? Number(deratingReading.value)
      : null;

  const flowTotal = Math.max(loadKw ?? gridKw + inverterKw ?? 0, 0.001);
  const inverterShare = inverterKw !== null ? Math.min(Math.max(inverterKw / flowTotal, 0), 1) : 0;
  const gridShare = gridKw !== null ? Math.min(Math.max(gridKw / flowTotal, 0), 1) : 0;
  const gridDirection = gridKw === null ? "—" : gridKw < 0 ? "exporting" : "importing";

  if (!form) return null;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">
            Keep the grid at your setpoint
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Zero export controller
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Reads the grid power from the meter (positive = import, negative =
            export) and adjusts the inverter's active-power derating register
            every cycle. Import above the target raises solar output; export
            lowers it. Use simulation mode with the device simulators to test
            the full loop: grid = load − inverter output.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={save}
            disabled={working || !form || !devicesSelected}
            title={
              devicesSelected
                ? "Save the controller configuration."
                : "Select the grid meter and inverter devices first."
            }
          >
            <Save className="h-4 w-4" /> Save
          </Button>
          {running ? (
            <Button variant="destructive" onClick={stop} disabled={working}>
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Stop
            </Button>
          ) : (
            <Button
              onClick={start}
              disabled={working || !devicesSelected}
              title={
                devicesSelected
                  ? "Start the zero-export control loop."
                  : "Select the grid meter and inverter devices first."
              }
            >
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start
            </Button>
          )}
        </div>
      </section>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Power flow
            <Badge variant="outline">live</Badge>
            {form.simulationEnabled && <Badge variant="outline">Simulation</Badge>}
          </CardTitle>
          <CardDescription>
            Load is always met by grid + inverter together (load = grid +
            inverter). Positive grid = importing, negative = exporting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Site load
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                {loadKw === null ? "—" : `${formatValue(loadKw)} kW`}
              </p>
              <p className="text-xs text-slate-500">
                {loadKw === null
                  ? "Waiting for meter and inverter values"
                  : plannedLoadKw !== null
                    ? `Grid + inverter (planned ${formatValue(plannedLoadKw)} kW)`
                    : "Grid + inverter"}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                Inverter (solar)
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-900">
                {inverterKw === null ? "—" : `${formatValue(inverterKw)} kW`}
              </p>
              <p className="text-xs text-emerald-700">
                {liveDeratingPct !== null
                  ? `derating ${formatValue(liveDeratingPct)}%`
                  : "derating —"}
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                gridKw !== null && gridKw < 0
                  ? "border-rose-200 bg-rose-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <p className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                gridKw !== null && gridKw < 0 ? "text-rose-700" : "text-amber-700"
              }`}>
                Grid {gridDirection}
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                {gridKw === null
                  ? "—"
                  : `${formatValue(Math.abs(gridKw))} kW ${gridKw < 0 ? "export" : "import"}`}
              </p>
              <p className={`text-xs ${gridKw !== null && gridKw < 0 ? "text-rose-700" : "text-amber-700"}`}>
                {gridKw === null ? "Waiting for meter" : `target ${formatValue(configuration.targetGridKw ?? 0)} kW`}
              </p>
            </div>
          </div>

          {loadKw !== null && loadKw > 0 && (
            <div>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-emerald-500 transition-all duration-700"
                  style={{ width: `${(inverterShare * 100).toFixed(1)}%` }}
                  title={`Inverter ${(inverterShare * 100).toFixed(1)}%`}
                />
                <div
                  className="h-full bg-amber-400 transition-all duration-700"
                  style={{ width: `${(gridShare * 100).toFixed(1)}%` }}
                  title={`Grid ${(gridShare * 100).toFixed(1)}%`}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Inverter {(inverterShare * 100).toFixed(0)}%
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  Grid {(gridShare * 100).toFixed(0)}%
                </span>
                <span className="ml-auto">
                  {plannedLoadKw !== null
                    ? `Load ${formatValue(loadKw)} kW (planned ${formatValue(plannedLoadKw)} kW)`
                    : `Load ${formatValue(loadKw)} kW`}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Controller status
            <Badge className={running ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>
              {running ? "RUNNING" : "STOPPED"}
            </Badge>
            {status.simulation && <Badge variant="outline">Simulation</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <KeyValue label="Last grid power" value={status.lastGridKw === null || status.lastGridKw === undefined ? "—" : `${formatValue(status.lastGridKw)} kW`} />
          <KeyValue label="Derating" value={deratingPercent} />
          <KeyValue label="Last run" value={status.lastRunAt ? new Date(status.lastRunAt).toLocaleTimeString() : "—"} />
          <KeyValue label="Misses" value={status.consecutiveMisses ?? 0} />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Devices &amp; registers</CardTitle>
            <CardDescription>
              Meter supplies the grid reading; the inverter register receives
              the derating write.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Grid meter device" required>
              <Select
                value={form.meterDeviceId}
                onChange={(event) => set("meterDeviceId", event.target.value)}
                options={deviceOptions}
                placeholder="Select the grid meter device"
              />
            </Field>
            {!devicesSelected && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Select both the grid meter device and the inverter device to
                enable Save and Start.
              </p>
            )}
            <Field label="Meter register (grid power)" hint="Usually eqv_active_power (W).">
              <Select
                value={form.meterRegisterKey}
                onChange={(event) => set("meterRegisterKey", event.target.value)}
                options={registerOptions(meterDevice, devices, profiles)}
              />
            </Field>
            <Field label="Inverter device" required>
              <Select
                value={form.inverterDeviceId}
                onChange={(event) => set("inverterDeviceId", event.target.value)}
                options={deviceOptions}
                placeholder="Select the inverter device"
              />
            </Field>
            <Field label="Inverter derating register" hint="A writable holding register (e.g. active_power_derating @ 40125).">
              <Select
                value={form.inverterRegisterKey}
                onChange={(event) => set("inverterRegisterKey", event.target.value)}
                options={registerOptions(inverterDevice, devices, profiles)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Control settings</CardTitle>
            <CardDescription>
              Derating is expressed in register units: 0–1000 = 0–100%.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Target grid power (kW)" hint="0 = zero export; positive = allow import.">
              <Input
                type="number"
                step="0.1"
                value={form.targetGridKw}
                onChange={(event) => set("targetGridKw", event.target.value)}
              />
            </Field>
            <Field label="Deadband (kW)" hint="No write inside this band.">
              <Input
                type="number"
                step="0.1"
                min="0"
                value={form.deadbandKw}
                onChange={(event) => set("deadbandKw", event.target.value)}
              />
            </Field>
            <Field label="Step per cycle" hint="Derating units per write (20 = 2%).">
              <Input
                type="number"
                min="1"
                max="1000"
                value={form.stepPerCycle}
                onChange={(event) => set("stepPerCycle", event.target.value)}
              />
            </Field>
            <Field label="Cycle interval (ms)">
              <Input
                type="number"
                min="1000"
                max="60000"
                value={form.intervalMs}
                onChange={(event) => set("intervalMs", event.target.value)}
              />
            </Field>
            <Field label="Min derating" hint="0–1000 register units.">
              <Input
                type="number"
                min="0"
                max="1000"
                value={form.minDerating}
                onChange={(event) => set("minDerating", event.target.value)}
              />
            </Field>
            <Field label="Max derating" hint="1000 = full solar output.">
              <Input
                type="number"
                min="0"
                max="1000"
                value={form.maxDerating}
                onChange={(event) => set("maxDerating", event.target.value)}
              />
            </Field>
            <Field label="Failsafe derating" hint="Written after repeated stale meter readings (0 = off).">
              <Input
                type="number"
                min="0"
                max="1000"
                value={form.failsafeDerating}
                onChange={(event) => set("failsafeDerating", event.target.value)}
              />
            </Field>
            <Field label="Misses before failsafe">
              <Input
                type="number"
                min="1"
                max="50"
                value={form.failsafeAfterMisses}
                onChange={(event) => set("failsafeAfterMisses", event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Simulation mode</CardTitle>
          <CardDescription>
            Replace the meter reading with grid = load − inverter output so the
            loop can be tested end-to-end with the device simulators.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow
            label="Enable simulation"
            description="Meter register is ignored while enabled."
            checked={form.simulationEnabled}
            onCheckedChange={(enabled) => set("simulationEnabled", enabled)}
          />
          {form.simulationEnabled && (
            <div className="max-w-xs">
              <Field label="Planned site load (kW)" hint="Example: 100 kW load, inverter 70 kW → grid 30 kW.">
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.loadKw}
                  onChange={(event) => set("loadKw", event.target.value)}
                />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Recent control actions
            <Badge variant="outline">{data?.actions?.length || 0}</Badge>
          </CardTitle>
          <CardDescription>Process-local history; cleared on restart.</CardDescription>
        </CardHeader>
        <CardContent>
          {!data?.actions?.length ? (
            <EmptyState
              title="No actions yet"
              description="Start the controller; each cycle records its decision here."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2 text-right">Grid kW</th>
                    <th className="px-3 py-2 text-right">Target</th>
                    <th className="px-3 py-2 text-right">Derating</th>
                    <th className="px-3 py-2 text-right">Delta</th>
                    <th className="px-3 py-2">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.actions.map((action, index) => (
                    <tr key={`${action.at}-${index}`}>
                      <td className="px-3 py-1.5 text-xs text-slate-500">
                        {new Date(action.at).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{action.source}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatValue(action.gridKw)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatValue(action.targetGridKw)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {action.derating === null || action.derating === undefined ? "—" : `${(action.derating / 10).toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{action.delta ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="outline">{action.outcome}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
