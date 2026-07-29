import { CircleHelp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function Field({ label, hint, required, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
        {hint && (
          <CircleHelp
            className="h-3.5 w-3.5 text-slate-400"
            aria-hidden="true"
          />
        )}
      </Label>
      {children}
      {hint && (
        <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>
      )}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  ...props
}) {
  const normalized = options.map((option) =>
    typeof option === "string"
      ? { value: option, label: option.replaceAll("_", " ") }
      : option,
  );

  return (
    <select
      value={value}
      onChange={onChange}
      className={`form-select ${className}`}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {normalized.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SwitchRow({ label, description, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}
