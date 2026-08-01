import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CirclePlus,
  Copy,
  LoaderCircle,
  Play,
  Radio,
  RotateCcw,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ErrorBanner, InlineLoader } from "@/components/common/Feedback";
import { Field, Select, SwitchRow } from "@/components/common/FormControls";
import {
  DATA_TYPES,
  REGISTER_ORDER_OPTIONS,
  REGISTER_TYPES,
} from "@/constants/modbus";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/formatters";
import {
  createGatewayForm,
  gatewayPayload,
  mappingFromSource,
  mappingToForm,
} from "./gatewayForm";

const FIXED_LENGTHS = {
  BIT: 1,
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT32: 2,
  FLOAT64: 4,
};

const READ_FUNCTION_CODES = {
  COIL: "FC01",
  DISCRETE_INPUT: "FC02",
  HOLDING_REGISTER: "FC03",
  INPUT_REGISTER: "FC04",
};

const WRITE_FUNCTION_CODES = {
  COIL: "FC05 / FC15",
  HOLDING_REGISTER: "FC06 / FC16",
};

const REGISTER_REFERENCE_BASES = {
  COIL: 1,
  DISCRETE_INPUT: 10001,
  INPUT_REGISTER: 30001,
  HOLDING_REGISTER: 40001,
};

function registerReference(registerType, address) {
  const numericAddress = Number(address);
  if (!Number.isInteger(numericAddress) || numericAddress < 0 || numericAddress > 9998) {
    return null;
  }
  return String(REGISTER_REFERENCE_BASES[registerType] + numericAddress).padStart(5, "0");
}

export function GatewayView({ devices, profiles, notify }) {
  const [form, setForm] = useState(() => createGatewayForm());
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const [mirrorDeviceId, setMirrorDeviceId] = useState("");
  const [mirrorRegisterType, setMirrorRegisterType] = useState("");
  const [mirrorOffset, setMirrorOffset] = useState("0");
  const [mirroring, setMirroring] = useState(false);
  const [mirrorError, setMirrorError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getGateway();
      setForm(createGatewayForm(response.data.configuration));
      setStatus(response.data.status);
      setError("");
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [String(profile._id), profile])),
    [profiles],
  );

  const sourceRegisters = useCallback(
    (deviceId) => {
      const device = devices.find((item) => String(item._id) === String(deviceId));
      const profileId = device?.registerProfile?._id;
      return profilesById.get(String(profileId))?.registers || [];
    },
    [devices, profilesById],
  );

  const sourceDefinition = useCallback(
    (mapping) =>
      sourceRegisters(mapping.sourceDeviceId).find(
        (register) => register.key === mapping.sourceRegisterKey,
      ),
    [sourceRegisters],
  );

  const updateMapping = (index, field, value) => {
    setForm((current) => ({
      ...current,
      mappings: current.mappings.map((mapping, itemIndex) => {
        if (itemIndex !== index) return mapping;
        const next = { ...mapping, [field]: value };
        if (field === "registerType") {
          if (["COIL", "DISCRETE_INPUT"].includes(value)) {
            next.dataType = "BIT";
            next.length = "1";
            next.bitIndex = "0";
          }
          if (["INPUT_REGISTER", "DISCRETE_INPUT"].includes(value)) {
            next.writable = false;
          }
        }
        if (field === "dataType" && FIXED_LENGTHS[value]) {
          next.length = String(FIXED_LENGTHS[value]);
        }
        return next;
      }),
    }));
  };

  const mirrorSource = (index, deviceId, registerKey) => {
    const device = devices.find((item) => String(item._id) === String(deviceId));
    const register = sourceRegisters(deviceId).find((item) => item.key === registerKey);
    if (!device || !register) return;
    setForm((current) => ({
      ...current,
      mappings: current.mappings.map((mapping, itemIndex) =>
        itemIndex === index
          ? mappingFromSource(device, register, index, {
              key: mapping.key,
              name: mapping.name,
              enabled: mapping.enabled,
            })
          : mapping,
      ),
    }));
  };

  const changeSourceDevice = (index, deviceId) => {
    const register = sourceRegisters(deviceId)[0];
    const device = devices.find((item) => String(item._id) === String(deviceId));
    if (device && register) {
      setForm((current) => ({
        ...current,
        mappings: current.mappings.map((mapping, itemIndex) =>
          itemIndex === index
            ? mappingFromSource(device, register, index, {
                enabled: mapping.enabled,
              })
            : mapping,
        ),
      }));
    } else {
      updateMapping(index, "sourceDeviceId", deviceId);
    }
  };

  const addMapping = () => {
    const device = devices.find(
      (item) => sourceRegisters(item._id).filter((register) => register.enabled !== false).length > 0,
    );
    const register = device
      ? sourceRegisters(device._id).find((item) => item.enabled !== false)
      : null;
    if (!device || !register) {
      setError("Create a device with an active register profile before adding a forwarding mapping.");
      return;
    }
    setForm((current) => ({
      ...current,
      mappings: [
        ...current.mappings,
        mappingFromSource(device, register, current.mappings.length),
      ],
    }));
  };

  const removeMapping = (index) =>
    setForm((current) => ({
      ...current,
      mappings: current.mappings.filter((_, itemIndex) => itemIndex !== index),
    }));

  const mirrorableDevices = useMemo(
    () =>
      devices.filter((device) => {
        const profileId = device?.registerProfile?._id;
        const profile = profilesById.get(String(profileId));
        return (
          profile?.registers?.some((register) => register.enabled !== false)
        );
      }),
    [devices, profilesById],
  );

  const generateMirrorMappings = async () => {
    if (!mirrorDeviceId) {
      setMirrorError("Select the source device whose register map should be mirrored.");
      return;
    }
    setMirroring(true);
    setMirrorError("");
    try {
      const response = await api.generateGatewayMappings({
        sourceDeviceId: mirrorDeviceId,
        registerType: mirrorRegisterType || undefined,
        addressOffset: Number(mirrorOffset || 0),
      });
      const generated = (response.data.mappings || []).map(mappingToForm);
      let added = 0;
      let skipped = 0;
      setForm((current) => {
        const existingKeys = new Set(
          current.mappings.map((mapping) => mapping.key),
        );
        const fresh = generated.filter((mapping) => {
          if (existingKeys.has(mapping.key)) {
            skipped += 1;
            return false;
          }
          return true;
        });
        added = fresh.length;
        return { ...current, mappings: [...current.mappings, ...fresh] };
      });
      const device = devices.find(
        (item) => String(item._id) === String(mirrorDeviceId),
      );
      notify(
        `${added} register${added === 1 ? "" : "s"} from ${
          device?.name || "the device"
        } mirrored at the same addresses${
          skipped ? ` (${skipped} already present)` : ""
        }. Review then save.`,
      );
      setMirrorOpen(false);
    } catch (mirrorGenerationError) {
      setMirrorError(getErrorMessage(mirrorGenerationError));
    } finally {
      setMirroring(false);
    }
  };

  const run = async (operation, successMessage) => {
    setWorking(true);
    setError("");
    try {
      const response = await operation();
      setForm(createGatewayForm(response.data.configuration));
      setStatus(response.data.status);
      notify(successMessage);
    } catch (operationError) {
      const message = getErrorMessage(operationError);
      setError(message);
      notify(message, "error");
    } finally {
      setWorking(false);
    }
  };

  const save = () =>
    run(() => api.updateGateway(gatewayPayload(form)), "Gateway configuration saved.");
  const start = () =>
    run(
      () => api.updateGateway({ ...gatewayPayload(form), enabled: true }),
      "Modbus forwarding gateway started.",
    );
  const stop = () => run(() => api.stopGateway(), "Modbus forwarding gateway stopped.");

  if (loading) return <InlineLoader />;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">Orange Pi bridge</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Modbus forwarding gateway
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Publish polled engineering values as a Modbus TCP and/or RTU slave.
            Writable mappings convert downstream values and write them back to the source device.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/gateway/traffic">
              <Radio className="h-4 w-4" /> Analyze client requests
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => setMirrorOpen(true)}
            disabled={mirrorableDevices.length === 0}
            title={
              mirrorableDevices.length === 0
                ? "Create a device with an active register profile first."
                : "Generate one mapping per register using the meter's own addresses."
            }
          >
            <Copy className="h-4 w-4" /> Mirror device profile
          </Button>
          <Button variant="outline" onClick={load} disabled={working}>
            <RotateCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={save} disabled={working}>
            <Save className="h-4 w-4" /> Save
          </Button>
          {status?.running ? (
            <Button variant="destructive" onClick={stop} disabled={working}>
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Stop
            </Button>
          ) : (
            <Button onClick={start} disabled={working}>
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Save & start
            </Button>
          )}
        </div>
      </section>

      <ErrorBanner message={error} />
      <GatewayStatus status={status} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Slave identity</CardTitle>
            <CardDescription>
              The downstream Modbus master must request this unit ID.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Unit ID" required hint="Valid Modbus slave address: 1–247.">
              <Input
                type="number"
                min="1"
                max="247"
                value={form.unitId}
                onChange={(event) => setForm((current) => ({ ...current, unitId: event.target.value }))}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Modbus TCP slave</CardTitle>
            <CardDescription>
              Port 1502 works without root privileges; port 502 may require Linux capabilities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SwitchRow
              label="Enable TCP endpoint"
              checked={form.tcp.enabled}
              onCheckedChange={(enabled) =>
                setForm((current) => ({ ...current, tcp: { ...current.tcp, enabled } }))
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Listen address" hint="Use 0.0.0.0 on the Orange Pi to accept LAN clients.">
                <Input
                  value={form.tcp.host}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      tcp: { ...current.tcp, host: event.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="TCP port">
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.tcp.port}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      tcp: { ...current.tcp, port: event.target.value },
                    }))
                  }
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Modbus RTU slave</CardTitle>
            <CardDescription>
              Use a second RS-485 adapter. Do not reuse the serial path used by the upstream master.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SwitchRow
              label="Enable RTU endpoint"
              checked={form.rtu.enabled}
              onCheckedChange={(enabled) =>
                setForm((current) => ({ ...current, rtu: { ...current.rtu, enabled } }))
              }
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <Field label="Serial path">
                <Input
                  value={form.rtu.serialPath}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rtu: { ...current.rtu, serialPath: event.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Baud rate">
                <Input
                  type="number"
                  value={form.rtu.baudRate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rtu: { ...current.rtu, baudRate: event.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Data bits">
                <Select
                  value={form.rtu.dataBits}
                  options={["5", "6", "7", "8"]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rtu: { ...current.rtu, dataBits: event.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Stop bits">
                <Select
                  value={form.rtu.stopBits}
                  options={["1", "2"]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rtu: { ...current.rtu, stopBits: event.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Parity">
                <Select
                  value={form.rtu.parity}
                  options={["none", "even", "odd"]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rtu: { ...current.rtu, parity: event.target.value },
                    }))
                  }
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col items-stretch justify-between gap-3 space-y-0 border-b border-slate-100 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              Forwarding register map
              <Badge variant="outline">{form.mappings.length}</Badge>
            </CardTitle>
            <CardDescription>
              Select a source to mirror its settings, then edit the slave area, address, type, order, scale, or offset.
            </CardDescription>
          </div>
          <Button className="w-full shrink-0 sm:ml-3 sm:w-auto" variant="outline" size="sm" onClick={addMapping}>
            <CirclePlus className="h-4 w-4" /> Add mapping
          </Button>
        </CardHeader>
        <CardContent
          className="data-scroll-region max-h-[70vh] space-y-4 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:max-h-[42rem] sm:p-6"
          role="region"
          aria-label="Scrollable forwarding register mappings"
          tabIndex={0}
        >
          {form.mappings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No forwarded registers. Add a mapping after assigning a register profile to a device.
            </div>
          ) : (
            form.mappings.map((mapping, index) => (
              <MappingCard
                key={index}
                mapping={mapping}
                index={index}
                devices={devices}
                registers={sourceRegisters(mapping.sourceDeviceId)}
                source={sourceDefinition(mapping)}
                update={updateMapping}
                changeSourceDevice={changeSourceDevice}
                changeSourceRegister={(registerKey) =>
                  mirrorSource(index, mapping.sourceDeviceId, registerKey)
                }
                mirror={() => mirrorSource(index, mapping.sourceDeviceId, mapping.sourceRegisterKey)}
                remove={() => removeMapping(index)}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={mirrorOpen} onOpenChange={setMirrorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mirror device register map</DialogTitle>
            <DialogDescription>
              Generate one forwarding mapping per register of the selected
              device's profile. Addresses stay identical to the meter (optionally
              offset), so a downstream controller reads the gateway exactly like
              the physical device. Review the generated rows, then save.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Source device" required>
              <Select
                value={mirrorDeviceId}
                onChange={(event) => setMirrorDeviceId(event.target.value)}
                options={mirrorableDevices.map((device) => ({
                  value: String(device._id),
                  label: `${device.name} (${device.identifier})`,
                }))}
                placeholder="Select a device with a register profile"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Slave area"
                hint="Same area keeps FC04 input registers like the EM500; holding registers expose the same addresses over FC03."
              >
                <Select
                  value={mirrorRegisterType}
                  onChange={(event) => setMirrorRegisterType(event.target.value)}
                  options={[
                    { value: "", label: "Same as source" },
                    ...REGISTER_TYPES.map((value) => ({
                      value,
                      label: value.replaceAll("_", " "),
                    })),
                  ]}
                />
              </Field>
              <Field label="Address offset" hint="0 mirrors the manual's exact addresses.">
                <Input
                  type="number"
                  min="0"
                  max="65535"
                  value={mirrorOffset}
                  onChange={(event) => setMirrorOffset(event.target.value)}
                />
              </Field>
            </div>
            {mirrorError && <ErrorBanner message={mirrorError} />}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMirrorOpen(false)}
              disabled={mirroring}
            >
              Cancel
            </Button>
            <Button onClick={generateMirrorMappings} disabled={mirroring}>
              {mirroring ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Generate &amp; add to map
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GatewayStatus({ status }) {
  const running = status?.running;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm ${running ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <Badge className={running ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>
        {status?.state || "STOPPED"}
      </Badge>
      <span>{status?.mappingCount || 0} active mappings</span>
      <span>·</span>
      <span>TCP {status?.endpoints?.tcp || "STOPPED"}</span>
      <span>·</span>
      <span>RTU {status?.endpoints?.rtu || "STOPPED"}</span>
      {status?.lastError?.message && (
        <span className="w-full text-rose-700">{status.lastError.message}</span>
      )}
    </div>
  );
}

function MappingCard({
  mapping,
  index,
  devices,
  registers,
  source,
  update,
  changeSourceDevice,
  changeSourceRegister,
  mirror,
  remove,
}) {
  const bitArea = ["COIL", "DISCRETE_INPUT"].includes(mapping.registerType);
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 shrink-0 text-indigo-500" />
          <h3 className="font-semibold">Mapping {index + 1}</h3>
          <Badge variant="outline">Read {READ_FUNCTION_CODES[mapping.registerType]}</Badge>
          <Badge variant="outline">
            Address {mapping.address}
            {registerReference(mapping.registerType, mapping.address)
              ? ` (${registerReference(mapping.registerType, mapping.address)})`
              : ""}
          </Badge>
          {mapping.writable && (
            <Badge variant="outline">Write {WRITE_FUNCTION_CODES[mapping.registerType]}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={mirror}>
            Mirror source
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={remove} className="text-rose-600">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Source device" required>
          <Select
            value={mapping.sourceDeviceId}
            placeholder="Select device"
            options={devices.map((device) => ({ value: String(device._id), label: device.name }))}
            onChange={(event) => changeSourceDevice(index, event.target.value)}
          />
        </Field>
        <Field label="Source register" required>
          <Select
            value={mapping.sourceRegisterKey}
            placeholder="Select register"
            options={registers.map((register) => ({
              value: register.key,
              label: `${register.name} (${register.key})`,
            }))}
            onChange={(event) => changeSourceRegister(event.target.value)}
          />
        </Field>
        <Field label="Mapping key" required>
          <Input value={mapping.key} onChange={(event) => update(index, "key", event.target.value)} />
        </Field>
        <Field label="Display name" required>
          <Input value={mapping.name} onChange={(event) => update(index, "name", event.target.value)} />
        </Field>

        <Field label="Slave area" required>
          <Select
            value={mapping.registerType}
            options={REGISTER_TYPES}
            onChange={(event) => update(index, "registerType", event.target.value)}
          />
        </Field>
        <Field label="Slave address" required hint="Zero-based address used by the downstream master.">
          <Input
            type="number"
            min="0"
            max="65535"
            value={mapping.address}
            onChange={(event) => update(index, "address", event.target.value)}
          />
        </Field>
        <Field label="Data type / words" required>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={mapping.dataType}
              options={bitArea ? ["BIT"] : DATA_TYPES}
              onChange={(event) => update(index, "dataType", event.target.value)}
            />
            <Input
              type="number"
              min="1"
              max="125"
              value={mapping.length}
              disabled={mapping.dataType !== "STRING"}
              onChange={(event) => update(index, "length", event.target.value)}
            />
          </div>
        </Field>
        <Field label="Byte / word order">
          <Select
            value={mapping.order}
            options={REGISTER_ORDER_OPTIONS}
            onChange={(event) => update(index, "order", event.target.value)}
          />
        </Field>

        <Field label="Scale" hint="Slave raw = (engineering value − offset) ÷ scale.">
          <Input
            type="number"
            step="any"
            value={mapping.scaleFactor}
            onChange={(event) => update(index, "scaleFactor", event.target.value)}
          />
        </Field>
        <Field label="Offset">
          <Input
            type="number"
            step="any"
            value={mapping.offset}
            onChange={(event) => update(index, "offset", event.target.value)}
          />
        </Field>
        <Field label="Unit">
          <Input value={mapping.unit} onChange={(event) => update(index, "unit", event.target.value)} />
        </Field>
        {mapping.dataType === "BIT" && !bitArea ? (
          <Field label="Bit index">
            <Input
              type="number"
              min="0"
              max="15"
              value={mapping.bitIndex}
              onChange={(event) => update(index, "bitIndex", event.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-slate-200 pt-4 text-sm">
        <label className="flex items-center gap-2 font-medium">
          <Switch checked={mapping.enabled} onCheckedChange={(value) => update(index, "enabled", value)} />
          Enabled
        </label>
        <label className="flex items-center gap-2 font-medium">
          <Switch
            checked={mapping.writable}
            disabled={
              !["COIL", "HOLDING_REGISTER"].includes(mapping.registerType) ||
              !source?.writable ||
              !["COIL", "HOLDING_REGISTER"].includes(source?.registerType)
            }
            onCheckedChange={(value) => update(index, "writable", value)}
          />
          Write through to source
        </label>
        {!source?.writable && (
          <span className="text-amber-700">
            Mark the source profile register writable before enabling write-through.
          </span>
        )}
      </div>
    </section>
  );
}
