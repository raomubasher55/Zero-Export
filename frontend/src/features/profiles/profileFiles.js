const PROFILE_FILE_FORMAT = "zero-export-register-profiles";
const PROFILE_FILE_VERSION = 1;
const MAX_PROFILE_FILE_BYTES = 5 * 1024 * 1024;

const PROFILE_FIELDS = [
  "identifier",
  "name",
  "description",
  "manufacturer",
  "model",
  "isActive",
  "tags",
  "metadata",
];

const REGISTER_FIELDS = [
  "key",
  "name",
  "description",
  "registerType",
  "address",
  "dataType",
  "length",
  "byteOrder",
  "wordOrder",
  "bitIndex",
  "scaleFactor",
  "offset",
  "unit",
  "group",
  "writable",
  "enabled",
  "sortOrder",
];

function pick(source, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => source?.[field] !== undefined)
      .map((field) => [field, source[field]]),
  );
}

function portableProfile(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Every imported profile must be a JSON object.");
  }
  if (!Array.isArray(source.registers)) {
    throw new Error(`Profile “${source.identifier || source.name || "unknown"}” has no registers array.`);
  }
  return {
    ...pick(source, PROFILE_FIELDS),
    registers: source.registers.map((register) => pick(register, REGISTER_FIELDS)),
  };
}

export async function parseProfileFile(file) {
  if (!file) throw new Error("Select a JSON profile file.");
  if (file.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error("Profile file is larger than the 5 MB import limit.");
  }

  let document;
  try {
    document = JSON.parse(await file.text());
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  let profiles;
  if (Array.isArray(document)) {
    profiles = document;
  } else if (Array.isArray(document?.profiles)) {
    if (
      document.format === PROFILE_FILE_FORMAT &&
      document.version !== PROFILE_FILE_VERSION
    ) {
      throw new Error(`Profile file version ${document.version} is not supported.`);
    }
    profiles = document.profiles;
  } else if (document?.registers) {
    profiles = [document];
  } else {
    throw new Error("File must contain one profile, an array of profiles, or a Zero Export profile export document.");
  }

  if (profiles.length === 0) throw new Error("The profile file is empty.");
  if (profiles.length > 100) throw new Error("A single file can contain at most 100 profiles.");

  const portable = profiles.map(portableProfile);
  const identifiers = new Set();
  for (const profile of portable) {
    const identifier = String(profile.identifier || "").trim().toLowerCase();
    if (!identifier) throw new Error("Every imported profile requires an identifier.");
    if (identifiers.has(identifier)) {
      throw new Error(`Profile identifier “${identifier}” appears more than once in the file.`);
    }
    identifiers.add(identifier);
  }

  return {
    format: PROFILE_FILE_FORMAT,
    version: PROFILE_FILE_VERSION,
    profiles: portable,
  };
}

export function downloadProfileBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function profileFilename(profile) {
  const identifier = String(profile?.identifier || "profile")
    .replace(/[^a-z0-9._-]/gi, "_")
    .slice(0, 64);
  return `register-profile-${identifier}.json`;
}

export {
  MAX_PROFILE_FILE_BYTES,
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_VERSION,
};
