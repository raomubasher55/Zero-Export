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
  `INT16`, `UINT16`, `INT32`, `UINT32`, `INT64`, `UINT64`, `FLOAT32`,
  `FLOAT64`, `STRING`, and `BIT`; byte/word ordering; scaling; bit extraction;
  and address ranges.
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

- Register decoder for `INT16`, `UINT16`, `INT32`, `UINT32`, `INT64`, `UINT64`,
  `FLOAT32`, `FLOAT64`, `STRING`, and `BIT`, including byte order, word order,
  scaling, offset, and bit extraction.
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

### Step 5 — Orange Pi Modbus forwarding gateway and routed UI

- A persisted forwarding map publishes polled engineering values through a
  process-local Modbus TCP server, Modbus RTU slave, or both at the same time.
- Every output mapping selects a source device/register and independently
  defines its slave area, zero-based address, data type/length, byte/word order,
  scale, offset, unit, enabled state, and write-through permission.
- Source settings can be mirrored and then edited. Runtime encoding reverses
  scaling and ordering so downstream FC1/FC2/FC3/FC4 reads receive valid raw
  Modbus bits/words.
- Optional FC5/FC6/FC15/FC16 write-through decodes the slave value into an
  engineering value, applies the source profile’s inverse conversion, and
  writes the resulting raw value to a source coil or holding register.
- Gateway configuration, lifecycle, endpoint state, mapping freshness, and
  errors are available through REST and a dedicated React page.
- The React console now uses React Router pages for `/`, `/devices`,
  `/devices/:deviceId`, `/profiles`, and `/gateway` instead of local single-view
  state.

### Step 6 — in-memory downstream request analyzer

- Passive TCP and RTU observers capture the inverter/master request and gateway
  response without changing the Modbus execution path.
- Captures client IP/port (TCP), serial path (RTU), transaction and unit IDs,
  function code, address/quantity, raw frames, write values, response words,
  exception, response duration, and matched forwarding-map semantics.
- A bounded process-memory ring stores only the latest diagnostic events. It
  creates no MongoDB model, performs no traffic database writes, and is erased
  by restart or the Clear Memory action.
- Live request tables, polling-pattern analysis, address heat maps, client
  sessions, sequence analysis, mapping suggestions, and JSON/CSV export are
  available at `/gateway/traffic`.
- The raw-word assistant previews signed/unsigned/float candidates under ABCD,
  BADC, CDAB, and DCBA ordering with test scale/offset values. Results are
  explicitly diagnostic candidates because Modbus does not transmit encoding
  metadata.

### Step 7 — live Orange Pi system diagnostics

- A process-local system monitor reports board/device-tree identity, Armbian or
  Linux distribution, kernel, architecture, CPU model, core count, and uptime.
- Live CPU/per-core utilization, Linux load average, current CPU frequency and
  governor, memory/cache/swap, thermal zones, filesystem capacity, and network
  interface counters/rates are exposed through `GET /api/v1/system`.
- The Node.js backend process reports its PID, uptime, CPU, resident memory,
  V8 heap use/limit, external memory, and runtime environment without exposing
  environment-variable values.
- Resource threshold warnings identify high CPU/load, memory pressure, board
  temperature, full storage, down configured links, and high V8 heap use.
- The routed `/system` page refreshes live data every three seconds. System
  samples are not stored in MongoDB or written to monitoring files.

### Step 8 — built-in EM500 profile and same-address gateway forwarding

- A built-in **Eastron EM500** register profile ships with the backend
  (`backend/src/seed/em500.profile.js`) and is seeded once on startup when its
  `em500` identifier is missing. Existing profiles are never overwritten; set
  `SEED_BUILTIN_PROFILES=false` to disable seeding entirely.
- The profile mirrors the EM500 register data manual: 33 instantaneous
  measurements (2-word `UINT32`/`INT32`, input registers) and 35 energy
  counters (4-word 64-bit values), all with the manual's scaling
  (V/100, A/10000, W/100, var/100, VA/100, Hz/1000, PF/10000, %/100,
  kWh/kvarh/kVAh per 100). **Energy counters ship disabled**: polls read only
  the real-time area (addresses `0x0002`–`0x0048`) because many EM500 units
  reject reads above it. Enable the counters per site once the meter confirms
  those addresses respond.
- Built-in profiles are versioned (`metadata.profileVersion`); a stale
  built-in profile is upgraded to the shipped definition at startup, while
  operator-created profiles and current-version built-ins are never touched.
- New **`INT64`/`UINT64`** register data types decode and encode 64-bit
  counters across four Modbus words (big-endian by default, byte/word order
  configurable) for the EM500's 4-word energy registers.
- Built-in profiles are flagged `builtIn: true` in the API and UI; the flag is
  server-managed and excluded from portable import/export files.
- `POST /api/v1/register-profiles/restore-builtins` re-creates any deleted
  built-in profiles without a restart; the Profiles page shows a **Restore
  built-ins** button whenever a built-in profile is missing.
- Each profile card has a **Forward** action: it adds every enabled register
  of that profile to the gateway forwarding map at the meter's own addresses
  (via the same mapping generator used by the Gateway page). It requires at
  least one device assigned to the profile; existing mapping keys are kept,
  so repeated forwards never duplicate entries.
- `POST /api/v1/gateway/mappings/generate` builds one forwarding mapping per
  enabled profile register using the meter's **same addresses** (same Modbus
  area by default, or a chosen area such as holding registers with the same
  address numbers, plus an optional address offset). Nothing is persisted by
  this endpoint: the generated rows are returned for review and saved with the
  regular `PUT /api/v1/gateway` update.
- The Gateway page gains **Mirror device profile**: pick a device (e.g. the
  EM500 meter), optionally choose the slave area and offset, and the full
  register map is added to the forwarding table at the meter's own addresses —
  a downstream controller can then read the gateway exactly like the physical
  meter.

### Step 9 — EM500 meter simulator

- A process-local **Modbus TCP meter simulator** (`backend/src/simulator/`)
  serves the built-in Eastron EM500 register map with live, realistic values:
  drifting phase voltages/currents/power factors, computed active/reactive/
  apparent powers, frequency, asymmetries, and slowly accumulating 64-bit
  energy counters.
- Every register is encoded through the same encoder the gateway uses, so the
  wire format (addresses, byte/word order, scaling, raw words) matches the
  EM500 profile exactly — polling it exercises the exact same decode path as a
  physical meter. Unmapped addresses and wrong unit IDs return proper Modbus
  exception responses.
- `GET /api/v1/simulator`, `PUT /api/v1/simulator`, `POST /api/v1/simulator/
  start|stop`, and `GET /api/v1/simulator/values` manage the simulator and
  expose its current values. The `/simulator` React page starts/stops it,
  edits the endpoint (default `0.0.0.0:15020`, unit 1), and shows a live
  values table grouped by Measurements/Energy.
- The page can **Add simulator device** (creates a TCP device pointed at
  `127.0.0.1:<simulator port>` with the built-in EM500 profile and 5-second
  polling) and **Forward EM500 profile** to the forwarding gateway, so the
  simulated meter flows through the exact poll → forward → downstream path as
  a real meter.

### Step 10 — Huawei inverter profile, dual-device simulator, and zero-export control

- A built-in **Huawei SUN2000** register profile ships with the backend
  (`backend/src/seed/huawei-sun2000.profile.js`): line/phase voltages, phase
  currents, active power, grid frequency, daily/total yield (FC03 holding
  registers per the Huawei Modbus Interface Definitions V3.0), plus writable
  derating registers `40125` (0–1000, 0.1% steps) and `40126` (W).
- The simulator now runs **two devices side by side**, each with its own TCP
  port and a **configurable slave unit ID**: an EM500 grid meter
  (`0.0.0.0:15020`, unit 1) and a Huawei SUN2000 inverter
  (`0.0.0.0:15021`, unit 2). The inverter simulator models solar rating and
  availability, applies FC06/FC16 derating writes to its output power, and
  exposes the derating read-back on 40125.
- **Zero-export controller** (`/api/v1/zero-export`): every cycle it reads the
  grid power from the meter's latest polled value (positive = import) and
  steps the inverter derating register toward the target grid power — import
  above target raises solar output, export lowers it. Deadband, step size,
  min/max derating, interval, and a failsafe derating (written after repeated
  stale meter readings) are configurable and persisted in MongoDB.
- **Simulation mode** replaces the meter reading with
  `gridPower = plannedLoad − inverterOutput`, so the complete scenario
  (100 kW load, inverter at 50% → grid supplies the rest) can be exercised
  end-to-end with the simulators: meter on unit 1, inverter on unit 2, and
  the controller closing the loop.
- **External master → gateway write-through**: forwarding the Huawei profile
  into the gateway makes the inverter registers available on the slave
  endpoint at their same addresses (32066–32114 read, 40125/40126 writable).
  An external master/PLC can then write the derating percentage to the
  gateway (e.g. FC06 `40125 = 500` for 50%) and the gateway's write-through
  converts and forwards it to the real inverter over the connection manager;
  the inverter then raises/lowers its output, and the read-back on 40125 and
  the power on 32080 stay visible through the gateway. The integration test
  `master-write-through.integration.test.js` proves the full chain against
  the simulated inverter (write 50% → output ~halves → restore → output
  returns), and the simulator page has a **Set derating %** control that
  performs the same write like an external master.
- New `/simulator` page manages both simulated devices (unit IDs, ports,
  solar rating/availability, live values) and can create simulator devices
  and forward either profile; the `/zero-export` page configures and runs the
  controller and shows its recent control actions.

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
| `GET` | `/api/v1/register-profiles/export` | Download all register profiles as one portable, versioned JSON file. |
| `GET` | `/api/v1/register-profiles/:registerProfileId/export` | Download one profile as portable JSON. |
| `POST` | `/api/v1/register-profiles/import` | Import 1–100 portable profiles using `UPDATE`, `SKIP`, or `ERROR` identifier-conflict handling. |

The Register Profiles page has **Import JSON**, **Export all**, and per-profile
**Export** actions. Exported files include profile identity/metadata and every
register's area, address, data type/length, byte/word order, bit index, scale,
offset, unit, group, writable/enabled state, and sort order. Server-managed IDs
and timestamps are deliberately excluded so files can move safely between
Zero Export installations. The importer also accepts one raw profile object or
a plain array in the frontend and normalizes it into the versioned format.
Existing identifiers are updated only after operator confirmation.

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
    "intervalMs": 5000,
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
`WRITE`), source (`SCHEDULER`, `MANUAL`, `API`, or `GATEWAY`), outcome,
duration, batch and register counts, decoded-count metadata, and safe failure
data. Logs expire via
a MongoDB TTL index after `COMMUNICATION_LOG_RETENTION_DAYS` (90 days by
default).

The background scheduler begins after MongoDB is connected. It atomically claims
due enabled devices with active polling and a register profile, polls at most
`POLLING_CONCURRENCY` devices locally, and uses a MongoDB lease ID to avoid
duplicate execution across application instances. `nextPollAt` includes each
device’s configured interval and optional jitter. New devices default to a
5-second interval. Creating a poll-enabled device, assigning/changing its
profile, enabling polling, changing its interval, or changing its endpoint
schedules an immediate automatic poll, so an old `nextPollAt` cannot delay the
new configuration. Ensure `POLLING_LEASE_MS` is longer than the worst-case
Modbus operation duration for your device retry policy.

The device telemetry page fetches new persisted values automatically every
3–10 seconds (bounded according to the configured device interval), without
triggering manual Modbus reads. The operations data refreshes quietly in the
background as well. Scheduler status now distinguishes cycle activity from
completed, successful, and failed automatic polls, making backend polling
visible even when no operator presses **Poll now**.

### Modbus forwarding gateway

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/gateway` | Get persisted gateway configuration and process-local runtime status. |
| `PUT` | `/api/v1/gateway` | Replace the TCP/RTU endpoint and forwarding-map configuration; restarts it when `enabled` is true. |
| `POST` | `/api/v1/gateway/start` | Start the saved gateway configuration. |
| `POST` | `/api/v1/gateway/stop` | Stop both slave endpoints and persist the disabled state. |

The downstream function code is selected by the output memory area:

| Output area | Downstream read | Downstream write |
| --- | --- | --- |
| `COIL` | FC01 | FC05 / FC15 when writable |
| `DISCRETE_INPUT` | FC02 | Read-only |
| `HOLDING_REGISTER` | FC03 | FC06 / FC16 when writable |
| `INPUT_REGISTER` | FC04 | Read-only |

A mapping publishes the latest engineering value using the output conversion:

```text
slaveRaw = (engineeringValue - outputOffset) / outputScale
```

A downstream write performs both conversions before contacting the original
source device:

```text
engineeringValue = slaveRaw × outputScale + outputOffset
sourceRaw = (engineeringValue - sourceOffset) / sourceScale
```

Integer output/source types must represent the converted value without a
fraction. Byte order, word order, string length, and bit index are applied in
both directions. Write-through is rejected unless the output mapping is a coil
or holding register **and** the selected source profile definition is also
marked writable in a coil or holding-register area.

For an Orange Pi with two RS-485 adapters, configure the source Device as an RTU
master on a path such as `/dev/ttyUSB0`, and configure the gateway RTU slave on a
different path such as `/dev/ttyUSB1`. Never point both roles at the same serial
device. For TCP, the default slave listener is `0.0.0.0:1502`; privileged port
502 may require `CAP_NET_BIND_SERVICE` or a reverse/port-forwarding rule. TCP and
RTU can run together and expose the same in-memory map and unit ID.

The slave map updates after every successful source poll. Therefore, choose a
source polling interval that meets downstream freshness requirements. A restart
seeds the map from MongoDB `LatestValue` records before accepting requests. A
mapped address with no current source value returns Modbus exception 04 instead
of silently returning a misleading zero.

### In-memory inverter request analyzer

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/gateway/traffic` | List recent completed requests from bounded process memory; supports `limit`, `transport`, `functionCode`, `operation`, `client`, `address`, and `success` filters. The response also contains current aggregate analysis. |
| `GET` | `/api/v1/gateway/traffic/analysis` | Get patterns, polling intervals/rates, address ranges, clients/sessions, sequences, and mapping suggestions. |
| `PATCH` | `/api/v1/gateway/traffic/settings` | Enable/disable capture or change the 100–10,000 event memory limit. Settings are not persisted. |
| `DELETE` | `/api/v1/gateway/traffic` | Clear completed traffic from memory. |
| `POST` | `/api/v1/gateway/traffic/interpret` | Preview possible integer/float/order interpretations for supplied raw register words and test scale/offset. |
| `GET` | `/api/v1/gateway/traffic/export?format=json|csv` | Download the currently retained diagnostic view. |

Traffic capture is deliberately **not a database feature**. No request or
response is inserted into MongoDB, no traffic model/index is created, and no
traffic file is written by the analyzer. Completed events are held only in a
bounded JavaScript array (2,000 by default), oldest events are discarded at the
limit, and everything disappears when the backend process restarts. JSON/CSV is
created only when an operator explicitly downloads it.

For every observed request the analyzer records what is actually present on the
wire: transport/client, transaction ID (TCP), unit ID, function code, address,
quantity, write payload, raw request/response, returned bits/words, exception,
response time, and matching configured output mappings. Data type, order, scale,
offset, engineering unit, and import/export sign are never claimed as wire
facts; the UI labels them as configured mapping semantics or candidate
interpretations requiring manual confirmation.

### Orange Pi system diagnostics

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/system` | Return one live host/process snapshot for the Orange Pi system page. |

The endpoint uses Node.js operating-system APIs plus read-only Linux interfaces
such as `/proc/meminfo`, `/proc/mounts`, `/proc/cpuinfo`,
`/proc/device-tree/model`, `/sys/class/thermal`, `/sys/class/net`, and CPU
frequency sysfs entries. Missing kernel interfaces are reported as unavailable
instead of failing the request, so development on non-Orange-Pi hosts remains
possible.

The response includes:

- Orange Pi model, hostname, OS distribution, kernel, architecture, CPU model,
  core count, board hardware/revision, boot time, and uptime.
- Overall/per-core CPU percentage, 1/5/15-minute load, per-core frequency,
  configured minimum/maximum frequency, and scaling governor.
- Total/used/available/free memory, Linux buffers/cache, and swap usage.
- Every available thermal zone and maximum board temperature.
- Root/boot/removable mounted filesystem capacity and usage.
- Interface state, IP/CIDR/MAC addresses, negotiated speed, total RX/TX bytes,
  and sampled RX/TX bytes per second.
- Backend PID, process uptime/CPU, RSS, heap, heap limit, external memory, and
  array-buffer memory.

No time-series history is retained: each request returns a current snapshot and
only the previous CPU/network counters are kept in process memory to calculate
rates. The `/system` React page polls every three seconds and all samples vanish
when the page/backend stops.

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
- `SEED_BUILTIN_PROFILES` — seeds the built-in Eastron EM500 register profile
  once when its identifier is missing; existing profiles are never overwritten.

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
  polling/retry policy, editable register definitions, and portable JSON profile
  import/export. The Eastron EM500 profile is seeded automatically and shown
  with a **Built-in** badge.
- Device connection control, manual decoded polls, raw Modbus read/write tools,
  latest decoded values, and retained communication history.
- A dedicated forwarding-gateway page for TCP/RTU slave endpoints, mirrored or
  custom output mappings, function-code visibility, and guarded write-through.
  **Mirror device profile** adds the full register map of a device (such as the
  EM500) at the meter's own addresses with one click.
- An in-memory inverter request analyzer with live traffic, request patterns,
  address heat map, sessions, raw frame inspection, mapping suggestions, and
  candidate data-type/order previews.
- A detailed `/system` Orange Pi page for live board identity, CPU/load/frequency,
  memory/swap, thermal zones, storage, network, and backend process usage.
- React Router navigation with bookmarkable operations, device, profile,
  per-device telemetry, gateway, `/gateway/traffic`, and `/system` URLs.
- Responsive fleet/profile views with backend validation errors and request
  failures surfaced in the UI.

When serving the production SPA, configure the web server to rewrite unknown UI
paths such as `/devices/:deviceId`, `/gateway`, and `/system` to `index.html`.
API and health paths must remain routed to the backend.

For a separately hosted backend, copy
[`frontend/.env.example`](frontend/.env.example) to `frontend/.env` and set
`VITE_API_BASE_URL` to the API's `/api/v1` base URL. The health URL is inferred
from that origin; set `VITE_HEALTH_URL` only when it is hosted elsewhere. In
local development, the Vite proxy routes both `/api` and `/health` requests to
`http://localhost:3001` automatically.

## Development convenience

From the repository root, the existing scripts can launch both applications:

```bash
npm run dev
```

The frontend is available at `http://localhost:5173`; the backend is at
`http://localhost:3001` by default.
