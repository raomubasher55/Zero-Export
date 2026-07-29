import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Play,
  Plug,
  Power,
  RefreshCw,
  Send,
  Settings2,
  Terminal,
  Wifi,
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
import {
  EmptyState,
  InlineLoader,
  KeyValue,
  StatusBadge,
} from "@/components/common/Feedback";
import { Select } from "@/components/common/FormControls";
import { OUTCOME_STYLES, REGISTER_TYPES } from "@/constants/modbus";
import { api } from "@/lib/api";
import {
  formatCountdown,
  formatDate,
  formatRelative,
  formatValue,
  getErrorMessage,
} from "@/lib/formatters";

export function DeviceMonitor({ device, scheduler, onBack, onRefresh, notify }) {
  const [connection, setConnection] = useState(null);
  const [values, setValues] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const results = await Promise.allSettled([
      api.getConnection(device._id),
      api.listLatestValues(device._id, { limit: 100 }),
      api.listCommunicationLogs(device._id, { limit: 12 }),
    ]);
    if (results[0].status === "fulfilled") setConnection(results[0].value.data);
    if (results[1].status === "fulfilled")
      setValues(results[1].value.data || []);
    if (results[2].status === "fulfilled") setLogs(results[2].value.data || []);
    const rejected = results.find((result) => result.status === "rejected");
    setError(rejected ? getErrorMessage(rejected.reason) : "");
    if (!silent) setLoading(false);
  }, [device._id]);

  useEffect(() => {
    load();
  }, [load]);

  const liveRefreshMs = Math.min(
    10000,
    Math.max(3000, Number(device.polling?.intervalMs) || 5000),
  );

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await api.listLatestValues(device._id, { limit: 100 });
        setValues(response.data || []);
        setError("");
      } catch (refreshError) {
        setError(getErrorMessage(refreshError));
      }
    }, liveRefreshMs);
    return () => clearInterval(interval);
  }, [device._id, liveRefreshMs]);

  const autoPollingActive = Boolean(
    scheduler?.running &&
      device.isEnabled &&
      device.polling?.enabled &&
      device.registerProfile,
  );

  const execute = async (operation, success) => {
    setWorking(true);
    try {
      const result = await operation();
      notify(success);
      await Promise.all([load(), onRefresh()]);
      return result;
    } catch (actionError) {
      notify(getErrorMessage(actionError), "error");
      return null;
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to devices
      </button>
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{device.name}</h2>
            <StatusBadge status={device.status} />
          </div>
          <p className="mt-2 font-mono text-sm text-slate-500">
            {device.identifier} · unit {device.unitId} ·{" "}
            {device.connection?.protocol}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge
              variant="outline"
              className={
                autoPollingActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }
            >
              Auto polling {autoPollingActive ? "RUNNING" : "STOPPED"}
            </Badge>
            <span className="text-slate-500">
              Every {Math.round((device.polling?.intervalMs || 0) / 1000)}s · last {formatRelative(device.lastPollAt)} · next {formatCountdown(device.nextPollAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              execute(
                () => api.connectDevice(device._id),
                "Connection established.",
              )
            }
            disabled={working}
          >
            <Plug className="h-4 w-4" />
            Connect
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              execute(
                () => api.disconnectDevice(device._id),
                "Connection released.",
              )
            }
            disabled={working}
          >
            <Power className="h-4 w-4" />
            Disconnect
          </Button>
          <Button
            onClick={() =>
              execute(
                () => api.pollDevice(device._id),
                "Decoded poll completed.",
              )
            }
            disabled={working}
          >
            <Play className="h-4 w-4" />
            Poll now
          </Button>
        </div>
      </section>
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">
                Latest decoded values
                <Badge variant="outline">{values.length}</Badge>
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700" variant="outline">
                  Live · {liveRefreshMs / 1000}s
                </Badge>
              </CardTitle>
              <CardDescription>
                Current persisted values from the assigned profile
              </CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <InlineLoader />
            ) : values.length === 0 ? (
              <EmptyState
                title="No decoded values yet"
                description="Run a successful poll after assigning an active register profile."
              />
            ) : (
              <div
                className="data-scroll-region max-h-[65vh] overflow-auto overscroll-contain [scrollbar-gutter:stable] sm:max-h-[34rem]"
                role="region"
                aria-label="Scrollable latest decoded values"
                tabIndex={0}
              >
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th className="px-5 py-3">Register</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3">Raw</th>
                      <th className="px-4 py-3">Sampled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {values.map((value) => (
                      <tr key={value._id}>
                        <td className="px-5 py-3">
                          <p className="font-semibold">{value.registerName}</p>
                          <p className="font-mono text-xs text-slate-500">
                            {value.registerKey} · {value.dataType}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums">
                          {formatValue(value.value)}{" "}
                          <span className="text-xs font-normal text-slate-500">
                            {value.unit}
                          </span>
                        </td>
                        <td className="max-w-72 break-words px-4 py-3 text-xs text-slate-600">
                          {Array.isArray(value.rawValues)
                            ? value.rawValues.join(", ")
                            : String(value.rawValue)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatRelative(value.sampledAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <ConnectionCard connection={connection} device={device} />
          <RawOperations device={device} execute={execute} />
        </div>
      </div>
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Terminal className="h-5 w-5 text-indigo-500" />
            Communication history
            <Badge variant="outline">{logs.length}</Badge>
          </CardTitle>
          <CardDescription>
            Retained Modbus operation metadata and poll outcomes
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <EmptyState
              title="No communication logs"
              description="Logs appear after polling or running Modbus actions."
            />
          ) : (
            <div
              className="data-scroll-region max-h-[60vh] divide-y divide-slate-100 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] sm:max-h-[30rem]"
              role="region"
              aria-label="Scrollable communication history"
              tabIndex={0}
            >
              {logs.map((log) => (
                <div
                  key={log._id}
                  className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-28">
                    <Badge
                      variant="outline"
                      className={
                        OUTCOME_STYLES[log.outcome] ||
                        "bg-slate-50 text-slate-600"
                      }
                    >
                      {log.outcome}
                    </Badge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {log.operation}{" "}
                      <span className="font-normal text-slate-500">
                        via {log.source}
                      </span>
                    </p>
                    <p className="mt-0.5 break-words text-xs text-slate-500">
                      {log.request?.batchCount || 0} batches ·{" "}
                      {log.request?.registerCount || 0} registers ·{" "}
                      {log.durationMs ?? "—"} ms
                      {log.error?.message ? ` · ${log.error.message}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-500">
                    {formatDate(log.timestamp)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectionCard({ connection, device }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-indigo-500" />
          Connection
        </CardTitle>
        <CardDescription>Process-local Modbus pool state</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <KeyValue
          label="State"
          value={connection?.state || "DISCONNECTED"}
          accent={connection?.connected ? "text-emerald-600" : "text-slate-600"}
        />
        <KeyValue
          label="Endpoint"
          value={
            connection?.endpoint?.host
              ? `${connection.endpoint.host}:${connection.endpoint.port}`
              : connection?.endpoint?.serialPath ||
                device.connection?.host ||
                device.connection?.serialPath ||
                "—"
          }
        />
        <KeyValue
          label="Pool clients"
          value={connection?.attachedDeviceCount ?? 0}
        />
        <KeyValue
          label="Pending operations"
          value={connection?.pendingOperations ?? 0}
        />
        <KeyValue
          label="Last connected"
          value={formatRelative(connection?.lastConnectedAt)}
        />
      </CardContent>
    </Card>
  );
}

function RawOperations({ device, execute }) {
  const [readType, setReadType] = useState("INPUT_REGISTER");
  const [readAddress, setReadAddress] = useState("0");
  const [readQuantity, setReadQuantity] = useState("1");
  const [writeType, setWriteType] = useState("HOLDING_REGISTER");
  const [writeAddress, setWriteAddress] = useState("0");
  const [writeValues, setWriteValues] = useState("0");
  const [result, setResult] = useState(null);

  const read = async () => {
    const response = await execute(
      () =>
        api.rawRead(device._id, {
          registerType: readType,
          address: Number(readAddress),
          quantity: Number(readQuantity),
        }),
      "Raw read completed.",
    );
    if (response) setResult(response.data);
  };
  const write = async () => {
    const values =
      writeType === "COIL"
        ? writeValues
            .split(",")
            .map((value) => value.trim().toLowerCase() === "true")
        : writeValues.split(",").map((value) => Number(value.trim()));
    const response = await execute(
      () =>
        api.rawWrite(device._id, {
          registerType: writeType,
          address: Number(writeAddress),
          values,
        }),
      "Raw write completed.",
    );
    if (response) setResult(response.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-indigo-500" />
          Raw Modbus tools
        </CardTitle>
        <CardDescription>
          Use with care; profile polling is preferred.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Read
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={readType}
              onChange={(event) => setReadType(event.target.value)}
              options={REGISTER_TYPES}
            />
            <Input
              value={readAddress}
              onChange={(event) => setReadAddress(event.target.value)}
              type="number"
              min="0"
              placeholder="Address"
            />
            <Input
              value={readQuantity}
              onChange={(event) => setReadQuantity(event.target.value)}
              type="number"
              min="1"
              placeholder="Quantity"
            />
            <Button size="sm" onClick={read}>
              <Send className="h-3.5 w-3.5" />
              Read
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Write
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={writeType}
              onChange={(event) => setWriteType(event.target.value)}
              options={["HOLDING_REGISTER", "COIL"]}
            />
            <Input
              value={writeAddress}
              onChange={(event) => setWriteAddress(event.target.value)}
              type="number"
              min="0"
              placeholder="Address"
            />
            <Input
              className="col-span-2"
              value={writeValues}
              onChange={(event) => setWriteValues(event.target.value)}
              placeholder={writeType === "COIL" ? "true, false" : "0, 65535"}
            />
            <Button
              className="col-span-2"
              size="sm"
              variant="outline"
              onClick={write}
            >
              <Send className="h-3.5 w-3.5" />
              Write values
            </Button>
          </div>
        </div>
        {result && (
          <pre className="max-h-32 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-emerald-300">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
