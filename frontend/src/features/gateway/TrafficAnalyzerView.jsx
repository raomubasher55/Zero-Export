import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Download,
  Eye,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, InlineLoader } from "@/components/common/Feedback";
import { Field, Select } from "@/components/common/FormControls";
import { api } from "@/lib/api";
import { formatDate, formatValue, getErrorMessage } from "@/lib/formatters";

const EMPTY_ANALYSIS = {
  summary: {},
  patterns: [],
  mappingSuggestions: [],
  addressRanges: [],
  functionCodes: [],
  clients: [],
  sessions: [],
  recentSequence: [],
};

function clientLabel(event) {
  if (event.transport === "TCP") {
    return event.client?.address
      ? `${event.client.address}:${event.client.port ?? "?"}`
      : "TCP client";
  }
  return event.serialPath || "RTU line";
}

function statusClass(event) {
  if (event.success) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (event.success === null) return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function TrafficAnalyzerView({ notify }) {
  const [traffic, setTraffic] = useState({ events: [], settings: null, pendingRequests: 0 });
  const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
  const [selectedId, setSelectedId] = useState(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    transport: "",
    functionCode: "",
    operation: "",
    address: "",
    client: "",
  });
  const [wordOffset, setWordOffset] = useState("0");
  const [wordCount, setWordCount] = useState("2");
  const [scaleFactor, setScaleFactor] = useState("1");
  const [offset, setOffset] = useState("0");
  const [interpretation, setInterpretation] = useState(null);

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    try {
      const query = {
        limit: 250,
        transport: filters.transport || undefined,
        functionCode: filters.functionCode || undefined,
        operation: filters.operation || undefined,
        address: filters.address || undefined,
        client: filters.client || undefined,
      };
      const trafficResponse = await api.listGatewayTraffic(query);
      setTraffic(trafficResponse.data);
      setAnalysis(trafficResponse.data.analysis || EMPTY_ANALYSIS);
      setError("");
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      if (initial) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load({ initial: true });
  }, [load]);

  useEffect(() => {
    if (paused) return undefined;
    const interval = setInterval(() => load(), 2500);
    return () => clearInterval(interval);
  }, [load, paused]);

  const selected = useMemo(
    () => traffic.events.find((event) => event.id === selectedId) || null,
    [selectedId, traffic.events],
  );

  useEffect(() => {
    setInterpretation(null);
    setWordOffset("0");
    setWordCount("2");
  }, [selectedId]);

  const capturedWords = useMemo(() => {
    if (!selected || ![3, 4, 6, 16].includes(selected.functionCode)) return [];
    if (selected.operation === "WRITE") return selected.requestValues || [];
    return selected.responseValues || [];
  }, [selected]);

  useEffect(() => {
    setWordCount(String(Math.min(2, Math.max(1, capturedWords.length))));
  }, [capturedWords.length, selectedId]);

  const interpretationWords = useMemo(() => {
    const start = Math.max(0, Number(wordOffset) || 0);
    const count = Math.max(1, Number(wordCount) || 1);
    return capturedWords.slice(start, start + count);
  }, [capturedWords, wordCount, wordOffset]);

  useEffect(() => {
    setInterpretation(null);
  }, [offset, scaleFactor, wordCount, wordOffset]);

  const setCapture = async (enabled) => {
    setWorking(true);
    try {
      const response = await api.updateGatewayTrafficSettings({ enabled });
      setTraffic((current) => ({ ...current, settings: response.data }));
      notify(enabled ? "Live traffic capture enabled." : "Traffic capture paused.");
    } catch (settingsError) {
      notify(getErrorMessage(settingsError), "error");
    } finally {
      setWorking(false);
    }
  };

  const setCapacity = async (capacity) => {
    setWorking(true);
    try {
      const response = await api.updateGatewayTrafficSettings({ capacity: Number(capacity) });
      setTraffic((current) => ({ ...current, settings: response.data }));
      notify("In-memory capture limit updated.");
      await load();
    } catch (settingsError) {
      notify(getErrorMessage(settingsError), "error");
    } finally {
      setWorking(false);
    }
  };

  const clear = async () => {
    if (!window.confirm("Clear all traffic currently held in process memory?")) return;
    setWorking(true);
    try {
      await api.clearGatewayTraffic();
      setSelectedId(null);
      setInterpretation(null);
      await load();
      notify("In-memory traffic view cleared.");
    } catch (clearError) {
      notify(getErrorMessage(clearError), "error");
    } finally {
      setWorking(false);
    }
  };

  const exportTraffic = async (format) => {
    setWorking(true);
    try {
      const blob = await api.exportGatewayTraffic(format);
      downloadBlob(blob, `modbus-traffic.${format}`);
      notify(`Traffic exported as ${format.toUpperCase()}.`);
    } catch (exportError) {
      notify(getErrorMessage(exportError), "error");
    } finally {
      setWorking(false);
    }
  };

  const interpret = async () => {
    if (interpretationWords.length === 0) return;
    setWorking(true);
    try {
      const response = await api.interpretGatewayTraffic({
        rawValues: interpretationWords,
        scaleFactor: Number(scaleFactor),
        offset: Number(offset),
      });
      setInterpretation(response.data);
    } catch (interpretError) {
      notify(getErrorMessage(interpretError), "error");
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <InlineLoader />;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Radio className="h-4 w-4" /> Passive diagnostic view
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Inverter request analyzer
          </h2>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            Observe what the downstream inverter requests from the Orange Pi meter emulator.
            Capture is bounded process memory only—nothing on this page is written to MongoDB or disk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPaused((current) => !current)}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Resume view" : "Pause view"}
          </Button>
          <Button variant="outline" onClick={() => load()} disabled={working}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={() => exportTraffic("json")} disabled={working}>
            <Download className="h-4 w-4" /> JSON
          </Button>
          <Button variant="outline" onClick={() => exportTraffic("csv")} disabled={working}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="destructive" onClick={clear} disabled={working}>
            <Trash2 className="h-4 w-4" /> Clear memory
          </Button>
        </div>
      </section>

      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Interpretation safety</p>
          <p className="mt-1 text-blue-800">
            Modbus reveals function code, unit ID, address, quantity, and raw words. It does not reveal
            data type, byte order, scale, offset, unit, or grid-power sign convention. Candidate values
            must be confirmed against the inverter display or meter manual before zero-export operation.
            Explicitly verify whether positive grid power means import or export—the wrong sign is unsafe.
          </p>
        </div>
      </div>

      <ErrorBanner message={error} />

      <CaptureControls
        settings={traffic.settings}
        pendingRequests={traffic.pendingRequests}
        paused={paused}
        working={working}
        onCaptureChange={setCapture}
        onCapacityChange={setCapacity}
      />

      <SummaryCards summary={analysis.summary} />

      <Tabs defaultValue="live" className="space-y-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="live">Live requests</TabsTrigger>
          <TabsTrigger value="patterns">Request patterns</TabsTrigger>
          <TabsTrigger value="suggestions">Mapping suggestions</TabsTrigger>
          <TabsTrigger value="addresses">Address heat map</TabsTrigger>
          <TabsTrigger value="clients">Clients & sessions</TabsTrigger>
          <TabsTrigger value="sequence">Request sequence</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-4">
          <TrafficFilters filters={filters} setFilters={setFilters} />
          <LiveTrafficTable
            events={traffic.events}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </TabsContent>
        <TabsContent value="patterns">
          <PatternsTable patterns={analysis.patterns} />
        </TabsContent>
        <TabsContent value="suggestions">
          <MappingSuggestions suggestions={analysis.mappingSuggestions || []} />
        </TabsContent>
        <TabsContent value="addresses">
          <AddressHeatMap ranges={analysis.addressRanges} />
        </TabsContent>
        <TabsContent value="clients">
          <ClientsAndSessions clients={analysis.clients} sessions={analysis.sessions} />
        </TabsContent>
        <TabsContent value="sequence">
          <RequestSequence sequence={analysis.recentSequence} />
        </TabsContent>
      </Tabs>

      <RequestInspector
        event={selected}
        words={interpretationWords}
        capturedWordCount={capturedWords.length}
        wordOffset={wordOffset}
        wordCount={wordCount}
        setWordOffset={setWordOffset}
        setWordCount={setWordCount}
        scaleFactor={scaleFactor}
        offset={offset}
        setScaleFactor={setScaleFactor}
        setOffset={setOffset}
        interpretation={interpretation}
        onInterpret={interpret}
        working={working}
      />
    </div>
  );
}

function CaptureControls({
  settings,
  pendingRequests,
  paused,
  working,
  onCaptureChange,
  onCapacityChange,
}) {
  const [capacity, setCapacity] = useState(String(settings?.capacity || 2000));

  useEffect(() => {
    setCapacity(String(settings?.capacity || 2000));
  }, [settings?.capacity]);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <Switch
              checked={Boolean(settings?.enabled)}
              disabled={working}
              onCheckedChange={onCaptureChange}
            />
            Capture requests
          </label>
          <Badge variant="outline" className="bg-white">
            {settings?.retainedEvents || 0} / {settings?.capacity || 0} retained
          </Badge>
          <Badge variant="outline" className="bg-white">
            {settings?.totalCaptured || 0} captured since clear
          </Badge>
          <Badge variant="outline" className="bg-white">
            {pendingRequests || 0} pending
          </Badge>
          {paused && <Badge className="bg-amber-500 text-white">View paused; capture continues</Badge>}
        </div>
        <div className="flex items-end gap-2">
          <Field label="Memory event limit" hint="100–10,000 events; never persisted.">
            <Input
              type="number"
              min="100"
              max="10000"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              className="w-32"
            />
          </Field>
          <Button
            variant="outline"
            disabled={working || Number(capacity) === settings?.capacity}
            onClick={() => onCapacityChange(capacity)}
          >
            Apply
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCards({ summary }) {
  const cards = [
    ["Retained requests", summary.retainedRequests || 0, Activity],
    ["Request patterns", summary.uniquePatterns || 0, BarChart3],
    ["Master clients", summary.uniqueClients || 0, Wifi],
    ["Requests / minute", summary.overallRequestsPerMinute ?? "—", Radio],
    ["Modbus exceptions", summary.exceptions || 0, ShieldAlert],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map(([label, value, Icon]) => (
        <Card key={label}>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            </div>
            <Icon className="h-5 w-5 text-indigo-500" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TrafficFilters({ filters, setFilters }) {
  const set = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Select
          value={filters.transport}
          placeholder="All transports"
          options={["TCP", "RTU"]}
          onChange={(event) => set("transport", event.target.value)}
        />
        <Select
          value={filters.operation}
          placeholder="All operations"
          options={["READ", "WRITE", "OTHER"]}
          onChange={(event) => set("operation", event.target.value)}
        />
        <Input
          type="number"
          min="1"
          max="127"
          placeholder="Function code"
          value={filters.functionCode}
          onChange={(event) => set("functionCode", event.target.value)}
        />
        <Input
          type="number"
          min="0"
          max="65535"
          placeholder="Address contains"
          value={filters.address}
          onChange={(event) => set("address", event.target.value)}
        />
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Client IP or serial path"
            value={filters.client}
            onChange={(event) => set("client", event.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function LiveTrafficTable({ events, selectedId, onSelect }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Captured requests
          <Badge variant="outline">{events.length}</Badge>
        </CardTitle>
        <CardDescription>Newest completed Modbus request first. Select a row for raw analysis.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <EmptyTraffic message="No matching requests captured. Start the gateway and let the inverter poll it." />
        ) : (
          <div
            className="data-scroll-region max-h-[65vh] overflow-auto overscroll-contain [scrollbar-gutter:stable] sm:max-h-[38rem]"
            role="region"
            aria-label="Scrollable captured Modbus requests"
            tabIndex={0}
          >
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Unit / FC</th>
                  <th className="px-4 py-3">Area and range</th>
                  <th className="px-4 py-3">Raw values</th>
                  <th className="px-4 py-3">Mapping</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className={selectedId === event.id ? "bg-indigo-50" : "hover:bg-slate-50"}
                  >
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(event.requestAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs">{clientLabel(event)}</p>
                      <p className="text-xs text-slate-500">{event.transport}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">Unit {event.unitId} · FC{String(event.functionCode).padStart(2, "0")}</p>
                      <p className="text-xs text-slate-500">{event.functionName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs">
                        {event.address === null ? "—" : `${event.address}–${event.endAddress}`}
                      </p>
                      <p className="text-xs text-slate-500">
                        {event.registerType?.replaceAll("_", " ") || "Other"}
                        {event.registerReference ? ` · ${event.registerReference}` : ""}
                      </p>
                    </td>
                    <td className="max-w-60 px-4 py-3 font-mono text-xs">
                      <p className="truncate">RX [{(event.requestValues || []).join(", ")}]</p>
                      <p className="truncate text-slate-500">TX [{(event.responseValues || []).join(", ")}]</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {event.mappings?.length
                        ? event.mappings.map((mapping) => mapping.key).join(", ")
                        : <span className="font-semibold text-amber-700">Unmapped</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={statusClass(event)}>
                        {event.success ? `${event.durationMs} ms` : event.exceptionName || "Failed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" onClick={() => onSelect(event.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
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

function PatternsTable({ patterns }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repeated inverter request patterns</CardTitle>
        <CardDescription>
          Requests are grouped by client, unit ID, function code, start address, and quantity.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {patterns.length === 0 ? <EmptyTraffic /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Address / qty</th>
                  <th className="px-4 py-3">Count</th>
                  <th className="px-4 py-3">Average interval</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Possible types</th>
                  <th className="px-4 py-3">Mappings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patterns.map((pattern) => (
                  <tr key={pattern.signature}>
                    <td className="px-4 py-3 font-mono text-xs">{pattern.client}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">Unit {pattern.unitId} · FC{String(pattern.functionCode).padStart(2, "0")}</p>
                      <p className="text-xs text-slate-500">{pattern.functionName}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {pattern.address === null ? "—" : `${pattern.address}–${pattern.endAddress} (${pattern.quantity})`}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{pattern.count}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {pattern.averageIntervalMs === null ? "—" : `${pattern.averageIntervalMs} ms`}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {pattern.requestsPerMinute === null ? "—" : `${pattern.requestsPerMinute}/min`}
                    </td>
                    <td className="max-w-72 px-4 py-3 text-xs text-slate-600">
                      {(pattern.possibleDataTypes || []).join(", ") || "Not inferable"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {pattern.mappings?.join(", ") || <span className="text-amber-700">Unmapped</span>}
                    </td>
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

function MappingSuggestions({ suggestions }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Power-meter emulation mapping checklist</CardTitle>
        <CardDescription>
          Suggestions use observed addresses and function codes. Source measurement and exact encoding still require manual confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.length === 0 ? <EmptyTraffic /> : suggestions.map((suggestion) => {
          const coverageClass =
            suggestion.status === "FULL"
              ? "border-emerald-200 bg-emerald-50"
              : suggestion.status === "PARTIAL"
                ? "border-amber-200 bg-amber-50"
                : "border-rose-200 bg-rose-50";
          return (
            <div key={suggestion.signature} className={`rounded-xl border p-4 ${coverageClass}`}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="bg-white">{suggestion.status}</Badge>
                    {suggestion.priority === "HIGH_FREQUENCY" && (
                      <Badge className="bg-indigo-600 text-white">High-frequency inverter request</Badge>
                    )}
                  </div>
                  <p className="mt-2 font-semibold">
                    FC{String(suggestion.functionCode).padStart(2, "0")} {suggestion.registerType?.replaceAll("_", " ")} · address {suggestion.address}–{suggestion.endAddress}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Unit {suggestion.unitId} · quantity {suggestion.quantity} · {suggestion.count} observations · {suggestion.averageIntervalMs ?? "—"} ms average
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <p>{suggestion.client}</p>
                  <p>{suggestion.requestsPerMinute ?? "—"} requests/min</p>
                </div>
              </div>
              <p className="mt-3 text-sm">{suggestion.recommendation}</p>
              <p className="mt-2 text-xs text-slate-600">
                Candidate formats: {suggestion.possibleDataTypes?.join(", ") || "Not inferable"}
              </p>
              {suggestion.mappedKeys?.length > 0 && (
                <p className="mt-1 text-xs text-slate-600">Current mappings: {suggestion.mappedKeys.join(", ")}</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AddressHeatMap({ ranges }) {
  const maximum = Math.max(1, ...ranges.map((range) => range.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requested address ranges</CardTitle>
        <CardDescription>Darker, wider bars indicate ranges requested more often.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ranges.length === 0 ? <EmptyTraffic /> : ranges.slice(0, 100).map((range) => (
          <div key={range.signature} className="grid gap-2 rounded-lg border border-slate-100 p-3 lg:grid-cols-[15rem_1fr_8rem] lg:items-center">
            <div>
              <p className="font-mono text-sm font-semibold">{range.registerType?.replaceAll("_", " ")}</p>
              <p className="font-mono text-xs text-slate-500">
                FC{String(range.functionCode).padStart(2, "0")} · {range.address}–{range.endAddress} · qty {range.quantity}
              </p>
            </div>
            <div className="h-5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${Math.max(4, (range.count / maximum) * 100)}%` }}
              />
            </div>
            <p className="text-right text-sm font-semibold tabular-nums">{range.count} requests</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ClientsAndSessions({ clients, sessions }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Observed clients</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {clients.length === 0 ? <EmptyTraffic /> : clients.map((client) => (
            <div key={client.client} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-sm font-semibold">{client.client}</p>
                <Badge variant="outline">{client.count} requests</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {client.transport} · units {client.unitIds.join(", ")} · FC {client.functionCodes.join(", ")}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Process-local sessions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {sessions.length === 0 ? <EmptyTraffic /> : sessions.map((session) => (
            <div key={session.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-sm font-semibold">
                  {session.transport === "TCP"
                    ? `${session.client?.address}:${session.client?.port}`
                    : session.serialPath}
                </p>
                <Badge className={session.active ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>
                  {session.active ? "Connected" : "Closed"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Connected {formatDate(session.connectedAt)} · {session.requestCount} requests
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RequestSequence({ sequence }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent polling sequence</CardTitle>
        <CardDescription>The last 30 requests in chronological order.</CardDescription>
      </CardHeader>
      <CardContent>
        {sequence.length === 0 ? <EmptyTraffic /> : (
          <div className="flex flex-wrap gap-2">
            {sequence.map((item, index) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                <p className="font-semibold">{index + 1}. FC{String(item.functionCode).padStart(2, "0")}</p>
                <p className="font-mono text-slate-500">{item.address ?? "—"} / {item.quantity ?? "—"}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RequestInspector({
  event,
  words,
  capturedWordCount,
  wordOffset,
  wordCount,
  setWordOffset,
  setWordCount,
  scaleFactor,
  offset,
  setScaleFactor,
  setOffset,
  interpretation,
  onInterpret,
  working,
}) {
  if (!event) {
    return (
      <Card>
        <CardContent className="grid min-h-44 place-items-center p-6 text-center text-sm text-slate-500">
          Select a captured request to inspect raw frames, mapped register semantics, and candidate data interpretations.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-indigo-500" /> Request inspector
        </CardTitle>
        <CardDescription>
          {clientLabel(event)} · unit {event.unitId} · FC{String(event.functionCode).padStart(2, "0")} · {formatDate(event.requestAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {[
            ["Transport", event.transport],
            ["Client", clientLabel(event)],
            ["Transaction", event.transactionId ?? "RTU—none"],
            ["Unit ID", event.unitId],
            ["Function", `FC${String(event.functionCode).padStart(2, "0")}`],
            ["Address", event.address ?? "—"],
            ["Quantity", event.quantity ?? "—"],
            ["Duration", event.durationMs === null ? "—" : `${event.durationMs} ms`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-1 truncate font-mono text-xs font-semibold" title={String(value)}>{value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <RawFrame label="Request frame" value={event.requestHex} />
          <RawFrame label="Response frame" value={event.responseHex || event.transportError || "No response"} />
        </div>

        <div>
          <h3 className="font-semibold">Matched forwarding semantics</h3>
          {event.mappings?.length ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {event.mappings.map((mapping) => (
                <div key={mapping.key} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
                  <p className="font-semibold text-emerald-900">{mapping.name} ({mapping.key})</p>
                  <p className="mt-1 font-mono text-xs text-emerald-800">
                    Target {mapping.registerType} {mapping.address}–{mapping.endAddress} · {mapping.dataType} · {mapping.order}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">
                    Scale {mapping.scaleFactor} · offset {mapping.offset} · {mapping.unit || "no unit"}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">
                    Source {mapping.sourceRegisterKey} · {mapping.fullyCoversRequest ? "full request match" : "partial range match"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              The inverter requested an address that is not covered by an enabled forwarding mapping.
            </p>
          )}
        </div>

        <div>
          <h3 className="font-semibold">Candidate data interpretations</h3>
          <p className="mt-1 text-xs text-slate-500">
            Analyze words [{words.join(", ") || "none"}]. These candidates are diagnostic guesses, not information sent by the inverter.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Word offset" hint={`0–${Math.max(0, capturedWordCount - 1)} within the captured block.`}>
              <Input
                type="number"
                min="0"
                max={Math.max(0, capturedWordCount - 1)}
                value={wordOffset}
                onChange={(event) => setWordOffset(event.target.value)}
                className="w-28"
              />
            </Field>
            <Field label="Word count" hint="Use 1, 2, or 4 for common numeric types.">
              <Input
                type="number"
                min="1"
                max={Math.max(1, capturedWordCount)}
                value={wordCount}
                onChange={(event) => setWordCount(event.target.value)}
                className="w-28"
              />
            </Field>
            <Field label="Test scale">
              <Input type="number" step="any" value={scaleFactor} onChange={(event) => setScaleFactor(event.target.value)} className="w-32" />
            </Field>
            <Field label="Test offset">
              <Input type="number" step="any" value={offset} onChange={(event) => setOffset(event.target.value)} className="w-32" />
            </Field>
            <Button onClick={onInterpret} disabled={working || words.length === 0}>
              <BrainCircuit className="h-4 w-4" /> Analyze raw words
            </Button>
          </div>
          {interpretation && <InterpretationResults interpretation={interpretation} />}
        </div>
      </CardContent>
    </Card>
  );
}

function InterpretationResults({ interpretation }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[650px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Candidate type</th><th className="px-3 py-2">Order</th><th className="px-3 py-2">Raw decoded</th><th className="px-3 py-2">Scaled value</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {interpretation.candidates.map((candidate, index) => (
              <tr key={`${candidate.dataType}-${candidate.order}-${index}`}>
                <td className="px-3 py-2 font-semibold">{candidate.dataType}</td>
                <td className="px-3 py-2 font-mono">{candidate.order}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatValue(candidate.rawValue)}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">{formatValue(candidate.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {interpretation.text && <p className="text-sm">Printable text candidate: <code>{interpretation.text}</code></p>}
      {interpretation.bitFields?.length > 0 && (
        <p className="text-xs text-slate-600">
          Set bits: {interpretation.bitFields.filter((bit) => bit.set).map((bit) => bit.bitIndex).join(", ") || "none"}
        </p>
      )}
    </div>
  );
}

function RawFrame({ label, value }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <pre className="min-h-20 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-emerald-300">
        {value}
      </pre>
    </div>
  );
}

function EmptyTraffic({ message = "No traffic has been captured for this view." }) {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-sm text-slate-500">{message}</div>;
}
