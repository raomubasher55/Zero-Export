# Zero Export — Energy Monitoring System

A production-oriented Energy Monitoring System (EMS) backend for collecting
Modbus TCP and RTU telemetry. The implementation is being built in reviewed
increments: each capability is isolated behind controller, service,
repository/model, route, and validation boundaries.

## Completed backend increments

### Step 1 — secure application foundation

- Node.js 20+ / Express API bootstrapping with a versioned `/api/v1` boundary.
- MongoDB/Mongoose lifecycle management, bounded connection pooling, and
  fail-fast startup when MongoDB is unavailable.
- Centralized Winston logs, request correlation IDs, optional rotating logs,
  and graceful `SIGTERM`/`SIGINT` shutdown.
- Helmet, explicit CORS allow-list, compression, HPP protection, body-size
  limits, and rate limiting.
- Consistent JSON errors; liveness (`GET /health`) and readiness (`GET /ready`)
  probes.

### Step 2 — EMS device and register-profile domain

- Mongoose **Device** model supporting Modbus TCP and RTU communication
  configuration, unit ID, reconnect policy, polling policy, status, runtime
  statistics, tags, and metadata.
- Mongoose **RegisterProfile** model containing a validated, reusable Modbus
  register map.
- Register definition validation for holding/input/coils/discrete inputs;
  `INT16`, `UINT16`, `INT32`, `UINT32`, `FLOAT32`, `FLOAT64`, `STRING`, and
  `BIT`; byte/word ordering; scaling; bit extraction; and address ranges.
- Repository, service, controller, route, and Zod validator layers for both
  resources.
- Referential checks: only active register profiles may be assigned to a
  device, and a profile cannot be deleted while a device references it.
- Pagination, filtering, server-side sort allow-lists, escaped text search,
  Mongoose indexes, and a production index-creation command.

### Step 3 — Modbus transport core and raw operations

- Process-local TCP/RTU connection manager built on `modbus-serial`.
- Bounded endpoint connection pool: devices on the same physical TCP endpoint
  or RTU line share a client while requests are strictly serialized, preventing
  unit-ID cross-talk.
- Per-device timeout, request retry, exponential reconnect delay, initial
  connect retry, unexpected-close handling, automatic reconnect, and clean
  shutdown of active transports.
- Raw, validated Modbus read/write REST operations using the protocol’s actual
  quantity limits.
- Runtime status persistence in MongoDB: `ONLINE`, `OFFLINE`, `TIMEOUT`, or
  `ERROR`, plus last-seen, last-communication, and last-error details.
- Updating a device’s transport, unit ID, reconnect policy, or enabled state
  safely releases its stale pooled connection.

### Step 4 — decoding, durable monitoring, and scheduled polling

- Register decoder for `INT16`, `UINT16`, `INT32`, `UINT32`, `FLOAT32`,
  `FLOAT64`, `STRING`, and `BIT`, including byte order, word order, scaling,
  offset, and bit extraction.
- Register-read planner that combines contiguous/overlapping profile entries
  safely within Modbus function-code quantity limits.
- `LatestValue` persistence with one upserted current value per device/register.
- Retained `CommunicationLog` persistence for polls and raw API communication,
  with a configurable MongoDB TTL retention index.
- MongoDB lease-based polling scheduler: due-device claims prevent duplicate
  polls across multiple server instances, enforce configurable concurrency, and
  release leases as part of atomic poll-result updates.
- Device poll statistics, next due timestamp, status, last poll, last
  communication, and errors are updated atomically after each poll.

The next increment can build reporting/history and higher-level EMS analytics on
the durable latest values and communication records now produced by the core.

## Prerequisites

- Node.js **20.11+** (Node 22 LTS recommended)
- npm **10+**
- MongoDB 7+ (replica set recommended in production)

## Start the backend

```bash
cd backend
cp .env.example .env
# Set MONGODB_URI in .env for your environment.
npm install

# Run once as a deployment/migration action after setting MONGODB_URI.
npm run db:create-indexes

npm run dev
```

The process deliberately does **not** accept traffic until it has connected to
MongoDB. This prevents an EMS instance from reporting healthy while it cannot
persist communication data.

> `NODE_ENV=production` disables automatic Mongoose index creation. Run
> `npm run db:create-indexes` during deployment before directing traffic to a
> new release. The command only creates declared indexes; it does not drop
> existing indexes.

| Endpoint | Purpose | Expected status |
| --- | --- | --- |
| `GET /health` | Process liveness; includes database state | `200` |
| `GET /ready` | Deployment readiness; requires MongoDB | `200` / `503` |
| `GET /api/v1` | Versioned API discovery | `200` |

All API responses include `X-Request-Id`. Supply a valid ID in that header to
propagate a correlation ID from an upstream gateway; otherwise the backend
creates a UUID.

## Device and register-profile REST API

Every successful request uses this envelope (list endpoints add `meta.pagination`):

```json
{
  "success": true,
  "data": {}
}
```

Errors use a stable correlation-aware envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "field": "connection.host", "message": "..." }],
    "requestId": "..."
  }
}
```

### Register profiles

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/register-profiles` | List profiles. Query: `page`, `limit` (max 100), `search`, `active`, `manufacturer`, `sortBy`, `sortOrder`. |
| `POST` | `/api/v1/register-profiles` | Create a reusable register map. |
| `GET` | `/api/v1/register-profiles/:registerProfileId` | Retrieve one profile. |
| `PATCH` | `/api/v1/register-profiles/:registerProfileId` | Update one or more mutable fields. `registers` replaces the complete map when supplied. |
| `DELETE` | `/api/v1/register-profiles/:registerProfileId` | Delete a profile; returns `204`. Returns `409` if any device still references it. |

A profile must contain at least one register. `identifier` is a unique lowercase
machine key. Register `key` values are unique within a profile and become the
stable names for collected values in later steps.

```json
{
  "identifier": "acme-pm5350-v1",
  "name": "Acme PM5350 default map",
  "manufacturer": "Acme",
  "model": "PM5350",
  "registers": [
    {
      "key": "line_voltage_avg",
      "name": "Average line voltage",
      "registerType": "INPUT_REGISTER",
      "address": 2999,
      "dataType": "FLOAT32",
      "byteOrder": "BIG_ENDIAN",
      "wordOrder": "BIG_ENDIAN",
      "unit": "V"
    },
    {
      "key": "total_energy",
      "name": "Total energy",
      "registerType": "HOLDING_REGISTER",
      "address": 3203,
      "dataType": "FLOAT64",
      "wordOrder": "LITTLE_ENDIAN",
      "unit": "kWh"
    }
  ]
}
```

Fixed-size types receive the required `length` automatically: 1 word for
16-bit values/`BIT`, 2 words for 32-bit values, and 4 words for `FLOAT64`.
`STRING` requires an explicit register-word `length`. Coils and discrete inputs
must use `BIT`; a `BIT` from a 16-bit input/holding register may use
`bitIndex: 0` through `15`. Input and discrete-input registers are read-only;
only holding registers and coils can be marked `writable`.

### Devices

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/devices` | List devices. Query: `page`, `limit` (max 100), `search`, `protocol`, `status`, `enabled`, `registerProfileId`, `sortBy`, `sortOrder`. |
| `POST` | `/api/v1/devices` | Create a device. |
| `GET` | `/api/v1/devices/:deviceId` | Retrieve one device with its profile summary. |
| `PATCH` | `/api/v1/devices/:deviceId` | Update mutable configuration. A supplied `connection` must be a complete transport object. |
| `DELETE` | `/api/v1/devices/:deviceId` | Delete a device; returns `204`. |

A Modbus TCP device requires `connection.host`; an RTU device requires
`connection.serialPath`. TCP defaults to port `502`; RTU defaults to `9600`
baud, 8 data bits, 1 stop bit, and no parity. `unitId` is constrained to 1–247.

```json
{
  "identifier": "plant-a-main-meter",
  "name": "Plant A main incomer",
  "site": "Plant A",
  "unitId": 1,
  "connection": {
    "protocol": "TCP",
    "host": "192.168.10.25",
    "port": 502
  },
  "registerProfileId": "507f1f77bcf86cd799439011",
  "polling": {
    "enabled": true,
    "intervalMs": 60000,
    "jitterMs": 5000
  },
  "reconnect": {
    "timeoutMs": 3000,
    "retries": 2,
    "retryDelayMs": 500
  },
  "tags": ["incomer", "critical"]
}
```

`status`, timestamps, communication errors, and statistics are intentionally
server-managed; public Device CRUD cannot forge communication health. Connection
and raw-operation events now maintain status, `lastSeenAt`,
`lastCommunicationAt`, and `lastError`; scheduled polling also maintains poll
statistics, leases, `lastPollAt`, and `nextPollAt`.

### Modbus transport and raw-operation API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/devices/:deviceId/connection` | Return the process-local connection state for one device. |
| `POST` | `/api/v1/devices/:deviceId/connection` | Open or reuse the device’s pooled endpoint connection. |
| `DELETE` | `/api/v1/devices/:deviceId/connection` | Release this device from the connection pool. A shared endpoint remains open for other attached devices. |
| `POST` | `/api/v1/devices/:deviceId/modbus/read` | Execute a raw FC1/FC2/FC3/FC4 read. |
| `POST` | `/api/v1/devices/:deviceId/modbus/write` | Execute a raw FC5/FC15 coil write or FC6/FC16 holding-register write. |

Connection entries are **process-local** and are intentionally not persisted.
The key is the physical endpoint: TCP protocol + normalized host + port, or RTU
protocol + serial line settings. Requests for shared connections are queued so
`setID(unitId)` and the following request are always atomic relative to other
units on that endpoint.

A read request accepts one of `COIL`, `DISCRETE_INPUT`, `HOLDING_REGISTER`, or
`INPUT_REGISTER` and returns raw booleans or unsigned 16-bit words. The service
enforces Modbus limits: at most 2,000 bits for coil/discrete-input reads and 125
words for holding/input reads.

```json
{
  "registerType": "HOLDING_REGISTER",
  "address": 2999,
  "quantity": 2
}
```

A write request accepts only writable transport areas. Coil values are booleans;
holding-register values are unsigned integers from `0` through `65535`.

```json
{
  "registerType": "HOLDING_REGISTER",
  "address": 400,
  "values": [0, 65535]
}
```

Per-device `reconnect` settings control request response timeout, retry count,
and retry delay. A transport close schedules bounded exponential reconnects
(delay × 1, 2, 4… capped at 60 seconds). `MODBUS_TIMEOUT` maps to HTTP `504`,
transport failures map to `502`, pool exhaustion to `503`, and Modbus exception
responses to `422`; raw socket/serial error details remain in server logs.

### Decoded polling, latest values, and communication monitoring

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/v1/devices/:deviceId/poll` | Claim and execute an immediate, decoded profile poll. Returns `409` if a poll lease is already active. |
| `GET` | `/api/v1/devices/:deviceId/values` | List latest decoded values. Query: `page`, `limit`, `group`, `quality`, `registerKey`. |
| `GET` | `/api/v1/devices/:deviceId/values/:registerKey` | Retrieve one latest decoded value. |
| `GET` | `/api/v1/devices/:deviceId/communication-logs` | List durable communication logs. Query: `page`, `limit`, `outcome`, `operation`, `source`. |
| `GET` | `/api/v1/polling/status` | Inspect local scheduler status, configured concurrency, active polls, and its last cycle/error. |

A profile poll plans contiguous reads by Modbus register type, executes the whole
plan inside the endpoint’s serialized connection queue, then decodes every
profile entry. This preserves unit-ID integrity even when several devices share
a TCP gateway or RTU bus. Fixed data types use their required register word
length, while `STRING` uses its profile-configured length. Numeric values use:

```text
value = decodedRawValue × scaleFactor + offset
```

A successful poll atomically updates the Device’s `ONLINE` status, poll
statistics, timestamps, and next due time, then upserts one `LatestValue` per
register key. A transport/decode/configuration failure atomically increments
failure statistics, stores a safe error summary, and releases the lease. Polls
with only some decoding failures are `PARTIAL_SUCCESS`: valid values remain
available while failed keys are recorded in the communication log.

`CommunicationLog` records include operation (`POLL`, `CONNECT`, `READ`, or
`WRITE`), source (`SCHEDULER`, `MANUAL`, or `API`), outcome, duration, batch and
register counts, decoded-count metadata, and safe failure data. Logs expire via
a MongoDB TTL index after `COMMUNICATION_LOG_RETENTION_DAYS` (90 days by
default).

The background scheduler begins after MongoDB is connected. It atomically claims
due enabled devices with active polling and a register profile, polls at most
`POLLING_CONCURRENCY` devices locally, and uses a MongoDB lease ID to avoid
duplicate execution across application instances. `nextPollAt` includes each
device’s configured interval and optional jitter. Ensure `POLLING_LEASE_MS` is
longer than the worst-case Modbus operation duration for your device retry
policy.

## Configuration

Copy [`backend/.env.example`](backend/.env.example) to `backend/.env`. It
contains every supported setting and safe local defaults. Key production
settings are:

- `MONGODB_URI` — **required** MongoDB connection string; use TLS and a least-
  privilege database user in production.
- `CORS_ORIGINS` — comma-separated, exact browser origins. `*` is rejected in
  production.
- `TRUST_PROXY` — set only to the number of trusted reverse proxies (or `true`
  in a tightly controlled platform) so rate limiting uses the correct client IP.
- `LOG_FILE_ENABLED` / `LOG_DIRECTORY` — enable 14-day rotating local logs only
  where local disk is part of the deployment design. Container deployments
  should normally use JSON logs on stdout.
- `MODBUS_*` — global fallbacks for the active connection manager: response
  timeout, retry count/delay, and the maximum number of endpoint clients.
- `POLLING_SCHEDULER_ENABLED` — starts/stops the background scheduler at
  process boot; set `false` for API-only worker roles.
- `POLLING_CONCURRENCY`, `POLLING_TICK_INTERVAL_MS`, and `POLLING_LEASE_MS` —
  bound local scheduling throughput, due-claim cadence, and distributed poll
  lease duration.
- `COMMUNICATION_LOG_RETENTION_DAYS` — MongoDB TTL retention for high-volume
  durable communication metadata.

Never commit `.env` files or Modbus gateway credentials.

## Backend layout

```text
backend/
├── .env.example
├── eslint.config.js
├── package.json
├── tests/
│   ├── app.test.js
│   ├── device-polling.service.test.js
│   ├── modbus-connection-manager.test.js
│   ├── modbus-operation.service.test.js
│   ├── modbus-validator.test.js
│   ├── models.test.js
│   ├── polling-scheduler.test.js
│   ├── register-decoder.test.js
│   ├── register-read-planner.test.js
│   ├── services.test.js
│   └── validators.test.js
└── src/
    ├── app.js                    # Express composition root
    ├── index.js                  # HTTP/Mongo startup and graceful shutdown
    ├── config/                   # Environment, database, logging
    ├── constants/                # HTTP, error, Modbus domain constants
    ├── controllers/              # Transport-to-service boundary
    ├── jobs/                     # Lease-based polling scheduler
    ├── middleware/               # Correlation, validation, errors
    ├── modbus/                   # Pooled TCP/RTU clients, planning, decoding
    ├── models/                   # Device/profile/latest-value/log schemas
    ├── repositories/             # All Mongoose query ownership
    ├── routes/                   # Versioned REST route composition
    ├── scripts/                  # Operational database commands
    ├── services/                 # Domain and referential-integrity rules
    ├── utils/                    # API response, pagination, shared helpers
    └── validators/               # Zod request contracts
```

## Quality checks

```bash
cd backend
npm run lint
npm test
npm run check       # lint + test
npm audit
```

## Frontend EMS console

The React/Vite frontend is now wired to the live backend rather than a sample
endpoint. It provides an operations dashboard for:

- Backend/MongoDB health and polling-scheduler state.
- Device and Register Profile CRUD, including TCP/RTU transport settings,
  polling/retry policy, and editable register definitions.
- Device connection control, manual decoded polls, raw Modbus read/write tools,
  latest decoded values, and retained communication history.
- Responsive fleet/profile views with backend validation errors and request
  failures surfaced in the UI.

For a separately hosted backend, copy
[`frontend/.env.example`](frontend/.env.example) to `frontend/.env` and set
`VITE_API_BASE_URL` to the API's `/api/v1` base URL. In local development, the
Vite proxy routes `/api` requests to `http://localhost:3001` automatically.

## Development convenience

From the repository root, the existing scripts can launch both applications:

```bash
npm run dev
```

The frontend is available at `http://localhost:5173`; the backend is at
`http://localhost:3001` by default.
