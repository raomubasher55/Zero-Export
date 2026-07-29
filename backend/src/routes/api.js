const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '../../data/register-profiles.json');
const ORDERS = new Set(['ABCD', 'BADC', 'CDAB', 'DCBA']);
const AREAS = new Set(['holding', 'input', 'coil', 'discrete']);
const TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'INT64', 'UINT64', 'FLOAT64', 'STRING']);
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

async function readProfiles() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeProfiles(profiles) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryFile, DATA_FILE);
}

function validateProfile(profile, profiles, currentId = null) {
  const errors = {};
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { body: 'A JSON profile object is required.' };
  }

  if (!profile.name?.trim()) errors.name = 'Profile name is required.';
  if (!profile.identifier?.trim()) errors.identifier = 'Identifier is required.';
  else if (!/^[a-zA-Z0-9_-]+$/.test(profile.identifier)) errors.identifier = 'Identifier has an invalid format.';
  else if (profiles.some((item) => item.id !== currentId && item.identifier.toLowerCase() === profile.identifier.toLowerCase())) {
    errors.identifier = 'Identifier must be unique.';
  }

  if (!Array.isArray(profile.registers)) {
    errors.registers = 'Registers must be an array.';
    return errors;
  }

  const keys = new Set();
  const registerErrors = {};
  profile.registers.forEach((register, index) => {
    const row = {};
    const key = register?.key?.trim();
    if (!key) row.key = 'Register key is required.';
    else if (keys.has(key)) row.key = 'Register key must be unique.';
    keys.add(key);

    if (!AREAS.has(register?.area)) row.area = 'Invalid register area.';
    if (!TYPES.has(register?.type)) row.type = 'Invalid data type.';
    if (!ORDERS.has(register?.order)) row.order = 'Order must be ABCD, BADC, CDAB, or DCBA.';
    if (!Number.isInteger(Number(register?.address)) || Number(register.address) < 0) row.address = 'Address must be a non-negative integer.';
    if (!Number.isInteger(Number(register?.length)) || Number(register.length) < 1) row.length = 'Length must be a positive integer.';
    if (FIXED_LENGTHS[register?.type] && Number(register.length) !== FIXED_LENGTHS[register.type]) {
      row.length = `${register.type} requires ${FIXED_LENGTHS[register.type]} Modbus word(s).`;
    }
    if (register?.scale !== '' && !Number.isFinite(Number(register?.scale))) row.scale = 'Scale must be numeric.';
    if (Object.keys(row).length) registerErrors[index] = row;
  });
  if (Object.keys(registerErrors).length) errors.registers = registerErrors;
  return errors;
}

function normalizeProfile(profile, id) {
  return {
    id,
    name: profile.name.trim(),
    identifier: profile.identifier.trim(),
    manufacturer: String(profile.manufacturer || '').trim(),
    model: String(profile.model || '').trim(),
    description: String(profile.description || '').trim(),
    active: Boolean(profile.active),
    registers: profile.registers.map((register) => ({
      id: register.id || randomUUID(),
      key: register.key.trim(),
      area: register.area,
      address: String(Number(register.address)),
      type: register.type,
      length: String(Number(register.length)),
      order: register.order,
      scale: register.scale === '' ? '' : String(Number(register.scale)),
      unit: String(register.unit || '').trim(),
      enabled: Boolean(register.enabled),
    })),
  };
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/hello', (req, res) => {
  res.json({ message: 'Hello from Zero Export API!' });
});

router.get('/register-profiles', asyncRoute(async (req, res) => {
  res.json(await readProfiles());
}));

router.get('/register-profiles/:id', asyncRoute(async (req, res) => {
  const profile = (await readProfiles()).find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Register profile not found.' });
  return res.json(profile);
}));

router.post('/register-profiles', asyncRoute(async (req, res) => {
  const profiles = await readProfiles();
  const errors = validateProfile(req.body, profiles);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed.', fields: errors });

  const profile = normalizeProfile(req.body, randomUUID());
  profiles.push(profile);
  await writeProfiles(profiles);
  return res.status(201).json(profile);
}));

router.put('/register-profiles/:id', asyncRoute(async (req, res) => {
  const profiles = await readProfiles();
  const index = profiles.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Register profile not found.' });

  const errors = validateProfile(req.body, profiles, req.params.id);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed.', fields: errors });

  const profile = normalizeProfile(req.body, req.params.id);
  profiles[index] = profile;
  await writeProfiles(profiles);
  return res.json(profile);
}));

router.delete('/register-profiles/:id', asyncRoute(async (req, res) => {
  const profiles = await readProfiles();
  const remaining = profiles.filter((item) => item.id !== req.params.id);
  if (remaining.length === profiles.length) return res.status(404).json({ error: 'Register profile not found.' });
  await writeProfiles(remaining);
  return res.status(204).end();
}));

module.exports = router;
