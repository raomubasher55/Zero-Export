import { useEffect, useState } from "react";
import { CircleHelp, CirclePlus, LoaderCircle, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { ErrorBanner } from "@/components/common/Feedback";
import { Field, Select, SwitchRow } from "@/components/common/FormControls";
import {
  DATA_TYPES,
  REGISTER_ORDER_OPTIONS,
  REGISTER_TYPES,
} from "@/constants/modbus";
import { getErrorMessage } from "@/lib/formatters";
import { createRegister, profilePayload, profileToForm } from "./profileForm";

const HELP = {
  name: "A readable profile name shown when assigning the map to a device.",
  identifier:
    "A unique API key: 1–64 lowercase letters, numbers, dots, underscores, or hyphens.",
  manufacturer:
    "The company that manufactured the device. Leave blank if the map is generic.",
  model: "The exact model or product family supported by this map.",
  description:
    "Document firmware requirements, address conventions, or other compatibility notes.",
  key: "Unique machine key beginning with a letter, for example voltage_l1 or total_kwh.",
  registerName: "Readable measurement name shown in telemetry and reports.",
  area: "Choose the Modbus memory area listed in the manufacturer register manual.",
  address:
    "Zero-based address from 0 to 65535. Convert manuals that use 30001/40001 notation when needed.",
  type: "Raw value type. Coils and discrete inputs must use BIT.",
  length:
    "Number of 16-bit words. Numeric types are automatic; STRING requires an explicit length.",
  order:
    "ABCD = normal, BADC = byte swap, CDAB = word swap, DCBA = reverse bytes and words.",
  scale: "Multiplier applied after decoding. Use 1 when no scaling is needed.",
  offset: "Value added after scaling. Use 0 when no offset is needed.",
  unit: "Engineering unit such as V, A, Hz, kW, or kWh.",
  writable:
    "Allows gateway write-through for coil and holding-register definitions. Keep measurements read-only.",
  enabled: "Disabled definitions remain saved but are skipped during polling.",
};

export function ProfileDialog({ open, onOpenChange, profile, onSave }) {
  const [form, setForm] = useState(() => profileToForm(profile));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(true);

  useEffect(() => {
    if (open) {
      setForm(profileToForm(profile));
      setError("");
    }
  }, [open, profile]);

  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const updateRegister = (index, field, value) => {
    setForm((current) => ({
      ...current,
      registers: current.registers.map((register, itemIndex) => {
        if (itemIndex !== index) return register;
        const next = { ...register, [field]: value };
        if (field === "dataType" && value !== "STRING") next.length = "";
        if (
          field === "registerType" &&
          ["COIL", "DISCRETE_INPUT"].includes(value)
        ) {
          next.dataType = "BIT";
          next.length = "";
        }
        if (
          field === "registerType" &&
          ["INPUT_REGISTER", "DISCRETE_INPUT"].includes(value)
        ) {
          next.writable = false;
        }
        return next;
      }),
    }));
  };

  const removeRegister = (index) => {
    setForm((current) => ({
      ...current,
      registers: current.registers.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSave(profilePayload(form), profile);
      onOpenChange(false);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] max-h-[100dvh] max-w-[1400px] overflow-y-auto rounded-none p-4 sm:h-auto sm:max-h-[94vh] sm:rounded-xl sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {profile ? "Edit register profile" : "Create register profile"}
          </DialogTitle>
          <DialogDescription>
            Define the physical Modbus map and decoding semantics used by
            polling.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <ErrorBanner message={error} />

          <button
            type="button"
            onClick={() => setShowHelp((current) => !current)}
            className="flex w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-semibold text-blue-900"
            aria-expanded={showHelp}
          >
            <CircleHelp className="h-4 w-4 shrink-0" />
            {showHelp ? "Hide form instructions" : "Show form instructions"}
          </button>

          {showHelp && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed text-slate-700">
              <p className="font-semibold text-slate-900">
                How to fill this profile
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  Copy the area, address, type, and byte order from the
                  manufacturer’s Modbus manual.
                </li>
                <li>
                  Use a unique key for every measurement. Numeric word lengths
                  are derived automatically.
                </li>
                <li>
                  Select ABCD, BADC, CDAB, or DCBA according to the device’s
                  byte and word order.
                </li>
                <li>
                  Use scale 1 and offset 0 when the raw decoded value needs no
                  conversion.
                </li>
              </ol>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Profile name" required hint={HELP.name}>
              <Input
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                required
              />
            </Field>
            <Field label="Identifier" required hint={HELP.identifier}>
              <Input
                value={form.identifier}
                onChange={(event) =>
                  set("identifier", event.target.value.toLowerCase())
                }
                required
              />
            </Field>
            <Field label="Manufacturer" hint={HELP.manufacturer}>
              <Input
                value={form.manufacturer}
                onChange={(event) => set("manufacturer", event.target.value)}
              />
            </Field>
            <Field label="Model" hint={HELP.model}>
              <Input
                value={form.model}
                onChange={(event) => set("model", event.target.value)}
              />
            </Field>
          </div>

          <Field label="Description" hint={HELP.description}>
            <textarea
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              className="form-textarea"
              rows="2"
            />
          </Field>

          <SwitchRow
            label="Profile active"
            description="Only active profiles can be assigned to devices."
            checked={form.isActive}
            onCheckedChange={(value) => set("isActive", value)}
          />

          <section className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold">Register definitions</h3>
                <p className="text-xs text-slate-500">
                  Fixed types derive word length; strings require a length.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full bg-white sm:w-auto"
                onClick={() =>
                  set("registers", [...form.registers, createRegister()])
                }
              >
                <CirclePlus className="h-4 w-4" />
                Add register
              </Button>
            </div>

            <div className="hidden grid-cols-[1.35fr_1.05fr_.65fr_1fr_.75fr_1.25fr_.5fr_.5fr_2.5rem] gap-3 border-b border-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 xl:grid">
              <span>Key / name</span>
              <span>Area</span>
              <span>Address</span>
              <span>Type / length</span>
              <span>Order</span>
              <span>Scale / offset / unit</span>
              <span>Write</span>
              <span>Enabled</span>
              <span />
            </div>

            <div className="divide-y divide-slate-200">
              {form.registers.map((register, index) => (
                <RegisterRow
                  key={register._id || index}
                  register={register}
                  index={index}
                  canRemove={form.registers.length > 1}
                  update={updateRegister}
                  remove={removeRegister}
                />
              ))}
            </div>
          </section>

          <DialogFooter className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {profile ? "Save profile" : "Create profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegisterRow({ register, index, canRemove, update, remove }) {
  const isString = register.dataType === "STRING";
  const isBitArea = ["COIL", "DISCRETE_INPUT"].includes(register.registerType);
  const isWritableArea = ["COIL", "HOLDING_REGISTER"].includes(
    register.registerType,
  );

  return (
    <div className="grid gap-4 bg-white p-4 xl:grid-cols-[1.35fr_1.05fr_.65fr_1fr_.75fr_1.25fr_.5fr_.5fr_2.5rem] xl:items-start xl:gap-3">
      <div>
        <MobileLabel>Key / name</MobileLabel>
        <div className="grid gap-2">
          <Input
            value={register.key}
            onChange={(event) => update(index, "key", event.target.value)}
            placeholder="line_voltage"
            required
            aria-label="Register key"
          />
          <Input
            value={register.name}
            onChange={(event) => update(index, "name", event.target.value)}
            placeholder="Line voltage"
            required
            aria-label="Register name"
          />
        </div>
        <HelpText>
          {HELP.key} {HELP.registerName}
        </HelpText>
      </div>

      <div>
        <MobileLabel>Area</MobileLabel>
        <Select
          value={register.registerType}
          onChange={(event) =>
            update(index, "registerType", event.target.value)
          }
          options={REGISTER_TYPES}
          aria-label="Register area"
        />
        <HelpText>{HELP.area}</HelpText>
      </div>

      <div>
        <MobileLabel>Address</MobileLabel>
        <Input
          type="number"
          min="0"
          max="65535"
          value={register.address}
          onChange={(event) => update(index, "address", event.target.value)}
          required
          aria-label="Register address"
        />
        <HelpText>{HELP.address}</HelpText>
      </div>

      <div>
        <MobileLabel>Type / length</MobileLabel>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          <Select
            value={register.dataType}
            onChange={(event) => update(index, "dataType", event.target.value)}
            options={isBitArea ? ["BIT"] : DATA_TYPES}
            aria-label="Register data type"
          />
          <Input
            type="number"
            min="1"
            max="125"
            value={register.length}
            onChange={(event) => update(index, "length", event.target.value)}
            placeholder={isString ? "Required" : "Automatic"}
            disabled={!isString}
            required={isString}
            aria-label="Register word length"
          />
        </div>
        <HelpText>
          {HELP.type} {HELP.length}
        </HelpText>
      </div>

      <div>
        <MobileLabel>Order</MobileLabel>
        <Select
          value={register.order}
          onChange={(event) => update(index, "order", event.target.value)}
          options={REGISTER_ORDER_OPTIONS}
          className="font-mono"
          aria-label="Byte and word order"
        />
        <HelpText>{HELP.order}</HelpText>
      </div>

      <div>
        <MobileLabel>Scale / offset / unit</MobileLabel>
        <div className="grid grid-cols-3 gap-2">
          <Input
            type="number"
            step="any"
            value={register.scaleFactor}
            onChange={(event) =>
              update(index, "scaleFactor", event.target.value)
            }
            placeholder="Scale"
            required
            aria-label="Scale factor"
          />
          <Input
            type="number"
            step="any"
            value={register.offset}
            onChange={(event) => update(index, "offset", event.target.value)}
            placeholder="Offset"
            required
            aria-label="Offset"
          />
          <Input
            value={register.unit}
            onChange={(event) => update(index, "unit", event.target.value)}
            placeholder="Unit"
            aria-label="Engineering unit"
          />
        </div>
        <HelpText>
          {HELP.scale} {HELP.offset} {HELP.unit}
        </HelpText>
      </div>

      <div className="flex items-center justify-between xl:min-h-9 xl:justify-start">
        <MobileLabel>Write-through</MobileLabel>
        <Switch
          checked={register.writable}
          disabled={!isWritableArea}
          onCheckedChange={(value) => update(index, "writable", value)}
          aria-label={`Allow writes to ${register.key || `register ${index + 1}`}`}
        />
        <span className="sr-only">{HELP.writable}</span>
      </div>

      <div className="flex items-center justify-between xl:min-h-9 xl:justify-start">
        <MobileLabel>Enabled</MobileLabel>
        <Switch
          checked={register.enabled}
          onCheckedChange={(value) => update(index, "enabled", value)}
          aria-label={`Enable ${register.key || `register ${index + 1}`}`}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!canRemove}
          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          onClick={() => remove(index)}
          aria-label={`Delete register ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function MobileLabel({ children }) {
  return (
    <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 xl:hidden">
      {children}
    </p>
  );
}

function HelpText({ children }) {
  return (
    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
      {children}
    </p>
  );
}
