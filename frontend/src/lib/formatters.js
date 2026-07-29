import { ApiError } from "@/lib/api";

export function optionalText(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function formatCountdown(value) {
  if (!value) return "Not scheduled";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "Due now";
  if (seconds < 60) return `in ${seconds}s`;
  if (seconds < 3600) return `in ${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `in ${Math.ceil(seconds / 3600)}h`;
  return `in ${Math.ceil(seconds / 86400)}d`;
}

export function formatRelative(value) {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 15) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function formatValue(value) {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 6,
    }).format(value);
  }
  return value ?? "—";
}

export function getErrorMessage(error) {
  if (error instanceof ApiError) {
    const detail = error.details?.[0]?.message;
    return detail ? `${error.message} ${detail}` : error.message;
  }
  return error?.message || "An unexpected error occurred.";
}
