import {
  ArrowRightLeft,
  FileCog,
  Gauge,
  Network,
  Radio,
  RefreshCw,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HealthDot } from "@/components/common/Feedback";
import { Brand } from "./Brand";

const NAV_ITEMS = [
  { path: "/", label: "Operations", icon: Gauge, end: true },
  { path: "/devices", label: "Devices", icon: Network },
  { path: "/profiles", label: "Register profiles", icon: FileCog },
  { path: "/gateway", label: "Forwarding gateway", icon: ArrowRightLeft, end: true },
  { path: "/gateway/traffic", label: "Traffic analyzer", icon: Radio },
];

function pageTitle(pathname) {
  if (/^\/devices\/[^/]+/.test(pathname)) return "Device telemetry";
  if (pathname.startsWith("/devices")) return "Device fleet";
  if (pathname.startsWith("/profiles")) return "Register profiles";
  if (pathname.startsWith("/gateway/traffic")) return "Inverter request analyzer";
  if (pathname.startsWith("/gateway")) return "Modbus forwarding gateway";
  return "Operations center";
}

export function AppShell({
  health,
  scheduler,
  refreshing,
  onRefresh,
  children,
}) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-[#f7f9fc] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <Brand />
        <Navigation />
        <div className="m-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <HealthDot healthy={Boolean(health?.database?.connected)} />
            System health
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {health?.database?.connected
              ? "MongoDB ready"
              : "Backend unavailable"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {scheduler?.running
              ? `${scheduler.activePolls} active polls`
              : "Polling scheduler idle"}
          </p>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <div className="hidden lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Energy monitoring system
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              {pageTitle(pathname)}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:flex">
              <HealthDot healthy={Boolean(health?.database?.connected)} />
              {health?.database?.connected ? "Core online" : "Core offline"}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </header>

        <div className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <Navigation mobile />
        </div>

        <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function Navigation({ mobile = false }) {
  return (
    <nav
      className={
        mobile ? "flex gap-1 overflow-x-auto" : "flex-1 space-y-1 px-3 py-5"
      }
    >
      {NAV_ITEMS.map(({ path, label, icon: Icon, end }) => (
        <NavLink
          key={path}
          to={path}
          end={end}
          className={({ isActive }) =>
            mobile
              ? `flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${isActive ? "bg-slate-900 text-white" : "text-slate-600"}`
              : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${isActive ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`
          }
        >
          <Icon className={mobile ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
