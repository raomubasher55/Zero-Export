import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Pause,
  Play,
  RefreshCw,
  Server,
  Thermometer,
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
import { ErrorBanner, InlineLoader, KeyValue } from "@/components/common/Feedback";
import { api } from "@/lib/api";
import { formatDate, formatValue, getErrorMessage } from "@/lib/formatters";

function formatBytes(bytes, digits = 1) {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return "—";
  const value = Number(bytes);
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(value)) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : digits)} ${units[index]}`;
}

function formatRate(bytesPerSecond) {
  return bytesPerSecond === null || bytesPerSecond === undefined
    ? "Warming up…"
    : `${formatBytes(bytesPerSecond)}/s`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return "—";
  let remaining = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function usageColor(percent) {
  if (percent === null || percent === undefined) return "bg-slate-300";
  if (percent >= 90) return "bg-rose-500";
  if (percent >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

function statusStyles(status) {
  if (status === "CRITICAL") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "WARNING") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export function SystemUsageView() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await api.getSystemUsage();
      setSnapshot(response.data);
      setError("");
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load({ initial: true });
  }, [load]);

  useEffect(() => {
    if (paused) return undefined;
    const interval = setInterval(() => load(), 3000);
    return () => clearInterval(interval);
  }, [load, paused]);

  const rootFilesystem = useMemo(
    () => snapshot?.filesystems?.find((filesystem) => filesystem.mountPoint === "/") || snapshot?.filesystems?.[0],
    [snapshot?.filesystems],
  );
  const networkRate = useMemo(
    () =>
      (snapshot?.network || []).reduce(
        (totals, item) => ({
          receive: totals.receive + (item.receiveBytesPerSecond || 0),
          transmit: totals.transmit + (item.transmitBytesPerSecond || 0),
          measured:
            totals.measured ||
            item.receiveBytesPerSecond !== null ||
            item.transmitBytesPerSecond !== null,
        }),
        { receive: 0, transmit: 0, measured: false },
      ),
    [snapshot?.network],
  );

  if (loading && !snapshot) return <InlineLoader />;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Server className="h-4 w-4" /> Orange Pi host diagnostics
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Computer usage and board information
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Live CPU, memory, temperature, storage, network, operating-system, and backend-process
            information reported directly by {snapshot?.identity?.boardModel || snapshot?.identity?.hostname || "this computer"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={statusStyles(snapshot?.status)}>
            {snapshot?.status === "HEALTHY" ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
            {snapshot?.status || "UNKNOWN"}
          </Badge>
          <Button variant="outline" onClick={() => setPaused((current) => !current)}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Resume live view" : "Pause live view"}
          </Button>
          <Button variant="outline" onClick={() => load()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </section>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        These values are sampled live and are not stored in MongoDB. CPU and network rates need two
        samples, so they may display “Warming up” immediately after backend startup.
      </div>
      <ErrorBanner message={error} />
      <Warnings warnings={snapshot?.warnings || []} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          icon={Cpu}
          label="CPU usage"
          value={snapshot?.cpu?.utilizationPercent === null ? "Warming up…" : `${snapshot?.cpu?.utilizationPercent ?? "—"}%`}
          percent={snapshot?.cpu?.utilizationPercent}
          detail={`${snapshot?.cpu?.logicalCoreCount || 0} logical cores`}
        />
        <MetricCard
          icon={MemoryStick}
          label="Memory usage"
          value={`${snapshot?.memory?.usedPercent ?? "—"}%`}
          percent={snapshot?.memory?.usedPercent}
          detail={`${formatBytes(snapshot?.memory?.usedBytes)} / ${formatBytes(snapshot?.memory?.totalBytes)}`}
        />
        <MetricCard
          icon={Thermometer}
          label="Maximum temperature"
          value={snapshot?.thermal?.maximumCelsius === null ? "Unavailable" : `${snapshot?.thermal?.maximumCelsius ?? "—"} °C`}
          percent={snapshot?.thermal?.maximumCelsius === null ? null : Math.min(100, snapshot?.thermal?.maximumCelsius)}
          detail={`${snapshot?.thermal?.zones?.length || 0} thermal zones`}
        />
        <MetricCard
          icon={HardDrive}
          label="Root storage"
          value={rootFilesystem ? `${rootFilesystem.usedPercent}%` : "Unavailable"}
          percent={rootFilesystem?.usedPercent}
          detail={rootFilesystem ? `${formatBytes(rootFilesystem.availableBytes)} available` : "statfs unavailable"}
        />
        <MetricCard
          icon={Clock3}
          label="System uptime"
          value={formatDuration(snapshot?.uptime?.seconds)}
          detail={`Booted ${snapshot?.uptime?.bootedAt ? formatDate(snapshot.uptime.bootedAt) : "—"}`}
        />
        <MetricCard
          icon={Network}
          label="Network throughput"
          value={networkRate.measured ? `↓ ${formatRate(networkRate.receive)}` : "Warming up…"}
          detail={networkRate.measured ? `↑ ${formatRate(networkRate.transmit)}` : "Waiting for second sample"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <IdentityCard identity={snapshot?.identity} uptime={snapshot?.uptime} sampledAt={snapshot?.sampledAt} />
        <CpuCard cpu={snapshot?.cpu} />
        <MemoryCard memory={snapshot?.memory} />
        <ThermalCard thermal={snapshot?.thermal} />
      </div>

      <FilesystemsCard filesystems={snapshot?.filesystems || []} />
      <NetworkCard interfaces={snapshot?.network || []} />
      <ProcessCard processUsage={snapshot?.process} />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, percent }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <Icon className="h-4 w-4 text-indigo-500" />
        </div>
        <p className="mt-3 truncate text-xl font-bold tabular-nums" title={String(value)}>{value}</p>
        <p className="mt-1 truncate text-xs text-slate-500" title={detail}>{detail}</p>
        {percent !== undefined && percent !== null && (
          <UsageBar percent={percent} className="mt-3" />
        )}
      </CardContent>
    </Card>
  );
}

function UsageBar({ percent, className = "" }) {
  const bounded = Math.min(100, Math.max(0, Number(percent) || 0));
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className={`h-full rounded-full transition-all ${usageColor(bounded)}`} style={{ width: `${bounded}%` }} />
    </div>
  );
}

function Warnings({ warnings }) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <CheckCircle2 className="h-5 w-5" /> No resource threshold warnings detected.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {warnings.map((warning, index) => (
        <div
          key={`${warning.code}-${index}`}
          className={`flex items-center gap-3 rounded-xl border p-4 text-sm ${warning.severity === "CRITICAL" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div><strong>{warning.severity}:</strong> {warning.message}</div>
        </div>
      ))}
    </div>
  );
}

function IdentityCard({ identity, uptime, sampledAt }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5 text-indigo-500" /> Board and operating system</CardTitle>
        <CardDescription>Static identity reported by Linux, Node.js, and the device tree.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <KeyValue label="Board model" value={identity?.boardModel || "Unavailable"} />
        <KeyValue label="Hostname" value={identity?.hostname || "—"} />
        <KeyValue label="Operating system" value={identity?.operatingSystem || "—"} />
        <KeyValue label="Kernel" value={`${identity?.kernelType || ""} ${identity?.kernelRelease || ""}`.trim() || "—"} />
        <KeyValue label="Architecture" value={identity?.architecture || "—"} />
        <KeyValue label="Processor" value={identity?.processorModel || identity?.hardware || "—"} />
        <KeyValue label="Board revision" value={identity?.revision || "Unavailable"} />
        <KeyValue label="Node.js" value={identity?.nodeVersion || "—"} />
        <KeyValue label="System boot" value={uptime?.bootedAt ? formatDate(uptime.bootedAt) : "—"} />
        <KeyValue label="Last sample" value={sampledAt ? formatDate(sampledAt) : "—"} />
      </CardContent>
    </Card>
  );
}

function CpuCard({ cpu }) {
  const frequencies = cpu?.frequencies;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5 text-indigo-500" /> CPU and load</CardTitle>
        <CardDescription>Per-core utilization is calculated between live API samples.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SmallStat label="CPU" value={cpu?.utilizationPercent === null ? "Warming" : `${cpu?.utilizationPercent ?? "—"}%`} />
          <SmallStat label="Load 1m" value={cpu?.loadAverage?.oneMinute ?? "—"} />
          <SmallStat label="Load 5m" value={cpu?.loadAverage?.fiveMinutes ?? "—"} />
          <SmallStat label="Load 15m" value={cpu?.loadAverage?.fifteenMinutes ?? "—"} />
          <SmallStat label="Frequency" value={frequencies?.averageCurrentMHz ? `${frequencies.averageCurrentMHz} MHz` : "Unavailable"} />
        </div>
        <div className="space-y-3">
          {(cpu?.cores || []).map((core) => {
            const frequency = frequencies?.cores?.find((item) => item.core === core.index);
            return (
              <div key={core.index}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold">CPU {core.index}</span>
                  <span className="text-slate-500">
                    {core.utilizationPercent === null ? "Warming up" : `${core.utilizationPercent}%`}
                    {frequency?.currentMHz
                      ? ` · ${frequency.currentMHz} MHz (${frequency.minimumMHz ?? "?"}–${frequency.maximumMHz ?? "?"}) · ${frequency.governor || "governor unknown"}`
                      : ` · ${core.reportedSpeedMHz} MHz reported`}
                  </span>
                </div>
                <UsageBar percent={core.utilizationPercent || 0} />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          Load per logical core: {cpu?.loadAverage?.oneMinutePerCore ?? "—"}. Linux load includes runnable and uninterruptible tasks and is not the same as CPU percentage.
        </p>
      </CardContent>
    </Card>
  );
}

function MemoryCard({ memory }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MemoryStick className="h-5 w-5 text-indigo-500" /> Memory</CardTitle>
        <CardDescription>Linux MemAvailable is used when `/proc/meminfo` is available.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UsageBar percent={memory?.usedPercent || 0} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SmallStat label="Total" value={formatBytes(memory?.totalBytes)} />
          <SmallStat label="Used" value={formatBytes(memory?.usedBytes)} />
          <SmallStat label="Available" value={formatBytes(memory?.availableBytes)} />
          <SmallStat label="Free" value={formatBytes(memory?.freeBytes)} />
          <SmallStat label="Cache" value={formatBytes(memory?.cachedBytes)} />
          <SmallStat label="Buffers" value={formatBytes(memory?.buffersBytes)} />
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Swap</span>
            <span>{memory?.swap?.totalBytes ? `${memory.swap.usedPercent}%` : "Not configured"}</span>
          </div>
          {memory?.swap?.totalBytes > 0 && <UsageBar percent={memory.swap.usedPercent} className="mt-2" />}
          <p className="mt-2 text-xs text-slate-500">
            {formatBytes(memory?.swap?.usedBytes)} used of {formatBytes(memory?.swap?.totalBytes)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ThermalCard({ thermal }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Thermometer className="h-5 w-5 text-indigo-500" /> Temperature sensors</CardTitle>
        <CardDescription>Linux thermal zones exposed by the Orange Pi kernel.</CardDescription>
      </CardHeader>
      <CardContent>
        {!thermal?.available ? (
          <Unavailable message="No `/sys/class/thermal` sensor values are available on this host." />
        ) : (
          <div className="space-y-3">
            {thermal.zones.map((zone) => (
              <div key={zone.zone} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{zone.type}</p>
                    <p className="font-mono text-xs text-slate-500">{zone.zone}</p>
                  </div>
                  <p className="text-xl font-bold tabular-nums">{zone.temperatureCelsius} °C</p>
                </div>
                <UsageBar percent={Math.min(100, zone.temperatureCelsius)} className="mt-3" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FilesystemsCard({ filesystems }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5 text-indigo-500" /> Storage and mounted filesystems</CardTitle>
        <CardDescription>Root, boot, removable media, and explicitly mounted storage.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {filesystems.length === 0 ? <Unavailable message="Filesystem statistics are unavailable." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Mount</th><th className="px-4 py-3">Device / type</th><th className="px-4 py-3">Used</th><th className="px-4 py-3">Available</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Usage</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filesystems.map((filesystem) => (
                  <tr key={filesystem.mountPoint}>
                    <td className="px-5 py-3 font-mono font-semibold">{filesystem.mountPoint}</td>
                    <td className="px-4 py-3"><p className="font-mono text-xs">{filesystem.device || "virtual/root"}</p><p className="text-xs text-slate-500">{filesystem.type || "unknown type"}</p></td>
                    <td className="px-4 py-3 tabular-nums">{formatBytes(filesystem.usedBytes)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatBytes(filesystem.availableBytes)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatBytes(filesystem.totalBytes)}</td>
                    <td className="w-48 px-4 py-3"><div className="flex items-center gap-3"><UsageBar percent={filesystem.usedPercent} className="flex-1" /><span className="w-12 text-right font-semibold">{filesystem.usedPercent}%</span></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NetworkCard({ interfaces }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5 text-indigo-500" /> Network interfaces</CardTitle>
        <CardDescription>Addresses, link state, negotiated speed, counters, and live throughput.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        {interfaces.length === 0 ? <Unavailable message="No network interfaces were reported." /> : interfaces.map((item) => (
          <div key={item.name} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-indigo-500" />
                <p className="font-mono font-semibold">{item.name}</p>
              </div>
              <Badge className={item.state === "up" ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>{item.state}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SmallStat label="Receive rate" value={`↓ ${formatRate(item.receiveBytesPerSecond)}`} />
              <SmallStat label="Transmit rate" value={`↑ ${formatRate(item.transmitBytesPerSecond)}`} />
              <SmallStat label="Received total" value={formatBytes(item.receivedBytes)} />
              <SmallStat label="Transmitted total" value={formatBytes(item.transmittedBytes)} />
            </div>
            <p className="mt-3 text-xs text-slate-500">Link speed: {item.speedMbps && item.speedMbps > 0 ? `${item.speedMbps} Mbps` : "Unavailable"}</p>
            <div className="mt-3 space-y-2">
              {item.addresses.map((address, index) => (
                <div key={`${address.address}-${index}`} className="rounded-md bg-slate-50 p-2 font-mono text-xs">
                  <p>{address.family}: {address.cidr || address.address}</p>
                  <p className="mt-1 text-slate-500">MAC {address.mac || "—"}{address.internal ? " · internal" : ""}</p>
                </div>
              ))}
              {item.addresses.length === 0 && <p className="text-xs text-slate-500">No IP address assigned.</p>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProcessCard({ processUsage }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-indigo-500" /> Zero Export backend process</CardTitle>
        <CardDescription>Resource consumption of this Node.js API and Modbus gateway process.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <SmallStat label="PID" value={processUsage?.pid ?? "—"} />
          <SmallStat label="Process uptime" value={formatDuration(processUsage?.uptimeSeconds)} />
          <SmallStat label="CPU" value={processUsage?.cpuPercent === null ? "Warming" : `${processUsage?.cpuPercent ?? "—"}%`} />
          <SmallStat label="Resident memory" value={formatBytes(processUsage?.residentSetBytes)} />
          <SmallStat label="Heap used" value={formatBytes(processUsage?.heapUsedBytes)} />
          <SmallStat label="Heap total" value={formatBytes(processUsage?.heapTotalBytes)} />
          <SmallStat label="Heap limit" value={formatBytes(processUsage?.heapLimitBytes)} />
          <SmallStat label="External memory" value={formatBytes(processUsage?.externalBytes)} />
          <SmallStat label="Array buffers" value={formatBytes(processUsage?.arrayBuffersBytes)} />
          <SmallStat label="Node.js" value={processUsage?.nodeVersion || "—"} />
          <SmallStat label="Environment" value={processUsage?.environment || "—"} />
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs"><span>V8 heap limit usage</span><span>{processUsage?.heapLimitUsedPercent ?? "—"}%</span></div>
          <UsageBar percent={processUsage?.heapLimitUsedPercent || 0} />
        </div>
      </CardContent>
    </Card>
  );
}

function SmallStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums" title={String(value)}>{formatValue(value)}</p>
    </div>
  );
}

function Unavailable({ message }) {
  return (
    <div className="grid min-h-32 place-items-center p-6 text-center text-sm text-slate-500">
      <Gauge className="mb-2 h-6 w-6 text-slate-300" />
      {message}
    </div>
  );
}
