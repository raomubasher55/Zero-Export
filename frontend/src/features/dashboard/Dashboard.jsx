import {
  Activity,
  AlertTriangle,
  Clock3,
  FileCog,
  Network,
  Server,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, StatusBadge } from "@/components/common/Feedback";
import { formatRelative } from "@/lib/formatters";

export function Dashboard({
  stats,
  devices,
  scheduler,
  onOpenDevice,
  onCreate,
}) {
  const recentDevices = [...devices]
    .sort(
      (left, right) =>
        new Date(right.lastCommunicationAt || 0) -
        new Date(left.lastCommunicationAt || 0),
    )
    .slice(0, 6);
  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">
            Live fleet visibility
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Energy operations at a glance
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Manage field connections, run decoded polls, and inspect durable
            telemetry from one workspace.
          </p>
        </div>
        <Button onClick={onCreate}>
          <CirclePlus className="h-4 w-4" />
          Add device
        </Button>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Network}
          label="Configured devices"
          value={stats.total}
          hint="All managed endpoints"
          color="indigo"
        />
        <MetricCard
          icon={Wifi}
          label="Online now"
          value={stats.online}
          hint={`${stats.total ? Math.round((stats.online / stats.total) * 100) : 0}% fleet availability`}
          color="emerald"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Needs attention"
          value={stats.alerting}
          hint="Offline, timeout, or error"
          color="amber"
        />
        <MetricCard
          icon={FileCog}
          label="Active profiles"
          value={stats.profiles}
          hint="Reusable decoding maps"
          color="blue"
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.8fr]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100 py-5">
            <div>
              <CardTitle>Recent device communication</CardTitle>
              <CardDescription>
                Latest status known by the Modbus core
              </CardDescription>
            </div>
            <Activity className="h-5 w-5 text-indigo-500" />
          </CardHeader>
          <CardContent className="p-0">
            {recentDevices.length === 0 ? (
              <EmptyState
                title="No devices yet"
                description="Create a device and assign an active register profile to begin collecting telemetry."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {recentDevices.map((device) => (
                  <button
                    key={device._id}
                    type="button"
                    onClick={() => onOpenDevice(device)}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600">
                      <Server className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {device.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {device.connection?.protocol} ·{" "}
                        {device.connection?.host ||
                          device.connection?.serialPath}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-xs text-slate-500">
                        {formatRelative(device.lastCommunicationAt)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {device.statistics?.successfulPolls || 0} successful
                        polls
                      </p>
                    </div>
                    <StatusBadge status={device.status} />
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-indigo-500" />
              Scheduler
            </CardTitle>
            <CardDescription>
              Local worker state and poll capacity
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <KeyValue
              label="Worker state"
              value={scheduler?.running ? "Running" : "Idle"}
              accent={
                scheduler?.running ? "text-emerald-600" : "text-slate-600"
              }
            />
            <KeyValue
              label="Active polls"
              value={`${scheduler?.activePolls ?? 0} / ${scheduler?.concurrency ?? "—"}`}
            />
            <KeyValue
              label="Tick interval"
              value={
                scheduler?.tickIntervalMs
                  ? `${scheduler.tickIntervalMs} ms`
                  : "—"
              }
            />
            <KeyValue
              label="Last cycle"
              value={formatRelative(scheduler?.lastCycleAt)}
            />
            {scheduler?.lastError && (
              <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs text-rose-700">
                {scheduler.lastError.message}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint, color }) {
  const colorClasses = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          </div>
          <div
            className={`grid h-10 w-10 place-items-center rounded-xl ${colorClasses[color]}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  );
}

function KeyValue({ label, value, accent = "" }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${accent}`}>{value}</span>
    </div>
  );
}
