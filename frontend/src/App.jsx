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

  return (
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
          </div>

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
    </div>
  );
}

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
      </div>
    </div>
  );
}

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
    </div>
  );
}

export default App;
