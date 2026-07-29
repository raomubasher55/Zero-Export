<<<<<<< HEAD
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleHelp,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const AREAS = [
  ['holding', 'Holding registers'],
  ['input', 'Input registers'],
  ['coil', 'Coils'],
  ['discrete', 'Discrete inputs'],
];

const TYPES = ['INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'INT64', 'UINT64', 'FLOAT64', 'STRING'];
const ORDERS = ['ABCD', 'BADC', 'CDAB', 'DCBA'];
const FIXED_LENGTHS = {
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  FLOAT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT64: 4,
};

const HELP = {
  name: 'A readable name shown when selecting this profile.',
  identifier: 'A unique, stable key used by the API and device assignments. Use letters, numbers, hyphens, or underscores.',
  manufacturer: 'The company that manufactures the meter or device.',
  model: 'The exact device model this register map supports.',
  description: 'Optional notes about the profile, firmware, or supported configuration.',
  active: 'Only active profiles can be assigned to devices.',
  key: 'Unique measurement key, for example L_L1, voltage_l1, or total_kwh.',
  area: 'The Modbus memory area defined in the device manual.',
  address: 'The zero-based register address. If the manual uses 40001 notation, verify whether an offset must be removed.',
  type: 'How the raw register words are decoded. Fixed numeric types set their word length automatically.',
  length: 'Number of 16-bit Modbus words. It is automatic for numeric types and editable for strings.',
  order: 'Byte/word order: ABCD is normal big-endian, BADC swaps bytes, CDAB swaps 16-bit words, and DCBA reverses both.',
  scale: 'Optional multiplier applied after decoding. Use 1 for no scaling, 0.1 to divide by 10, or leave blank for 1.',
  unit: 'Display or engineering unit, such as V, A, Hz, kW, or kWh.',
  enabled: 'Disabled definitions remain saved but are not polled.',
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const initialProfile = {
  id: 'profile-em500',
  name: 'Rozwell (EM500)',
  identifier: 'em500',
  manufacturer: 'Rozwell',
  model: 'EM500',
  description: 'Rozwell EM500 energy meter register map.',
  active: true,
  registers: [
    {
      id: 'register-l-l1',
      key: 'L_L1',
      area: 'input',
      address: '2',
      type: 'INT32',
      length: '2',
      order: 'ABCD',
      scale: '1',
      unit: 'A',
      enabled: true,
    },
  ],
};

function HelpLabel({ htmlFor, children, help, required = false }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-slate-800">
      {children}
      {required && <span className="text-rose-500" aria-label="required">*</span>}
      <span className="group relative inline-flex" tabIndex="0" aria-label={help}>
        <CircleHelp className="h-3.5 w-3.5 cursor-help text-slate-400" aria-hidden="true" />
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-64 -translate-x-1/2 rounded-md bg-slate-950 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-xl group-hover:block group-focus-within:block">
          {help}
        </span>
      </span>
    </label>
  );
}

function FieldError({ children }) {
  return children ? <p className="mt-1 text-xs text-rose-600">{children}</p> : null;
}

function RegisterEditor({ profile, onCancel, onSave }) {
  const [form, setForm] = useState(() => structuredClone(profile));
  const [errors, setErrors] = useState({});
  const [showInstructions, setShowInstructions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const updateRegister = (id, field, value) => {
    setForm((current) => ({
      ...current,
      registers: current.registers.map((register) => {
        if (register.id !== id) return register;
        if (field === 'type') {
          return {
            ...register,
            type: value,
            length: value === 'STRING' ? register.length || '1' : String(FIXED_LENGTHS[value]),
          };
        }
        return { ...register, [field]: value };
      }),
    }));
  };

  const addRegister = () => {
    setForm((current) => ({
      ...current,
      registers: [
        ...current.registers,
        {
          id: makeId(), key: '', area: 'holding', address: '', type: 'INT16',
          length: '1', order: 'ABCD', scale: '1', unit: '', enabled: true,
        },
      ],
    }));
  };

  const removeRegister = (id) => {
    setForm((current) => ({
      ...current,
      registers: current.registers.filter((register) => register.id !== id),
    }));
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Profile name is required.';
    if (!form.identifier.trim()) next.identifier = 'Identifier is required.';
    else if (!/^[a-zA-Z0-9_-]+$/.test(form.identifier)) next.identifier = 'Use only letters, numbers, hyphens, and underscores.';

    const keys = new Set();
    form.registers.forEach((register, index) => {
      const row = {};
      if (!register.key.trim()) row.key = 'Key is required.';
      else if (keys.has(register.key.trim())) row.key = 'Key must be unique.';
      keys.add(register.key.trim());
      if (register.address === '' || !Number.isInteger(Number(register.address)) || Number(register.address) < 0) row.address = 'Enter a whole number of 0 or greater.';
      if (!Number.isInteger(Number(register.length)) || Number(register.length) < 1) row.length = 'Length must be at least 1.';
      if (register.scale !== '' && !Number.isFinite(Number(register.scale))) row.scale = 'Scale must be a number.';
      if (Object.keys(row).length) next[`register-${index}`] = row;
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError('');
    try {
      await onSave(form);
    } catch (error) {
      setServerError(error.message || 'The backend could not save this profile.');
      setSubmitting(false);
    }
  };
=======
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  CircleX,
  Clock3,
  Database,
  FileCog,
  Gauge,
  LoaderCircle,
  Network,
  Pencil,
  Play,
  Plug,
  Power,
  RefreshCw,
  Send,
  Server,
  Settings2,
  Terminal,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';

const DEVICE_STATUSES = ['UNKNOWN', 'ONLINE', 'OFFLINE', 'TIMEOUT', 'ERROR'];
const REGISTER_TYPES = ['HOLDING_REGISTER', 'INPUT_REGISTER', 'COIL', 'DISCRETE_INPUT'];
const DATA_TYPES = ['INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'FLOAT64', 'STRING', 'BIT'];
const ORDER_OPTIONS = ['BIG_ENDIAN', 'LITTLE_ENDIAN'];

const statusStyle = {
  ONLINE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  OFFLINE: 'border-slate-200 bg-slate-100 text-slate-600',
  TIMEOUT: 'border-amber-200 bg-amber-50 text-amber-700',
  ERROR: 'border-rose-200 bg-rose-50 text-rose-700',
  UNKNOWN: 'border-indigo-200 bg-indigo-50 text-indigo-700',
};

const outcomeStyle = {
  SUCCESS: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PARTIAL_SUCCESS: 'border-amber-200 bg-amber-50 text-amber-700',
  FAILURE: 'border-rose-200 bg-rose-50 text-rose-700',
};

function optionalText(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function formatRelative(value) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 15) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
  }
  return value ?? '—';
}

function getErrorMessage(error) {
  if (error instanceof ApiError) {
    const detail = error.details?.[0]?.message;
    return detail ? `${error.message} ${detail}` : error.message;
  }
  return error?.message || 'An unexpected error occurred.';
}

function StatusBadge({ status }) {
  return <Badge variant="outline" className={statusStyle[status] || statusStyle.UNKNOWN}>{status || 'UNKNOWN'}</Badge>;
}

function HealthDot({ healthy }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${healthy ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]' : 'bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,.12)]'}`} />;
}

function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [devices, setDevices] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [health, setHealth] = useState(null);
  const [scheduler, setScheduler] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backendError, setBackendError] = useState('');
  const [toast, setToast] = useState(null);
  const [deviceDialog, setDeviceDialog] = useState({ open: false, device: null });
  const [profileDialog, setProfileDialog] = useState({ open: false, profile: null });
  const [monitorDevice, setMonitorDevice] = useState(null);
  const [deviceSearch, setDeviceSearch] = useState('');

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);
>>>>>>> origin/main

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const refresh = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    else setRefreshing(true);

    const results = await Promise.allSettled([
      api.getHealth(),
      api.listDevices({ limit: 100 }),
      api.listRegisterProfiles({ limit: 100 }),
      api.getPollingStatus(),
    ]);

    const [healthResult, devicesResult, profilesResult, schedulerResult] = results;
    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
      setBackendError('');
    } else {
      setHealth(null);
      setBackendError(getErrorMessage(healthResult.reason));
    }
    if (devicesResult.status === 'fulfilled') setDevices(devicesResult.value.data || []);
    if (profilesResult.status === 'fulfilled') setProfiles(profilesResult.value.data || []);
    if (schedulerResult.status === 'fulfilled') setScheduler(schedulerResult.value.data);

    if (initial) setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh({ initial: true });
  }, [refresh]);

  const perform = async (action, successMessage, { refreshAfter = true } = {}) => {
    try {
      const result = await action();
      if (successMessage) notify(successMessage);
      if (refreshAfter) await refresh();
      return result;
    } catch (error) {
      notify(getErrorMessage(error), 'error');
      throw error;
    }
  };

  const filteredDevices = useMemo(() => {
    const needle = deviceSearch.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter((device) => [device.name, device.identifier, device.site, device.status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)));
  }, [devices, deviceSearch]);

  const stats = useMemo(() => ({
    total: devices.length,
    online: devices.filter((device) => device.status === 'ONLINE').length,
    alerting: devices.filter((device) => ['ERROR', 'TIMEOUT', 'OFFLINE'].includes(device.status)).length,
    profiles: profiles.filter((profile) => profile.isActive).length,
  }), [devices, profiles]);

  const navItems = [
    { id: 'dashboard', label: 'Operations', icon: Gauge },
    { id: 'devices', label: 'Devices', icon: Network },
    { id: 'profiles', label: 'Register profiles', icon: FileCog },
  ];

  const openMonitor = (device) => {
    setMonitorDevice(device);
    setActiveView('monitor');
  };

  const saveDevice = async (payload, device) => {
    await perform(
      () => device ? api.updateDevice(device._id, payload) : api.createDevice(payload),
      device ? 'Device configuration saved.' : 'Device created.',
    );
  };

  const saveProfile = async (payload, profile) => {
    await perform(
      () => profile ? api.updateRegisterProfile(profile._id, payload) : api.createRegisterProfile(payload),
      profile ? 'Register profile saved.' : 'Register profile created.',
    );
  };

  const deleteDevice = async (device) => {
    if (!window.confirm(`Delete “${device.name}”? This also releases its active connection.`)) return;
    await perform(() => api.deleteDevice(device._id), 'Device deleted.');
    if (monitorDevice?._id === device._id) {
      setMonitorDevice(null);
      setActiveView('devices');
    }
  };

  const deleteProfile = async (profile) => {
    if (!window.confirm(`Delete “${profile.name}”? Profiles assigned to devices cannot be deleted.`)) return;
    await perform(() => api.deleteRegisterProfile(profile._id), 'Register profile deleted.');
  };

  return (
<<<<<<< HEAD
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-0 sm:p-4" role="presentation">
      <form onSubmit={submit} className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:max-w-[1320px] sm:rounded-xl" aria-labelledby="profile-dialog-title">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-4 sm:px-7 sm:py-5">
          <div>
            <h2 id="profile-dialog-title" className="text-xl font-bold text-slate-950">Edit register profile</h2>
            <p className="mt-1 text-sm text-slate-500">Define the physical Modbus map and decoding semantics used by polling.</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close editor">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7">
          <button type="button" onClick={() => setShowInstructions((value) => !value)} className="mb-4 flex w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-semibold text-blue-900">
            <CircleHelp className="h-4 w-4 shrink-0" />
            {showInstructions ? 'Hide form instructions' : 'Show form instructions'}
          </button>
          {showInstructions && (
            <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed text-slate-700">
              <p className="font-semibold text-slate-900">How to fill this profile</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Copy addresses, data types, and byte order from the manufacturer’s Modbus register manual.</li>
                <li>Give every register a unique key. Numeric types set their word length automatically.</li>
                <li>Select <strong>ABCD</strong>, <strong>BADC</strong>, <strong>CDAB</strong>, or <strong>DCBA</strong> exactly as required by the device.</li>
                <li>Use scale <strong>1</strong> when no conversion is needed, then add the engineering unit.</li>
              </ol>
              <p className="mt-2 text-xs text-slate-500">Hover or focus the <CircleHelp className="inline h-3.5 w-3.5" /> icon beside any label for field-specific help.</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <HelpLabel htmlFor="profile-name" help={HELP.name} required>Profile name</HelpLabel>
              <input id="profile-name" className="form-control" value={form.name} onChange={(e) => updateField('name', e.target.value)} aria-invalid={Boolean(errors.name)} />
              <FieldError>{errors.name}</FieldError>
            </div>
            <div>
              <HelpLabel htmlFor="profile-identifier" help={HELP.identifier} required>Identifier</HelpLabel>
              <input id="profile-identifier" className="form-control" value={form.identifier} onChange={(e) => updateField('identifier', e.target.value)} aria-invalid={Boolean(errors.identifier)} />
              <FieldError>{errors.identifier}</FieldError>
            </div>
            <div>
              <HelpLabel htmlFor="profile-manufacturer" help={HELP.manufacturer}>Manufacturer</HelpLabel>
              <input id="profile-manufacturer" className="form-control" value={form.manufacturer} onChange={(e) => updateField('manufacturer', e.target.value)} />
            </div>
            <div>
              <HelpLabel htmlFor="profile-model" help={HELP.model}>Model</HelpLabel>
              <input id="profile-model" className="form-control" value={form.model} onChange={(e) => updateField('model', e.target.value)} />
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <HelpLabel htmlFor="profile-description" help={HELP.description}>Description</HelpLabel>
              <textarea id="profile-description" rows="2" className="form-control min-h-20 resize-y" value={form.description} onChange={(e) => updateField('description', e.target.value)} />
            </div>
=======
    <div className="min-h-screen bg-[#f7f9fc] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <Brand />
        <nav className="flex-1 space-y-1 px-3 py-5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setActiveView(id); setMonitorDevice(null); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${activeView === id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="m-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <HealthDot healthy={Boolean(health?.database?.connected)} />
            System health
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {health?.database?.connected ? 'MongoDB ready' : 'Backend unavailable'}
          </p>
          <p className="mt-1 text-xs text-slate-500">{scheduler?.running ? `${scheduler.activePolls} active polls` : 'Polling scheduler idle'}</p>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3 lg:hidden"><Brand compact /></div>
          <div className="hidden lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Energy monitoring system</p>
            <h1 className="text-lg font-semibold tracking-tight">{activeView === 'monitor' ? 'Device telemetry' : activeView === 'profiles' ? 'Register profiles' : activeView === 'devices' ? 'Device fleet' : 'Operations center'}</h1>
>>>>>>> origin/main
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:flex">
              <HealthDot healthy={Boolean(health?.database?.connected)} />
              {health?.database?.connected ? 'Core online' : 'Core offline'}
            </div>
            <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </header>

<<<<<<< HEAD
          <div className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
            <div>
              <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">Profile active <CircleHelp className="h-3.5 w-3.5 text-slate-400" aria-label={HELP.active} /></div>
              <p className="mt-1 text-xs text-slate-500">Only active profiles can be assigned to devices.</p>
            </div>
            <Switch checked={form.active} onCheckedChange={(value) => updateField('active', value)} aria-label="Profile active" />
          </div>

          <section className="mt-5 overflow-hidden rounded-xl border border-slate-200" aria-labelledby="register-heading">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 id="register-heading" className="font-bold text-slate-950">Register definitions</h3>
                <p className="mt-0.5 text-xs text-slate-500">Fixed types derive word length; strings require a length.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addRegister} className="w-full bg-white sm:w-auto">
                <Plus className="mr-1.5 h-4 w-4" /> Add register
              </Button>
            </div>

            <div className="hidden grid-cols-[1.35fr_1.25fr_.85fr_.82fr_1fr_1.25fr_.8fr_40px] gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 lg:grid">
              <HeaderHelp label="Key / name" help={HELP.key} />
              <HeaderHelp label="Area" help={HELP.area} />
              <HeaderHelp label="Address" help={HELP.address} />
              <HeaderHelp label="Type / length" help={`${HELP.type} ${HELP.length}`} />
              <HeaderHelp label="Order" help={HELP.order} />
              <HeaderHelp label="Scale / unit" help={`${HELP.scale} ${HELP.unit}`} />
              <HeaderHelp label="Enabled" help={HELP.enabled} />
              <span />
            </div>

            <div className="divide-y divide-slate-200">
              {form.registers.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No registers yet. Select “Add register” to create one.</p>}
              {form.registers.map((register, index) => (
                <RegisterRow key={register.id} register={register} index={index} error={errors[`register-${index}`]} update={updateRegister} remove={removeRegister} />
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-7">
          {serverError && <p role="alert" className="mb-3 text-sm font-medium text-rose-600 sm:text-right">{serverError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}><Save className="mr-2 h-4 w-4" />{submitting ? 'Saving…' : 'Save profile'}</Button>
          </div>
        </div>
      </form>
=======
        <div className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <div className="flex gap-1 overflow-x-auto">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => { setActiveView(id); setMonitorDevice(null); }} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${activeView === id ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8 lg:py-8">
          {backendError && (
            <div className="mb-6 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><strong>Backend connection unavailable.</strong> {backendError} Start the API and MongoDB, then refresh this dashboard.</div>
            </div>
          )}

          {loading ? <LoadingScreen /> : (
            <>
              {activeView === 'dashboard' && <Dashboard stats={stats} devices={devices} scheduler={scheduler} onOpenDevice={openMonitor} onCreate={() => setDeviceDialog({ open: true, device: null })} />}
              {activeView === 'devices' && (
                <DevicesView
                  devices={filteredDevices}
                  profiles={profiles}
                  search={deviceSearch}
                  onSearch={setDeviceSearch}
                  onCreate={() => setDeviceDialog({ open: true, device: null })}
                  onEdit={(device) => setDeviceDialog({ open: true, device })}
                  onDelete={deleteDevice}
                  onOpen={openMonitor}
                  onConnect={(device) => perform(() => api.connectDevice(device._id), `${device.name} connected.`)}
                  onPoll={(device) => perform(() => api.pollDevice(device._id), `${device.name} poll completed.`)}
                />
              )}
              {activeView === 'profiles' && (
                <ProfilesView
                  profiles={profiles}
                  onCreate={() => setProfileDialog({ open: true, profile: null })}
                  onEdit={(profile) => setProfileDialog({ open: true, profile })}
                  onDelete={deleteProfile}
                />
              )}
              {activeView === 'monitor' && monitorDevice && (
                <DeviceMonitor
                  device={devices.find((item) => item._id === monitorDevice._id) || monitorDevice}
                  onBack={() => setActiveView('devices')}
                  onRefresh={refresh}
                  notify={notify}
                />
              )}
            </>
          )}
        </div>
      </main>

      <DeviceDialog
        open={deviceDialog.open}
        onOpenChange={(open) => setDeviceDialog((current) => ({ ...current, open }))}
        device={deviceDialog.device}
        profiles={profiles}
        onSave={saveDevice}
      />
      <ProfileDialog
        open={profileDialog.open}
        onOpenChange={(open) => setProfileDialog((current) => ({ ...current, open }))}
        profile={profileDialog.profile}
        onSave={saveProfile}
      />
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
>>>>>>> origin/main
    </div>
  );
}

<<<<<<< HEAD
function HeaderHelp({ label, help }) {
  return <span className="flex items-center gap-1" title={help}>{label}<CircleHelp className="h-3 w-3" /></span>;
}

function MobileLabel({ children, help }) {
  return <span className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500 lg:hidden" title={help}>{children}<CircleHelp className="h-3 w-3" /></span>;
}

function RegisterRow({ register, index, error = {}, update, remove }) {
  const prefix = `register-${index}`;
  return (
    <div className="grid gap-4 bg-white p-4 lg:grid-cols-[1.35fr_1.25fr_.85fr_.82fr_1fr_1.25fr_.8fr_40px] lg:items-start lg:gap-3">
      <div>
        <MobileLabel help={HELP.key}>Key / name</MobileLabel>
        <input id={`${prefix}-key`} className="form-control" placeholder="e.g. voltage_l1" value={register.key} onChange={(e) => update(register.id, 'key', e.target.value)} aria-label="Register key" aria-invalid={Boolean(error.key)} />
        <FieldError>{error.key}</FieldError>
      </div>
      <div>
        <MobileLabel help={HELP.area}>Area</MobileLabel>
        <select className="form-control" value={register.area} onChange={(e) => update(register.id, 'area', e.target.value)} aria-label="Register area">
          {AREAS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div>
        <MobileLabel help={HELP.address}>Address</MobileLabel>
        <input className="form-control" inputMode="numeric" type="number" min="0" step="1" value={register.address} onChange={(e) => update(register.id, 'address', e.target.value)} aria-label="Register address" aria-invalid={Boolean(error.address)} />
        <FieldError>{error.address}</FieldError>
      </div>
      <div>
        <MobileLabel help={`${HELP.type} ${HELP.length}`}>Type / length</MobileLabel>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          <select className="form-control" value={register.type} onChange={(e) => update(register.id, 'type', e.target.value)} aria-label="Data type">
            {TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <input className="form-control" type="number" min="1" step="1" value={register.length} disabled={register.type !== 'STRING'} onChange={(e) => update(register.id, 'length', e.target.value)} aria-label="Word length" aria-invalid={Boolean(error.length)} />
        </div>
        <FieldError>{error.length}</FieldError>
      </div>
      <div>
        <MobileLabel help={HELP.order}>Order</MobileLabel>
        <select className="form-control font-mono" value={register.order} onChange={(e) => update(register.id, 'order', e.target.value)} aria-label="Byte and word order">
          {ORDERS.map((order) => <option key={order}>{order}</option>)}
        </select>
        <p className="mt-1 text-[11px] text-slate-400">Byte/word sequence</p>
      </div>
      <div>
        <MobileLabel help={`${HELP.scale} ${HELP.unit}`}>Scale / unit</MobileLabel>
        <div className="grid grid-cols-2 gap-2">
          <input className="form-control" inputMode="decimal" placeholder="Scale" value={register.scale} onChange={(e) => update(register.id, 'scale', e.target.value)} aria-label="Scale" aria-invalid={Boolean(error.scale)} />
          <input className="form-control" placeholder="Unit" value={register.unit} onChange={(e) => update(register.id, 'unit', e.target.value)} aria-label="Unit" />
        </div>
        <FieldError>{error.scale}</FieldError>
      </div>
      <div className="flex items-center justify-between lg:min-h-10 lg:justify-start">
        <MobileLabel help={HELP.enabled}>Enabled</MobileLabel>
        <Switch checked={register.enabled} onCheckedChange={(value) => update(register.id, 'enabled', value)} aria-label={`Enable register ${register.key || index + 1}`} />
      </div>
      <div className="flex justify-end lg:pt-1">
        <button type="button" onClick={() => remove(register.id)} className="inline-flex items-center gap-2 rounded-md p-2 text-sm text-rose-500 hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete register ${register.key || index + 1}`}>
          <Trash2 className="h-4 w-4" /><span className="lg:hidden">Delete register</span>
        </button>
=======
function Brand({ compact = false }) {
  return (
    <div className={compact ? 'flex items-center gap-2' : 'flex items-center gap-3 border-b border-slate-100 px-5 py-5'}>
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-200"><Zap className="h-5 w-5" /></div>
      <div>
        <p className="text-sm font-bold tracking-tight">Zero Export</p>
        {!compact && <p className="text-xs text-slate-500">Industrial EMS Core</p>}
>>>>>>> origin/main
      </div>
    </div>
  );
}

<<<<<<< HEAD
function createBlankProfile() {
  return {
    id: makeId(), name: '', identifier: '', manufacturer: '', model: '', description: '',
    active: true, registers: [],
  };
}

function loadProfiles() {
  try {
    const stored = localStorage.getItem('zero-export-register-profiles');
    return stored ? JSON.parse(stored) : [initialProfile];
  } catch {
    return [initialProfile];
  }
}

function App() {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [editing, setEditing] = useState(() => profiles[0] || createBlankProfile());
  const [saved, setSaved] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/register-profiles')
      .then(async (response) => {
        if (!response.ok) throw new Error('The profile API could not be loaded.');
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setProfiles(data);
        localStorage.setItem('zero-export-register-profiles', JSON.stringify(data));
        setApiError('');
      })
      .catch(() => {
        if (active) setApiError('Backend unavailable. Showing the last locally cached profiles; saving is disabled until it reconnects.');
      });
    return () => { active = false; };
  }, []);

  const saveProfile = async (updated) => {
    const exists = profiles.some((profile) => profile.id === updated.id);
    try {
      const response = await fetch(`/api/register-profiles${exists ? `/${updated.id}` : ''}`, {
        method: exists ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The profile could not be saved.');

      const next = exists
        ? profiles.map((profile) => profile.id === result.id ? result : profile)
        : [...profiles, result];
      setProfiles(next);
      localStorage.setItem('zero-export-register-profiles', JSON.stringify(next));
      setEditing(null);
      setApiError('');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      setApiError(error.message || 'The backend could not save this profile.');
      throw error;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-bold text-slate-950">Register profiles</h1>
            <p className="mt-0.5 text-sm text-slate-500">Manage Modbus maps used by your devices.</p>
          </div>
          <Button onClick={() => setEditing(createBlankProfile())}><Plus className="mr-2 h-4 w-4" />New profile</Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        {saved && <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" />Profile saved to the backend successfully.</div>}
        {apiError && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{apiError}</div>}
        <div className="space-y-3">
          {profiles.map((profile) => (
            <div key={profile.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-slate-950">{profile.name}</h2><Badge variant={profile.active ? 'default' : 'secondary'}>{profile.active ? 'Active' : 'Inactive'}</Badge></div>
                  <p className="mt-1 text-sm text-slate-500">{[profile.manufacturer, profile.model].filter(Boolean).join(' ')} · {profile.registers.length} register{profile.registers.length === 1 ? '' : 's'}</p>
                </div>
                <Button variant="outline" onClick={() => setEditing(profile)}><Pencil className="mr-2 h-4 w-4" />Edit profile</Button>
              </div>
            </div>
          ))}
          {profiles.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No register profiles yet.</div>}
        </div>
      </main>
      {editing && <RegisterEditor profile={editing} onCancel={() => setEditing(null)} onSave={saveProfile} />}
=======
function LoadingScreen() {
  return <div className="grid min-h-[420px] place-items-center"><div className="flex flex-col items-center gap-3 text-slate-500"><LoaderCircle className="h-7 w-7 animate-spin text-indigo-600" /><p className="text-sm">Loading operational data…</p></div></div>;
}

function Dashboard({ stats, devices, scheduler, onOpenDevice, onCreate }) {
  const recentDevices = [...devices].sort((left, right) => new Date(right.lastCommunicationAt || 0) - new Date(left.lastCommunicationAt || 0)).slice(0, 6);
  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-medium text-indigo-600">Live fleet visibility</p><h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Energy operations at a glance</h2><p className="mt-2 max-w-2xl text-sm text-slate-500">Manage field connections, run decoded polls, and inspect durable telemetry from one workspace.</p></div>
        <Button onClick={onCreate}><CirclePlus className="h-4 w-4" />Add device</Button>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Network} label="Configured devices" value={stats.total} hint="All managed endpoints" color="indigo" />
        <MetricCard icon={Wifi} label="Online now" value={stats.online} hint={`${stats.total ? Math.round((stats.online / stats.total) * 100) : 0}% fleet availability`} color="emerald" />
        <MetricCard icon={AlertTriangle} label="Needs attention" value={stats.alerting} hint="Offline, timeout, or error" color="amber" />
        <MetricCard icon={FileCog} label="Active profiles" value={stats.profiles} hint="Reusable decoding maps" color="blue" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.8fr]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100 py-5"><div><CardTitle>Recent device communication</CardTitle><CardDescription>Latest status known by the Modbus core</CardDescription></div><Activity className="h-5 w-5 text-indigo-500" /></CardHeader>
          <CardContent className="p-0">
            {recentDevices.length === 0 ? <EmptyState title="No devices yet" description="Create a device and assign an active register profile to begin collecting telemetry." /> : (
              <div className="divide-y divide-slate-100">
                {recentDevices.map((device) => <button key={device._id} type="button" onClick={() => onOpenDevice(device)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50"><div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><Server className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{device.name}</p><p className="truncate text-xs text-slate-500">{device.connection?.protocol} · {device.connection?.host || device.connection?.serialPath}</p></div><div className="hidden text-right sm:block"><p className="text-xs text-slate-500">{formatRelative(device.lastCommunicationAt)}</p><p className="mt-1 text-xs text-slate-400">{device.statistics?.successfulPolls || 0} successful polls</p></div><StatusBadge status={device.status} /><ChevronRight className="h-4 w-4 text-slate-400" /></button>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-indigo-500" />Scheduler</CardTitle><CardDescription>Local worker state and poll capacity</CardDescription></CardHeader>
          <CardContent className="space-y-4"><KeyValue label="Worker state" value={scheduler?.running ? 'Running' : 'Idle'} accent={scheduler?.running ? 'text-emerald-600' : 'text-slate-600'} /><KeyValue label="Active polls" value={`${scheduler?.activePolls ?? 0} / ${scheduler?.concurrency ?? '—'}`} /><KeyValue label="Tick interval" value={scheduler?.tickIntervalMs ? `${scheduler.tickIntervalMs} ms` : '—'} /><KeyValue label="Last cycle" value={formatRelative(scheduler?.lastCycleAt)} />{scheduler?.lastError && <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs text-rose-700">{scheduler.lastError.message}</div>}</CardContent>
        </Card>
      </div>
>>>>>>> origin/main
    </div>
  );
}

<<<<<<< HEAD
=======
function MetricCard({ icon: Icon, label, value, hint, color }) {
  const colorClasses = { indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', blue: 'bg-blue-50 text-blue-600' };
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight">{value}</p></div><div className={`grid h-10 w-10 place-items-center rounded-xl ${colorClasses[color]}`}><Icon className="h-5 w-5" /></div></div><p className="mt-4 text-xs text-slate-500">{hint}</p></CardContent></Card>;
}

function KeyValue({ label, value, accent = '' }) { return <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0"><span className="text-slate-500">{label}</span><span className={`font-semibold ${accent}`}>{value}</span></div>; }

function DevicesView({ devices, profiles, search, onSearch, onCreate, onEdit, onDelete, onOpen, onConnect, onPoll }) {
  return <div className="space-y-6"><section className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-sm font-medium text-indigo-600">Field asset registry</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Devices</h2><p className="mt-2 text-sm text-slate-500">Manage TCP and RTU endpoints, assigned profiles, polling policy, and live operations.</p></div><Button onClick={onCreate}><CirclePlus className="h-4 w-4" />Add device</Button></section><Card><CardHeader className="gap-4 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Fleet</CardTitle><CardDescription>{devices.length} matching devices</CardDescription></div><Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, identifier, site, status…" className="max-w-xs" /></CardHeader><CardContent className="p-0">{devices.length === 0 ? <EmptyState title="No matching devices" description={profiles.length ? 'Add a device or adjust your search query.' : 'Create an active register profile first, then add a device.'} /> : <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Device</th><th className="px-4 py-3 font-semibold">Transport</th><th className="px-4 py-3 font-semibold">Profile</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last communication</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{devices.map((device) => <tr key={device._id} className="hover:bg-slate-50"><td className="px-5 py-4"><button type="button" onClick={() => onOpen(device)} className="text-left"><p className="font-semibold hover:text-indigo-600">{device.name}</p><p className="mt-0.5 font-mono text-xs text-slate-500">{device.identifier} · unit {device.unitId}</p></button></td><td className="px-4 py-4"><p className="font-medium">{device.connection?.protocol}</p><p className="mt-0.5 text-xs text-slate-500">{device.connection?.host ? `${device.connection.host}:${device.connection.port}` : device.connection?.serialPath}</p></td><td className="px-4 py-4 text-xs text-slate-600">{device.registerProfile?.name || <span className="text-amber-600">No profile</span>}</td><td className="px-4 py-4"><StatusBadge status={device.status} /></td><td className="px-4 py-4"><p>{formatRelative(device.lastCommunicationAt)}</p><p className="mt-0.5 text-xs text-slate-500">{device.statistics?.consecutiveFailures || 0} consecutive failures</p></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><ActionIcon label="Connect" onClick={() => { void onConnect(device).catch(() => undefined); }}><Plug className="h-4 w-4" /></ActionIcon><ActionIcon label="Poll" onClick={() => { void onPoll(device).catch(() => undefined); }}><Play className="h-4 w-4" /></ActionIcon><ActionIcon label="Edit" onClick={() => onEdit(device)}><Pencil className="h-4 w-4" /></ActionIcon><ActionIcon label="Delete" destructive onClick={() => { void onDelete(device).catch(() => undefined); }}><Trash2 className="h-4 w-4" /></ActionIcon></div></td></tr>)}</tbody></table></div>}</CardContent></Card></div>;
}

function ProfilesView({ profiles, onCreate, onEdit, onDelete }) {
  return <div className="space-y-6"><section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-indigo-600">Decoding library</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Register profiles</h2><p className="mt-2 text-sm text-slate-500">Maintain reusable Modbus maps, data types, byte/word order, and scaling rules.</p></div><Button onClick={onCreate}><CirclePlus className="h-4 w-4" />New profile</Button></section><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{profiles.length === 0 ? <Card className="md:col-span-2 xl:col-span-3"><EmptyState title="No register profiles" description="Create a decoding profile before assigning it to a field device." /></Card> : profiles.map((profile) => <Card key={profile._id} className="flex flex-col"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{profile.name}</CardTitle><CardDescription className="mt-1 font-mono">{profile.identifier}</CardDescription></div><Badge variant="outline" className={profile.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}>{profile.isActive ? 'Active' : 'Inactive'}</Badge></div></CardHeader><CardContent className="flex flex-1 flex-col"><div className="space-y-2 text-sm"><KeyValue label="Registers" value={profile.registers?.length || 0} /><KeyValue label="Manufacturer" value={profile.manufacturer || '—'} /><KeyValue label="Model" value={profile.model || '—'} /></div><div className="mt-5 flex gap-2"><Button className="flex-1" variant="outline" size="sm" onClick={() => onEdit(profile)}><Pencil className="h-3.5 w-3.5" />Edit</Button><Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => { void onDelete(profile).catch(() => undefined); }}><Trash2 className="h-4 w-4" /></Button></div></CardContent></Card>)}</div></div>;
}

function DeviceMonitor({ device, onBack, onRefresh, notify }) {
  const [connection, setConnection] = useState(null);
  const [values, setValues] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.getConnection(device._id),
      api.listLatestValues(device._id, { limit: 100 }),
      api.listCommunicationLogs(device._id, { limit: 12 }),
    ]);
    if (results[0].status === 'fulfilled') setConnection(results[0].value.data);
    if (results[1].status === 'fulfilled') setValues(results[1].value.data || []);
    if (results[2].status === 'fulfilled') setLogs(results[2].value.data || []);
    const rejected = results.find((result) => result.status === 'rejected');
    setError(rejected ? getErrorMessage(rejected.reason) : '');
    setLoading(false);
  }, [device._id]);

  useEffect(() => { load(); }, [load]);

  const execute = async (operation, success) => {
    setWorking(true);
    try {
      const result = await operation();
      notify(success);
      await Promise.all([load(), onRefresh()]);
      return result;
    } catch (actionError) {
      notify(getErrorMessage(actionError), 'error');
      return null;
    } finally { setWorking(false); }
  };

  return <div className="space-y-6"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" />Back to devices</button><section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><div className="flex items-center gap-3"><h2 className="text-2xl font-bold tracking-tight">{device.name}</h2><StatusBadge status={device.status} /></div><p className="mt-2 font-mono text-sm text-slate-500">{device.identifier} · unit {device.unitId} · {device.connection?.protocol}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => execute(() => api.connectDevice(device._id), 'Connection established.')} disabled={working}><Plug className="h-4 w-4" />Connect</Button><Button variant="outline" onClick={() => execute(() => api.disconnectDevice(device._id), 'Connection released.')} disabled={working}><Power className="h-4 w-4" />Disconnect</Button><Button onClick={() => execute(() => api.pollDevice(device._id), 'Decoded poll completed.')} disabled={working}><Play className="h-4 w-4" />Poll now</Button></div></section>{error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}<div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]"><Card><CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100"><div><CardTitle>Latest decoded values</CardTitle><CardDescription>Current persisted values from the assigned profile</CardDescription></div><Button size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></CardHeader><CardContent className="p-0">{loading ? <InlineLoader /> : values.length === 0 ? <EmptyState title="No decoded values yet" description="Run a successful poll after assigning an active register profile." /> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Register</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Raw</th><th className="px-4 py-3">Sampled</th></tr></thead><tbody className="divide-y divide-slate-100">{values.map((value) => <tr key={value._id}><td className="px-5 py-3"><p className="font-semibold">{value.registerName}</p><p className="font-mono text-xs text-slate-500">{value.registerKey} · {value.dataType}</p></td><td className="px-4 py-3 font-semibold tabular-nums">{formatValue(value.value)} <span className="text-xs font-normal text-slate-500">{value.unit}</span></td><td className="px-4 py-3 text-xs text-slate-600">{Array.isArray(value.rawValues) ? value.rawValues.join(', ') : String(value.rawValue)}</td><td className="px-4 py-3 text-xs text-slate-500">{formatRelative(value.sampledAt)}</td></tr>)}</tbody></table></div>}</CardContent></Card><div className="space-y-5"><ConnectionCard connection={connection} device={device} /><RawOperations device={device} execute={execute} /></div></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><Terminal className="h-5 w-5 text-indigo-500" />Communication history</CardTitle><CardDescription>Retained Modbus operation metadata and poll outcomes</CardDescription></CardHeader><CardContent className="p-0">{logs.length === 0 ? <EmptyState title="No communication logs" description="Logs appear after polling or running Modbus actions." /> : <div className="divide-y divide-slate-100">{logs.map((log) => <div key={log._id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-28"><Badge variant="outline" className={outcomeStyle[log.outcome] || 'bg-slate-50 text-slate-600'}>{log.outcome}</Badge></div><div className="flex-1"><p className="text-sm font-semibold">{log.operation} <span className="font-normal text-slate-500">via {log.source}</span></p><p className="mt-0.5 text-xs text-slate-500">{log.request?.batchCount || 0} batches · {log.request?.registerCount || 0} registers · {log.durationMs ?? '—'} ms{log.error?.message ? ` · ${log.error.message}` : ''}</p></div><p className="text-xs text-slate-500">{formatDate(log.timestamp)}</p></div>)}</div>}</CardContent></Card></div>;
}

function ConnectionCard({ connection, device }) { return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5 text-indigo-500" />Connection</CardTitle><CardDescription>Process-local Modbus pool state</CardDescription></CardHeader><CardContent className="space-y-3"><KeyValue label="State" value={connection?.state || 'DISCONNECTED'} accent={connection?.connected ? 'text-emerald-600' : 'text-slate-600'} /><KeyValue label="Endpoint" value={connection?.endpoint?.host ? `${connection.endpoint.host}:${connection.endpoint.port}` : connection?.endpoint?.serialPath || device.connection?.host || device.connection?.serialPath || '—'} /><KeyValue label="Pool clients" value={connection?.attachedDeviceCount ?? 0} /><KeyValue label="Pending operations" value={connection?.pendingOperations ?? 0} /><KeyValue label="Last connected" value={formatRelative(connection?.lastConnectedAt)} /></CardContent></Card>; }

function RawOperations({ device, execute }) {
  const [readType, setReadType] = useState('INPUT_REGISTER');
  const [readAddress, setReadAddress] = useState('0');
  const [readQuantity, setReadQuantity] = useState('1');
  const [writeType, setWriteType] = useState('HOLDING_REGISTER');
  const [writeAddress, setWriteAddress] = useState('0');
  const [writeValues, setWriteValues] = useState('0');
  const [result, setResult] = useState(null);

  const read = async () => {
    const response = await execute(() => api.rawRead(device._id, { registerType: readType, address: Number(readAddress), quantity: Number(readQuantity) }), 'Raw read completed.');
    if (response) setResult(response.data);
  };
  const write = async () => {
    const values = writeType === 'COIL'
      ? writeValues.split(',').map((value) => value.trim().toLowerCase() === 'true')
      : writeValues.split(',').map((value) => Number(value.trim()));
    const response = await execute(() => api.rawWrite(device._id, { registerType: writeType, address: Number(writeAddress), values }), 'Raw write completed.');
    if (response) setResult(response.data);
  };

  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-indigo-500" />Raw Modbus tools</CardTitle><CardDescription>Use with care; profile polling is preferred.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="rounded-lg border border-slate-100 bg-slate-50 p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Read</p><div className="grid grid-cols-2 gap-2"><Select value={readType} onChange={(event) => setReadType(event.target.value)} options={REGISTER_TYPES} /><Input value={readAddress} onChange={(event) => setReadAddress(event.target.value)} type="number" min="0" placeholder="Address" /><Input value={readQuantity} onChange={(event) => setReadQuantity(event.target.value)} type="number" min="1" placeholder="Quantity" /><Button size="sm" onClick={read}><Send className="h-3.5 w-3.5" />Read</Button></div></div><div className="rounded-lg border border-slate-100 bg-slate-50 p-3"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Write</p><div className="grid grid-cols-2 gap-2"><Select value={writeType} onChange={(event) => setWriteType(event.target.value)} options={['HOLDING_REGISTER', 'COIL']} /><Input value={writeAddress} onChange={(event) => setWriteAddress(event.target.value)} type="number" min="0" placeholder="Address" /><Input className="col-span-2" value={writeValues} onChange={(event) => setWriteValues(event.target.value)} placeholder={writeType === 'COIL' ? 'true, false' : '0, 65535'} /><Button className="col-span-2" size="sm" variant="outline" onClick={write}><Send className="h-3.5 w-3.5" />Write values</Button></div></div>{result && <pre className="max-h-32 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-emerald-300">{JSON.stringify(result, null, 2)}</pre>}</CardContent></Card>;
}

function DeviceDialog({ open, onOpenChange, device, profiles, onSave }) {
  const [form, setForm] = useState(() => deviceToForm(device));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm(deviceToForm(device)); setError(''); } }, [open, device]);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setConnection = (field, value) => setForm((current) => ({ ...current, connection: { ...current.connection, [field]: value } }));
  const submit = async (event) => { event.preventDefault(); setSubmitting(true); setError(''); try { await onSave(devicePayload(form), device); onOpenChange(false); } catch (saveError) { setError(getErrorMessage(saveError)); } finally { setSubmitting(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{device ? 'Edit device' : 'Add device'}</DialogTitle><DialogDescription>Connection and polling settings are persisted to the Modbus core.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><ErrorBanner message={error} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Display name" required><Input value={form.name} onChange={(event) => set('name', event.target.value)} required /></Field><Field label="Identifier" required hint="lowercase, numbers, dots, underscores, hyphens"><Input value={form.identifier} onChange={(event) => set('identifier', event.target.value.toLowerCase())} required /></Field><Field label="Site"><Input value={form.site} onChange={(event) => set('site', event.target.value)} placeholder="Plant A" /></Field><Field label="Unit ID"><Input type="number" min="1" max="247" value={form.unitId} onChange={(event) => set('unitId', event.target.value)} required /></Field><Field label="Register profile"><Select value={form.registerProfileId} onChange={(event) => set('registerProfileId', event.target.value)} options={profiles.filter((profile) => profile.isActive).map((profile) => ({ value: profile._id, label: profile.name }))} placeholder="No profile assigned" /></Field><Field label="Tags"><Input value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="incomer, critical" /></Field></div><Field label="Description"><textarea value={form.description} onChange={(event) => set('description', event.target.value)} className="form-textarea" rows="2" /></Field><section className="rounded-xl border border-slate-200 p-4"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Transport</h3><p className="text-xs text-slate-500">Select the physical Modbus connection.</p></div><Select value={form.connection.protocol} onChange={(event) => setConnection('protocol', event.target.value)} options={['TCP', 'RTU']} className="w-28" /></div>{form.connection.protocol === 'TCP' ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Host" required><Input value={form.connection.host} onChange={(event) => setConnection('host', event.target.value)} required placeholder="192.168.10.25" /></Field><Field label="Port"><Input type="number" min="1" max="65535" value={form.connection.port} onChange={(event) => setConnection('port', event.target.value)} /></Field></div> : <div className="grid gap-4 sm:grid-cols-2"><Field label="Serial path" required><Input value={form.connection.serialPath} onChange={(event) => setConnection('serialPath', event.target.value)} required placeholder="/dev/ttyUSB0" /></Field><Field label="Baud rate"><Input type="number" value={form.connection.baudRate} onChange={(event) => setConnection('baudRate', event.target.value)} /></Field><Field label="Data bits"><Select value={form.connection.dataBits} onChange={(event) => setConnection('dataBits', event.target.value)} options={['5', '6', '7', '8']} /></Field><Field label="Stop bits"><Select value={form.connection.stopBits} onChange={(event) => setConnection('stopBits', event.target.value)} options={['1', '2']} /></Field><Field label="Parity"><Select value={form.connection.parity} onChange={(event) => setConnection('parity', event.target.value)} options={['none', 'even', 'odd']} /></Field></div>}</section><section className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2"><div><h3 className="font-semibold">Polling policy</h3><p className="mt-1 text-xs text-slate-500">Interval is expressed in milliseconds.</p><div className="mt-3 space-y-3"><SwitchRow label="Enable polling" checked={form.polling.enabled} onCheckedChange={(value) => set('polling', { ...form.polling, enabled: value })} /><Field label="Interval (ms)"><Input type="number" min="1000" value={form.polling.intervalMs} onChange={(event) => set('polling', { ...form.polling, intervalMs: event.target.value })} /></Field><Field label="Jitter (ms)"><Input type="number" min="0" value={form.polling.jitterMs} onChange={(event) => set('polling', { ...form.polling, jitterMs: event.target.value })} /></Field></div></div><div><h3 className="font-semibold">Reconnect policy</h3><p className="mt-1 text-xs text-slate-500">Applied by the pooled Modbus transport.</p><div className="mt-3 space-y-3"><Field label="Response timeout (ms)"><Input type="number" min="100" value={form.reconnect.timeoutMs} onChange={(event) => set('reconnect', { ...form.reconnect, timeoutMs: event.target.value })} /></Field><Field label="Retries"><Input type="number" min="0" value={form.reconnect.retries} onChange={(event) => set('reconnect', { ...form.reconnect, retries: event.target.value })} /></Field><Field label="Retry delay (ms)"><Input type="number" min="0" value={form.reconnect.retryDelayMs} onChange={(event) => set('reconnect', { ...form.reconnect, retryDelayMs: event.target.value })} /></Field></div></div></section><SwitchRow label="Device enabled" description="Disabled devices cannot connect, poll, or run Modbus operations." checked={form.isEnabled} onCheckedChange={(value) => set('isEnabled', value)} /><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{device ? 'Save changes' : 'Create device'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ProfileDialog({ open, onOpenChange, profile, onSave }) {
  const [form, setForm] = useState(() => profileToForm(profile));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm(profileToForm(profile)); setError(''); } }, [open, profile]);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateRegister = (index, field, value) => setForm((current) => ({ ...current, registers: current.registers.map((register, itemIndex) => itemIndex === index ? { ...register, [field]: value } : register) }));
  const removeRegister = (index) => setForm((current) => ({ ...current, registers: current.registers.filter((_, itemIndex) => itemIndex !== index) }));
  const submit = async (event) => { event.preventDefault(); setSubmitting(true); setError(''); try { await onSave(profilePayload(form), profile); onOpenChange(false); } catch (saveError) { setError(getErrorMessage(saveError)); } finally { setSubmitting(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>{profile ? 'Edit register profile' : 'Create register profile'}</DialogTitle><DialogDescription>Define the physical Modbus map and decoding semantics used by polling.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><ErrorBanner message={error} /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Profile name" required><Input value={form.name} onChange={(event) => set('name', event.target.value)} required /></Field><Field label="Identifier" required><Input value={form.identifier} onChange={(event) => set('identifier', event.target.value.toLowerCase())} required /></Field><Field label="Manufacturer"><Input value={form.manufacturer} onChange={(event) => set('manufacturer', event.target.value)} /></Field><Field label="Model"><Input value={form.model} onChange={(event) => set('model', event.target.value)} /></Field></div><Field label="Description"><textarea value={form.description} onChange={(event) => set('description', event.target.value)} className="form-textarea" rows="2" /></Field><SwitchRow label="Profile active" description="Only active profiles can be assigned to devices." checked={form.isActive} onCheckedChange={(value) => set('isActive', value)} /><section className="overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3"><div><h3 className="font-semibold">Register definitions</h3><p className="text-xs text-slate-500">Fixed types derive word length; strings require a length.</p></div><Button type="button" size="sm" variant="outline" onClick={() => set('registers', [...form.registers, baseRegister()])}><CirclePlus className="h-4 w-4" />Add register</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Key / name</th><th className="p-3">Area</th><th className="p-3">Address</th><th className="p-3">Type / length</th><th className="p-3">Order</th><th className="p-3">Scale / unit</th><th className="p-3">Enabled</th><th className="p-3" /></tr></thead><tbody className="divide-y divide-slate-100">{form.registers.map((register, index) => <tr key={`${index}-${register.key}`}><td className="p-3"><div className="grid gap-2"><Input value={register.key} onChange={(event) => updateRegister(index, 'key', event.target.value)} placeholder="line_voltage" required /><Input value={register.name} onChange={(event) => updateRegister(index, 'name', event.target.value)} placeholder="Line voltage" required /></div></td><td className="p-3"><Select value={register.registerType} onChange={(event) => updateRegister(index, 'registerType', event.target.value)} options={REGISTER_TYPES} /></td><td className="p-3"><Input type="number" min="0" max="65535" value={register.address} onChange={(event) => updateRegister(index, 'address', event.target.value)} required /></td><td className="p-3"><div className="grid gap-2"><Select value={register.dataType} onChange={(event) => { updateRegister(index, 'dataType', event.target.value); if (event.target.value !== 'STRING') updateRegister(index, 'length', ''); }} options={DATA_TYPES} /><Input type="number" min="1" max="125" value={register.length} onChange={(event) => updateRegister(index, 'length', event.target.value)} placeholder={register.dataType === 'STRING' ? 'required' : 'auto'} /></div></td><td className="p-3"><div className="grid gap-2"><Select value={register.byteOrder} onChange={(event) => updateRegister(index, 'byteOrder', event.target.value)} options={ORDER_OPTIONS} /><Select value={register.wordOrder} onChange={(event) => updateRegister(index, 'wordOrder', event.target.value)} options={ORDER_OPTIONS} /></div></td><td className="p-3"><div className="grid grid-cols-2 gap-2"><Input type="number" step="any" value={register.scaleFactor} onChange={(event) => updateRegister(index, 'scaleFactor', event.target.value)} placeholder="Scale" /><Input value={register.unit} onChange={(event) => updateRegister(index, 'unit', event.target.value)} placeholder="Unit" /></div></td><td className="p-3"><Switch checked={register.enabled} onCheckedChange={(value) => updateRegister(index, 'enabled', value)} /></td><td className="p-3"><Button type="button" variant="ghost" size="icon" disabled={form.registers.length === 1} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => removeRegister(index)}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div></section><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{profile ? 'Save profile' : 'Create profile'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ label, hint, required, children }) { return <div className="space-y-1.5"><Label>{label}{required && <span className="ml-1 text-rose-500">*</span>}</Label>{children}{hint && <p className="text-[11px] text-slate-500">{hint}</p>}</div>; }
function Select({ value, onChange, options, placeholder, className = '' }) { const normalized = options.map((option) => typeof option === 'string' ? { value: option, label: option.replaceAll('_', ' ') } : option); return <select value={value} onChange={onChange} className={`form-select ${className}`}><option value="">{placeholder || 'Select…'}</option>{normalized.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>; }
function SwitchRow({ label, description, checked, onCheckedChange }) { return <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"><div><p className="text-sm font-medium">{label}</p>{description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}</div><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>; }
function ErrorBanner({ message }) { return message ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</div> : null; }
function EmptyState({ title, description }) { return <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center"><Database className="h-7 w-7 text-slate-300" /><h3 className="mt-3 font-semibold text-slate-700">{title}</h3><p className="mt-1 max-w-md text-sm text-slate-500">{description}</p></div>; }
function InlineLoader() { return <div className="grid min-h-48 place-items-center"><LoaderCircle className="h-5 w-5 animate-spin text-indigo-600" /></div>; }
function ActionIcon({ label, children, destructive, onClick }) { return <button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${destructive ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>{children}</button>; }
function Toast({ toast, onClose }) { const icon = toast.type === 'error' ? <CircleX className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />; return <div className={`fixed bottom-5 right-5 z-[100] flex max-w-md items-start gap-3 rounded-xl border p-4 text-sm shadow-xl ${toast.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-white text-slate-800'}`}><span className={toast.type === 'error' ? 'text-rose-600' : 'text-emerald-600'}>{icon}</span><p className="flex-1 font-medium">{toast.message}</p><button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button></div>; }

function deviceToForm(device) { return { identifier: device?.identifier || '', name: device?.name || '', description: device?.description || '', site: device?.site || '', unitId: String(device?.unitId ?? 1), registerProfileId: device?.registerProfile?._id || '', tags: device?.tags?.join(', ') || '', isEnabled: device?.isEnabled ?? true, connection: { protocol: device?.connection?.protocol || 'TCP', host: device?.connection?.host || '', port: String(device?.connection?.port ?? 502), serialPath: device?.connection?.serialPath || '', baudRate: String(device?.connection?.baudRate ?? 9600), dataBits: String(device?.connection?.dataBits ?? 8), stopBits: String(device?.connection?.stopBits ?? 1), parity: device?.connection?.parity || 'none' }, polling: { enabled: device?.polling?.enabled ?? true, intervalMs: String(device?.polling?.intervalMs ?? 60000), jitterMs: String(device?.polling?.jitterMs ?? 0) }, reconnect: { timeoutMs: String(device?.reconnect?.timeoutMs ?? 3000), retries: String(device?.reconnect?.retries ?? 2), retryDelayMs: String(device?.reconnect?.retryDelayMs ?? 500) } }; }
function devicePayload(form) { const connection = form.connection.protocol === 'TCP' ? { protocol: 'TCP', host: form.connection.host.trim(), port: Number(form.connection.port) } : { protocol: 'RTU', serialPath: form.connection.serialPath.trim(), baudRate: Number(form.connection.baudRate), dataBits: Number(form.connection.dataBits), stopBits: Number(form.connection.stopBits), parity: form.connection.parity }; return { identifier: form.identifier.trim(), name: form.name.trim(), description: optionalText(form.description) || null, site: optionalText(form.site) || null, unitId: Number(form.unitId), connection, registerProfileId: form.registerProfileId || null, polling: { enabled: form.polling.enabled, intervalMs: Number(form.polling.intervalMs), jitterMs: Number(form.polling.jitterMs) }, reconnect: { timeoutMs: Number(form.reconnect.timeoutMs), retries: Number(form.reconnect.retries), retryDelayMs: Number(form.reconnect.retryDelayMs) }, isEnabled: form.isEnabled, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) }; }
function baseRegister() { return { key: '', name: '', registerType: 'INPUT_REGISTER', address: '0', dataType: 'UINT16', length: '', byteOrder: 'BIG_ENDIAN', wordOrder: 'BIG_ENDIAN', scaleFactor: '1', offset: '0', unit: '', group: '', writable: false, enabled: true, sortOrder: '0' }; }
function profileToForm(profile) { return { identifier: profile?.identifier || '', name: profile?.name || '', description: profile?.description || '', manufacturer: profile?.manufacturer || '', model: profile?.model || '', isActive: profile?.isActive ?? true, registers: profile?.registers?.length ? profile.registers.map((register) => ({ ...baseRegister(), ...register, address: String(register.address), length: register.length ? String(register.length) : '', scaleFactor: String(register.scaleFactor ?? 1), offset: String(register.offset ?? 0), sortOrder: String(register.sortOrder ?? 0), unit: register.unit || '', group: register.group || '' })) : [baseRegister()] }; }
function profilePayload(form) { return { identifier: form.identifier.trim(), name: form.name.trim(), description: optionalText(form.description) || null, manufacturer: optionalText(form.manufacturer) || null, model: optionalText(form.model) || null, isActive: form.isActive, registers: form.registers.map((register) => { const payload = { key: register.key.trim(), name: register.name.trim(), registerType: register.registerType, address: Number(register.address), dataType: register.dataType, byteOrder: register.byteOrder, wordOrder: register.wordOrder, scaleFactor: Number(register.scaleFactor), offset: Number(register.offset), writable: register.writable, enabled: register.enabled, sortOrder: Number(register.sortOrder || 0), unit: optionalText(register.unit) || null, group: optionalText(register.group) || null }; if (register.length !== '') payload.length = Number(register.length); return payload; }) }; }

>>>>>>> origin/main
export default App;
