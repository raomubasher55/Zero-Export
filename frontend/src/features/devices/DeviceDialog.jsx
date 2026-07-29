import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/common/Feedback";
import { Field, Select, SwitchRow } from "@/components/common/FormControls";
import { getErrorMessage } from "@/lib/formatters";
import { devicePayload, deviceToForm } from "./deviceForm";

export function DeviceDialog({ open, onOpenChange, device, profiles, onSave }) {
  const [form, setForm] = useState(() => deviceToForm(device));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setForm(deviceToForm(device));
      setError("");
    }
  }, [open, device]);
  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  const setConnection = (field, value) =>
    setForm((current) => ({
      ...current,
      connection: { ...current.connection, [field]: value },
    }));
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSave(devicePayload(form), device);
      onOpenChange(false);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{device ? "Edit device" : "Add device"}</DialogTitle>
          <DialogDescription>
            Connection and polling settings are persisted to the Modbus core.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <ErrorBanner message={error} />
          <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs leading-relaxed text-slate-600">
            <strong className="text-slate-800">How to fill this device:</strong>{" "}
            Use the endpoint and unit ID from the device network settings,
            assign an active register profile, then choose a safe polling
            interval and timeout.
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Display name"
              required
              hint="A readable device name shown throughout the operations console."
            >
              <Input
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                required
              />
            </Field>
            <Field
              label="Identifier"
              required
              hint="lowercase, numbers, dots, underscores, hyphens"
            >
              <Input
                value={form.identifier}
                onChange={(event) =>
                  set("identifier", event.target.value.toLowerCase())
                }
                required
              />
            </Field>
            <Field
              label="Site"
              hint="Optional plant, building, room, or panel location."
            >
              <Input
                value={form.site}
                onChange={(event) => set("site", event.target.value)}
                placeholder="Plant A"
              />
            </Field>
            <Field label="Unit ID" hint="Modbus slave address from 1 to 247.">
              <Input
                type="number"
                min="1"
                max="247"
                value={form.unitId}
                onChange={(event) => set("unitId", event.target.value)}
                required
              />
            </Field>
            <Field
              label="Register profile"
              hint="Active decoding map used when this device is polled."
            >
              <Select
                value={form.registerProfileId}
                onChange={(event) =>
                  set("registerProfileId", event.target.value)
                }
                options={profiles
                  .filter((profile) => profile.isActive)
                  .map((profile) => ({
                    value: profile._id,
                    label: profile.name,
                  }))}
                placeholder="No profile assigned"
              />
            </Field>
            <Field
              label="Tags"
              hint="Optional comma-separated labels for searching and grouping."
            >
              <Input
                value={form.tags}
                onChange={(event) => set("tags", event.target.value)}
                placeholder="incomer, critical"
              />
            </Field>
          </div>
          <Field
            label="Description"
            hint="Optional operational or installation notes."
          >
            <textarea
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              className="form-textarea"
              rows="2"
            />
          </Field>
          <section className="rounded-xl border border-slate-200 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Transport</h3>
                <p className="text-xs text-slate-500">
                  Select the physical Modbus connection.
                </p>
              </div>
              <Select
                value={form.connection.protocol}
                onChange={(event) =>
                  setConnection("protocol", event.target.value)
                }
                options={["TCP", "RTU"]}
                className="w-28"
              />
            </div>
            {form.connection.protocol === "TCP" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Host"
                  required
                  hint="IPv4, IPv6, or DNS host of the Modbus TCP gateway."
                >
                  <Input
                    value={form.connection.host}
                    onChange={(event) =>
                      setConnection("host", event.target.value)
                    }
                    required
                    placeholder="192.168.10.25"
                  />
                </Field>
                <Field
                  label="Port"
                  hint="TCP service port; Modbus normally uses 502."
                >
                  <Input
                    type="number"
                    min="1"
                    max="65535"
                    value={form.connection.port}
                    onChange={(event) =>
                      setConnection("port", event.target.value)
                    }
                  />
                </Field>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Serial path"
                  required
                  hint="Operating-system path to the RS-485 adapter."
                >
                  <Input
                    value={form.connection.serialPath}
                    onChange={(event) =>
                      setConnection("serialPath", event.target.value)
                    }
                    required
                    placeholder="/dev/ttyUSB0"
                  />
                </Field>
                <Field
                  label="Baud rate"
                  hint="Must match the serial setting configured on the device."
                >
                  <Input
                    type="number"
                    value={form.connection.baudRate}
                    onChange={(event) =>
                      setConnection("baudRate", event.target.value)
                    }
                  />
                </Field>
                <Field
                  label="Data bits"
                  hint="Serial data-bit setting; usually 8."
                >
                  <Select
                    value={form.connection.dataBits}
                    onChange={(event) =>
                      setConnection("dataBits", event.target.value)
                    }
                    options={["5", "6", "7", "8"]}
                  />
                </Field>
                <Field
                  label="Stop bits"
                  hint="Serial stop-bit setting; usually 1."
                >
                  <Select
                    value={form.connection.stopBits}
                    onChange={(event) =>
                      setConnection("stopBits", event.target.value)
                    }
                    options={["1", "2"]}
                  />
                </Field>
                <Field
                  label="Parity"
                  hint="Must match the device parity setting."
                >
                  <Select
                    value={form.connection.parity}
                    onChange={(event) =>
                      setConnection("parity", event.target.value)
                    }
                    options={["none", "even", "odd"]}
                  />
                </Field>
              </div>
            )}
          </section>
          <section className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
            <div>
              <h3 className="font-semibold">Polling policy</h3>
              <p className="mt-1 text-xs text-slate-500">
                Interval is expressed in milliseconds.
              </p>
              <div className="mt-3 space-y-3">
                <SwitchRow
                  label="Enable polling"
                  checked={form.polling.enabled}
                  onCheckedChange={(value) =>
                    set("polling", { ...form.polling, enabled: value })
                  }
                />
                <Field
                  label="Interval (ms)"
                  hint="Time between automatic background polls; minimum 1000 ms. Saving a new interval schedules an immediate poll."
                >
                  <Input
                    type="number"
                    min="1000"
                    value={form.polling.intervalMs}
                    onChange={(event) =>
                      set("polling", {
                        ...form.polling,
                        intervalMs: event.target.value,
                      })
                    }
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {[1000, 2000, 5000, 10000, 60000].map((interval) => (
                      <Button
                        key={interval}
                        type="button"
                        size="sm"
                        variant={Number(form.polling.intervalMs) === interval ? "default" : "outline"}
                        className="h-7 px-2 text-[11px]"
                        onClick={() =>
                          set("polling", {
                            ...form.polling,
                            intervalMs: String(interval),
                          })
                        }
                      >
                        {interval < 60000 ? `${interval / 1000}s` : "60s"}
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field
                  label="Jitter (ms)"
                  hint="Random delay that spreads load when many devices poll together."
                >
                  <Input
                    type="number"
                    min="0"
                    value={form.polling.jitterMs}
                    onChange={(event) =>
                      set("polling", {
                        ...form.polling,
                        jitterMs: event.target.value,
                      })
                    }
                  />
                </Field>
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Reconnect policy</h3>
              <p className="mt-1 text-xs text-slate-500">
                Applied by the pooled Modbus transport.
              </p>
              <div className="mt-3 space-y-3">
                <Field
                  label="Response timeout (ms)"
                  hint="Maximum time to wait for one Modbus response."
                >
                  <Input
                    type="number"
                    min="100"
                    value={form.reconnect.timeoutMs}
                    onChange={(event) =>
                      set("reconnect", {
                        ...form.reconnect,
                        timeoutMs: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field
                  label="Retries"
                  hint="Additional attempts after a retryable communication failure."
                >
                  <Input
                    type="number"
                    min="0"
                    value={form.reconnect.retries}
                    onChange={(event) =>
                      set("reconnect", {
                        ...form.reconnect,
                        retries: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field
                  label="Retry delay (ms)"
                  hint="Pause between retry attempts."
                >
                  <Input
                    type="number"
                    min="0"
                    value={form.reconnect.retryDelayMs}
                    onChange={(event) =>
                      set("reconnect", {
                        ...form.reconnect,
                        retryDelayMs: event.target.value,
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          </section>
          <SwitchRow
            label="Device enabled"
            description="Disabled devices cannot connect, poll, or run Modbus operations."
            checked={form.isEnabled}
            onCheckedChange={(value) => set("isEnabled", value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {device ? "Save changes" : "Create device"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
