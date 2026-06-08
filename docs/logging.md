# Logging

The app has one structured logger with a small sink architecture. A log call
builds a single immutable record (timestamp, level, message, redacted fields)
and hands it to every registered sink.

## Levels

Three levels only: `info`, `warn`, `error`. `LOG_LEVEL` raises the console
floor (default `info`). Set it to `warn` in production to drop the per-request
`rpc.ok` lines from stdout.

## Sinks

- **console** (always on) writes one line per record: single-line JSON in
  production, shaped for Railway's parser (it keys off `level` and `message`,
  every other field becomes a searchable attribute), and a short readable line
  in development. Railway stamps ingest time, so the console sink omits the
  timestamp.
- **postgres** (`log-sink-db.ts`) mirrors records into the `app_log` table so
  they can be read in-app under **Verwaltung > Systemprotokoll** (admin only).
  It is registered lazily from the oRPC context, the same way the snapshot
  scheduler is.

The core logger (`logger.ts`) never imports the database, so it stays usable
from any server file without dragging server-only code into a hot path.

## The Postgres sink

Design goals, in order of importance:

1. **Never block or throw into the caller.** `write` only appends to an
   in-memory buffer; the INSERT happens off the request path on a 2s timer (or
   sooner once the buffer passes 100 records).
2. **Never recurse.** The sink talks to the database directly, not through
   oRPC, and reports its own failures with `console.error`, never back through
   the logger.
3. **Bounded memory.** Past 10,000 buffered records the oldest are dropped and
   counted.
4. **Self-trimming.** A retention window and a row cap are enforced on a timer.
5. **No self-noise.** Records produced by viewing the log (`proc` starting with
   `logs.`) are not persisted.

Common attributes (`requestId`, `proc`, `actorEmail`) are promoted to their own
columns for cheap filtering; everything else stays in the `fields` JSON.

### Configuration

All optional, all with defaults:

| Variable | Default | Meaning |
|---|---|---|
| `LOG_DB_DISABLED` | `0` | `1` turns the database mirror off |
| `LOG_DB_LEVEL` | `info` | floor for what gets persisted |
| `LOG_DB_RETENTION_DAYS` | `14` | delete entries older than this |
| `LOG_DB_MAX_ROWS` | `100000` | hard cap; oldest beyond it are trimmed |

Under `NODE_ENV=test` the sink is disabled, so the suite never writes to the
database.

## Usage

```ts
import { logger } from "~/server/lib/logger";

logger.info("snapshot done", { runId, members: 1234 });

// Bind context once, reuse it:
const reqLog = logger.child({ requestId });
reqLog.warn("retrying", { attempt: 2 });
```

Never log secrets. Field names matching IBAN, password, token, cookie, secret,
connection strings, etc. are redacted recursively before a record reaches any
sink (see `redactFields`). Errors from procedures use `ORPCError`; the
`observability` middleware logs their outcome once, so procedures should not log
their own failures.
