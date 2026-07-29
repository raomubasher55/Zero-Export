import { Zap } from "lucide-react";

export function Brand({ compact = false }) {
  return (
    <div
      className={
        compact
          ? "flex items-center gap-2"
          : "flex items-center gap-3 border-b border-slate-100 px-5 py-5"
      }
    >
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-200">
        <Zap className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-bold tracking-tight">Zero Export</p>
        {!compact && (
          <p className="text-xs text-slate-500">Industrial EMS Core</p>
        )}
      </div>
    </div>
  );
}
