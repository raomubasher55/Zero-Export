'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const VALID_ENVIRONMENTS = new Set(['development', 'test', 'production']);

function configurationError(message) {
  const error = new Error(`Invalid application configuration: ${message}`);
  error.name = 'ConfigurationError';
  return error;
}

function readInteger(name, defaultValue, { min, max } = {}) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  if (!/^-?\d+$/.test(rawValue)) {
    throw configurationError(`${name} must be an integer.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw configurationError(`${name} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function readBoolean(name, defaultValue) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  throw configurationError(`${name} must be either "true" or "false".`);
}

function readCsv(name, defaultValue) {
  const rawValue = process.env[name] ?? defaultValue;
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function readTrustProxy() {
  const rawValue = process.env.TRUST_PROXY;

  if (rawValue === undefined || rawValue === '' || rawValue === 'false') {
    return false;
  }

  if (rawValue === 'true') {
    return true;
  }

  return readInteger('TRUST_PROXY', 0, { min: 0, max: 10 });
}

const environment = process.env.NODE_ENV || 'development';
if (!VALID_ENVIRONMENTS.has(environment)) {
  throw configurationError(`NODE_ENV must be one of: ${[...VALID_ENVIRONMENTS].join(', ')}.`);
}

const corsOrigins = readCsv('CORS_ORIGINS', process.env.CORS_ORIGIN || 'http://localhost:5173');
if (corsOrigins.length === 0) {
  throw configurationError('CORS_ORIGINS must contain at least one origin.');
}
if (environment === 'production' && corsOrigins.includes('*')) {
  throw configurationError('CORS_ORIGINS cannot contain "*" in production.');
}

const mongoMaxPoolSize = readInteger('MONGODB_MAX_POOL_SIZE', 20, { min: 1, max: 500 });
const mongoMinPoolSize = readInteger('MONGODB_MIN_POOL_SIZE', 0, { min: 0, max: 100 });
if (mongoMinPoolSize > mongoMaxPoolSize) {
  throw configurationError('MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE.');
}

const config = Object.freeze({
  environment,
  isProduction: environment === 'production',
  isTest: environment === 'test',
  server: Object.freeze({
    host: process.env.HOST || '0.0.0.0',
    port: readInteger('PORT', 3001, { min: 1, max: 65535 }),
    trustProxy: readTrustProxy(),
    gracefulShutdownTimeoutMs: readInteger('GRACEFUL_SHUTDOWN_TIMEOUT_MS', 10000, { min: 1000, max: 120000 }),
  }),
  database: Object.freeze({
    uri: process.env.MONGODB_URI?.trim() || null,
    dbName: process.env.MONGODB_DB_NAME?.trim() || undefined,
    serverSelectionTimeoutMs: readInteger('MONGODB_SERVER_SELECTION_TIMEOUT_MS', 5000, { min: 1000, max: 120000 }),
    socketTimeoutMs: readInteger('MONGODB_SOCKET_TIMEOUT_MS', 45000, { min: 1000, max: 600000 }),
    maxPoolSize: mongoMaxPoolSize,
    minPoolSize: mongoMinPoolSize,
  }),
  http: Object.freeze({
    corsOrigins: Object.freeze(corsOrigins),
    requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '1mb',
    // Personal/single-user deployments usually want this off because the
    // realtime polling (1s simulator + 3s dashboard) exceeds 500 req/15min.
    rateLimitEnabled: readBoolean('RATE_LIMIT_ENABLED', false),
    rateLimitWindowMs: readInteger('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, { min: 1000, max: 24 * 60 * 60 * 1000 }),
    rateLimitMaxRequests: readInteger('RATE_LIMIT_MAX_REQUESTS', 500, { min: 1, max: 100000 }),
  }),
  logging: Object.freeze({
    level: process.env.LOG_LEVEL || (environment === 'production' ? 'info' : 'debug'),
    fileEnabled: readBoolean('LOG_FILE_ENABLED', false),
    directory: path.resolve(process.cwd(), process.env.LOG_DIRECTORY || 'logs'),
    logHealthRequests: readBoolean('LOG_HEALTH_REQUESTS', false),
  }),
  modbus: Object.freeze({
    defaultTimeoutMs: readInteger('MODBUS_DEFAULT_TIMEOUT_MS', 3000, { min: 100, max: 120000 }),
    defaultRetries: readInteger('MODBUS_DEFAULT_RETRIES', 2, { min: 0, max: 20 }),
    retryDelayMs: readInteger('MODBUS_RETRY_DELAY_MS', 500, { min: 0, max: 60000 }),
    poolMaxSize: readInteger('MODBUS_POOL_MAX_SIZE', 100, { min: 1, max: 10000 }),
  }),
  polling: Object.freeze({
    enabled: readBoolean('POLLING_SCHEDULER_ENABLED', true),
    concurrency: readInteger('POLLING_CONCURRENCY', 10, { min: 1, max: 1000 }),
    tickIntervalMs: readInteger('POLLING_TICK_INTERVAL_MS', 1000, { min: 250, max: 60000 }),
    leaseMs: readInteger('POLLING_LEASE_MS', 120000, { min: 1000, max: 3600000 }),
  }),
  monitoring: Object.freeze({
    communicationLogRetentionDays: readInteger('COMMUNICATION_LOG_RETENTION_DAYS', 90, { min: 1, max: 3650 }),
  }),
  simulator: Object.freeze({
    // Simulators are test slaves; start them automatically on boot in
    // development so the controller and polls always find them online.
    autoStart: readBoolean('SIMULATOR_AUTO_START', environment !== 'production'),
  }),
  seeding: Object.freeze({
    builtinProfiles: readBoolean('SEED_BUILTIN_PROFILES', true),
  }),
});

function requireDatabaseUri() {
  if (!config.database.uri) {
    throw configurationError('MONGODB_URI is required to start the server.');
  }

  return config.database.uri;
}

module.exports = {
  config,
  requireDatabaseUri,
};
