import { CirclePlus, Pencil, Play, Plug, Trash2 } from "lucide-react";
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
  ActionIcon,
  EmptyState,
  StatusBadge,
} from "@/components/common/Feedback";
import { formatRelative } from "@/lib/formatters";

export function DevicesView({
  devices,
  profiles,
  search,
  onSearch,
  onCreate,
  onEdit,
  onDelete,
  onOpen,
  onConnect,
  onPoll,
}) {
  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">
            Field asset registry
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Devices</h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage TCP and RTU endpoints, assigned profiles, polling policy, and
            live operations.
          </p>
        </div>
        <Button onClick={onCreate}>
          <CirclePlus className="h-4 w-4" />
          Add device
        </Button>
      </section>
      <Card>
        <CardHeader className="gap-4 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Fleet</CardTitle>
            <CardDescription>{devices.length} matching devices</CardDescription>
          </div>
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search name, identifier, site, status…"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          {devices.length === 0 ? (
            <EmptyState
              title="No matching devices"
              description={
                profiles.length
                  ? "Add a device or adjust your search query."
                  : "Create an active register profile first, then add a device."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Device</th>
                    <th className="px-4 py-3 font-semibold">Transport</th>
                    <th className="px-4 py-3 font-semibold">Profile</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">
                      Last communication
                    </th>
                    <th className="px-5 py-3 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {devices.map((device) => (
                    <tr key={device._id} className="hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => onOpen(device)}
                          className="text-left"
                        >
                          <p className="font-semibold hover:text-indigo-600">
                            {device.name}
                          </p>
                          <p className="mt-0.5 font-mono text-xs text-slate-500">
                            {device.identifier} · unit {device.unitId}
                          </p>
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">
                          {device.connection?.protocol}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {device.connection?.host
                            ? `${device.connection.host}:${device.connection.port}`
                            : device.connection?.serialPath}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        {device.registerProfile?.name || (
                          <span className="text-amber-600">No profile</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge status={device.status} />
                      </td>
                      <td className="px-4 py-4">
                        <p>{formatRelative(device.lastCommunicationAt)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {device.statistics?.consecutiveFailures || 0}{" "}
                          consecutive failures
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          <ActionIcon
                            label="Connect"
                            onClick={() => {
                              void onConnect(device).catch(() => undefined);
                            }}
                          >
                            <Plug className="h-4 w-4" />
                          </ActionIcon>
                          <ActionIcon
                            label="Poll"
                            onClick={() => {
                              void onPoll(device).catch(() => undefined);
                            }}
                          >
                            <Play className="h-4 w-4" />
                          </ActionIcon>
                          <ActionIcon
                            label="Edit"
                            onClick={() => onEdit(device)}
                          >
                            <Pencil className="h-4 w-4" />
                          </ActionIcon>
                          <ActionIcon
                            label="Delete"
                            destructive
                            onClick={() => {
                              void onDelete(device).catch(() => undefined);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </ActionIcon>
                        </div>
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
