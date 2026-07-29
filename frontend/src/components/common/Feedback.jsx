import { CircleCheck, CircleX, Database, LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_STYLES } from "@/constants/modbus";

export function StatusBadge({ status }) {
  return (
    <Badge
      variant="outline"
      className={STATUS_STYLES[status] || STATUS_STYLES.UNKNOWN}
    >
      {status || "UNKNOWN"}
    </Badge>
  );
}

export function HealthDot({ healthy }) {
  return (
    <span
      className={`h-2.5 w-2.5 rounded-full ${healthy ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" : "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,.12)]"}`}
    />
  );
}

export function ErrorBanner({ message }) {
  return message ? (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
    >
      {message}
    </div>
  ) : null;
}

export function EmptyState({ title, description }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <Database className="h-7 w-7 text-slate-300" />
      <h3 className="mt-3 font-semibold text-slate-700">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="grid min-h-[420px] place-items-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <LoaderCircle className="h-7 w-7 animate-spin text-indigo-600" />
        <p className="text-sm">Loading operational data…</p>
      </div>
    </div>
  );
}

export function InlineLoader() {
  return (
    <div className="grid min-h-48 place-items-center">
      <LoaderCircle className="h-5 w-5 animate-spin text-indigo-600" />
    </div>
  );
}

export function ActionIcon({ label, children, destructive, onClick }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${destructive ? "text-rose-600 hover:bg-rose-50" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
    >
      {children}
    </button>
  );
}

export function Toast({ toast, onClose }) {
  const icon =
    toast.type === "error" ? (
      <CircleX className="h-4 w-4" />
    ) : (
      <CircleCheck className="h-4 w-4" />
    );
  return (
    <div
      role="status"
      className={`fixed bottom-5 right-5 z-[100] flex max-w-md items-start gap-3 rounded-xl border p-4 text-sm shadow-xl ${toast.type === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-white text-slate-800"}`}
    >
      <span
        className={
          toast.type === "error" ? "text-rose-600" : "text-emerald-600"
        }
      >
        {icon}
      </span>
      <p className="flex-1 font-medium">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        className="text-slate-400 hover:text-slate-700"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function KeyValue({ label, value, accent = "" }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${accent}`}>{value}</span>
    </div>
  );
}
