import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CirclePlus,
  FlaskConical,
  LoaderCircle,
  Play,
  Save,
  Square,
  ArrowRightLeft,
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
import { Field } from "@/components/common/FormControls";
import { api } from "@/lib/api";
import { formatValue } from "@/lib/formatters";

const GROUPS = ["Measurements", "Energy"];

export function SimulatorView({ devices, profiles, notify, onForwardProfile }) {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    host: "0.0.0.0",
    port: "15020",
    unitId: "1",
    updateIntervalMs: "1000",
  });
  const [values, setValues] = useState([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.getSimulator();
      setStatus(response.data);
      setForm((current) => ({
        host: response.data.host ?? current.host,
        port: String(response.data.port ?? current.port),
        unitId: String(response.data.unitId ?? current.unitId),
        updateIntervalMs: String(
          response.data.updateIntervalMs ?? current.updateIntervalMs,
        ),
      }));
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
        const response = await api.getSimulatorValues();
        setValues(response.data || []);
      } catch {
        // The simulator may be stopped; the status card shows the state.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const em500Profile = useMemo(
    () =>
      profiles.find(
        (profile) =>
          profile.identifier === "em500" || profile.builtIn === true,
      ),
    [profiles],
  );

  const simulatorDevice = useMemo(
    () => devices.find((device) => device.identifier === "em500-simulator"),
    [devices],
  );

  const run = async (operation, successMessage) => {
    setWorking(true);
    setError("");
    try {
      const response = await operation();
      setStatus(response.data);
      notify(successMessage);
    } catch (operationError) {
      setError(operationError?.message || "Simulator operation failed.");
      notify(operationError?.message || "Simulator operation failed.", "error");
    } finally {
      setWorking(false);
    }
  };

  const save = () =>
    run(
      () =>
        api.updateSimulator({
          host: form.host.trim(),
          port: Number(form.port),
          unitId: Number(form.unitId),
          updateIntervalMs: Number(form.updateIntervalMs),
        }),
      "Simulator settings saved.",
    );

  const start = () => run(() => api.startSimulator(), "Meter simulator started.");
  const stop = () => run(() => api.stopSimulator(), "Meter simulator stopped.");

  const addSimulatorDevice = async () => {
    if (!em500Profile) {
      notify(
        "Restore the built-in EM500 profile before creating a simulator device.",
        "error",
      );
      return;
    }
    if (simulatorDevice) {
      notify("A simulator device already exists; open it from the Devices page.");
      return;
    }
    try {
      await api.createDevice({
        identifier: "em500-simulator",
        name: "EM500 Simulator",
        site: "Simulator",
        unitId: Number(form.unitId),
        connection: {
          protocol: "TCP",
          host: "127.0.0.1",
          port: Number(form.port),
        },
        registerProfileId: em500Profile._id,
        polling: { enabled: true, intervalMs: 5000, jitterMs: 1000 },
        reconnect: { timeoutMs: 2000, retries: 1, retryDelayMs: 200 },
        tags: ["simulator"],
      });
      notify("Simulator device created and polling started.");
    } catch (createError) {
      notify(createError?.message || "Unable to create the simulator device.", "error");
    }
  };

  const forward = async () => {
    if (!em500Profile) {
      notify(
        "Restore the built-in EM500 profile before forwarding it.",
        "error",
      );
      return;
    }
    await onForwardProfile(em500Profile);
  };

  const running = status?.state === "RUNNING";
  const valuesByGroup = (group) =>
    values.filter((value) => value.group === group);

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">
            Test without a meter
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            EM500 meter simulator
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            A process-local Modbus TCP slave that serves the Eastron EM500
            register map with live simulated values — same addresses, same raw
            format as the physical meter. Poll it, forward it, or analyze its
            traffic exactly like a real device.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={addSimulatorDevice} disabled={working}>
            <CirclePlus className="h-4 w-4" /> Add simulator device
          </Button>
          <Button
            variant="outline"
            onClick={forward}
            disabled={working || !simulatorDevice}
            title={
              simulatorDevice
                ? "Add the simulated meter's registers to the forwarding gateway."
                : "Create the simulator device first."
            }
          >
            <ArrowRightLeft className="h-4 w-4" /> Forward EM500 profile
          </Button>
          <Button variant="outline" onClick={save} disabled={working}>
            <Save className="h-4 w-4" /> Save
          </Button>
          {running ? (
            <Button variant="destructive" onClick={stop} disabled={working}>
              {working ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop
            </Button>
          ) : (
            <Button onClick={start} disabled={working}>
              {working ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start
            </Button>
          )}
        </div>
      </section>

      <ErrorBanner message={error} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Simulator status</CardTitle>
            <CardDescription>
              The slave endpoint a test device should connect to.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={running ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>
                {status?.state || "STOPPED"}
              </Badge>
              <span className="font-mono">
                {status?.host || "0.0.0.0"}:{status?.port ?? 15020}
              </span>
              <span>·</span>
              <span>Unit {status?.unitId ?? 1}</span>
              <span>·</span>
              <span>{status?.deviceType || "EM500"}</span>
            </div>
            <KeyValue label="Registers served" value={status?.servedRegisterCount ?? 0} />
            <KeyValue label="Update interval" value={`${status?.updateIntervalMs ?? 1000} ms`} />
            <KeyValue label="Ticks" value={status?.tickCount ?? 0} />
            <KeyValue label="Last request" value={status?.lastRequestAt ? new Date(status.lastRequestAt).toLocaleTimeString() : "—"} />
            <KeyValue label="Last tick" value={status?.lastTickAt ? new Date(status.lastTickAt).toLocaleTimeString() : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Endpoint settings</CardTitle>
            <CardDescription>
              Changes restart the simulator when it is running.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Listen address">
              <Input
                value={form.host}
                onChange={(event) =>
                  setForm((current) => ({ ...current, host: event.target.value }))
                }
              />
            </Field>
            <Field label="TCP port">
              <Input
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={(event) =>
                  setForm((current) => ({ ...current, port: event.target.value }))
                }
              />
            </Field>
            <Field label="Unit ID" hint="The test device must request this unit ID.">
              <Input
                type="number"
                min="1"
                max="247"
                value={form.unitId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, unitId: event.target.value }))
                }
              />
            </Field>
            <Field label="Update interval (ms)" hint="How often simulated values change.">
              <Input
                type="number"
                min="250"
                max="60000"
                value={form.updateIntervalMs}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    updateIntervalMs: event.target.value,
                  }))
                }
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Simulated values
            <Badge variant="outline">{values.length}</Badge>
          </CardTitle>
          <CardDescription>
            Live snapshot of what the simulator serves; refreshes every three
            seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {values.length === 0 ? (
            <EmptyState
              title="No values yet"
              description="Start the simulator to generate values."
            />
          ) : (
            GROUPS.map((group) => {
              const groupValues = valuesByGroup(group);
              if (groupValues.length === 0) return null;
              return (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {group}
                  </h3>
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
                        {groupValues.map((value) => (
                          <tr key={value.registerKey}>
                            <td className="px-3 py-1.5">
                              <span className="font-medium">{value.registerName}</span>
                              <span className="ml-2 font-mono text-xs text-slate-400">
                                {value.registerKey}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                              0x{value.address.toString(16).toUpperCase().padStart(4, "0")}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {formatValue(value.value)}{" "}
                              <span className="text-xs text-slate-400">
                                {value.unit || ""}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                              {value.rawValues?.join(", ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
