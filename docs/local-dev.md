# Local development

A disposable local stack: **Postgres + Redis + MinIO (S3)** in Docker, with the
app running on the host. No production data is involved.

## Prerequisites

- **Bun** (`brew install oven-sh/bun/bun`).
- **A Docker runtime.** Either:
  - **Colima** (lightweight, headless, recommended): `brew install colima docker docker-compose && colima start`.
    If `docker compose` (with a space) is not found, register the plugin dir once:
    add `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]` to `~/.docker/config.json`.
  - or **Docker Desktop**.

## `.env`

Create `.env` in the repo root (gitignored). The values below match the
`docker-compose.dev.yml` services; `APP_SECRET` is any 64 hex chars.

```sh
NODE_ENV=development
DATABASE_URL=postgres://kontor2:kontor2@localhost:5432/kontor2_dev
REDIS_URL=redis://localhost:6379
BETTER_AUTH_URL=http://localhost:3000
APP_SECRET=$(openssl rand -hex 32)
AWS_ENDPOINT_URL=http://localhost:9000
AWS_S3_BUCKET_NAME=kontor2-dev
AWS_DEFAULT_REGION=eu-central-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

## Run

```sh
bun run dev:up      # start Postgres + Redis + MinIO (+ create the bucket) and apply migrations
bun run dev:serve   # build the app and serve it on http://localhost:3000
```

Other helpers:

```sh
bun run dev:down    # stop the services (data kept in named volumes)
bun run dev:reset   # wipe the volumes and start fresh (empty DB)
bun run dev:logs    # tail the service logs
```

First run: open <http://localhost:3000/setup> and create the first admin (it gets
the `admin` role). The MinIO console is at <http://localhost:9001> (`minioadmin`
/ `minioadmin`).

## Disposable browser sandbox

For interactive QA in a completely fresh instance, run:

```sh
bun run sandbox
```

The command resets the tmpfs-backed test database, applies all migrations,
creates a temporary admin with newly generated credentials, and serves the app
at <http://localhost:3100>. The URL and credentials are printed once startup is
complete. Press Ctrl-C to stop the app and delete the test containers and all
their data. The persistent development stack on port 3000 is not touched.

Set `SANDBOX_PORT` to use another app port. If a previous sandbox process was
interrupted before cleanup, `bun run sandbox:down` removes its test containers.

## PostgreSQL 18 upgrade

Development and all test jobs use PostgreSQL 18.6 and Redis 8.10.2. The official
PostgreSQL 18 image stores its cluster under `/var/lib/postgresql/18/docker`.
Mount the parent `/var/lib/postgresql`, also for tmpfs-backed tests.

Version 4.0.0 changes the development volume from `pgdata` to `pgdata18`.
The old `kontor2-dev_pgdata` volume is retained. PostgreSQL 16 data files cannot
be opened directly by PostgreSQL 18. To preserve an existing development DB,
export it **before switching from the old Compose file**:

```sh
umask 077
docker compose -f docker-compose.dev.yml up -d --wait postgres
docker compose -f docker-compose.dev.yml exec -T postgres pg_dump -U kontor2 -d kontor2_dev -Fc > kontor2-dev-pg16.dump
docker compose -f docker-compose.dev.yml stop postgres
```

Move the dump to a private location outside the repository. After switching to
the new Compose file, start the empty PostgreSQL 18 cluster and restore it:

```sh
docker compose -f docker-compose.dev.yml up -d --wait postgres
docker compose -f docker-compose.dev.yml exec -T postgres pg_restore -U kontor2 -d kontor2_dev --exit-on-error --no-owner < /private/path/kontor2-dev-pg16.dump
bun run dev:up
```

Verify the restored application before deleting any backup or old volume. For
disposable data, starting the new stack without a restore creates an empty DB;
the old volume still remains available. Redis reuses `redisdata`; back up that
volume before its first Redis 8 start if its local state needs to be retained.
These changes do not upgrade any hosted production database.

## Notes

- **No HMR yet.** The app is served from the production build (`dev:serve`
  rebuilds), because `vite dev` currently lacks a working React Fast Refresh
  setup (`@vitejs/plugin-react` is not wired into `vite.config.ts`, and adding it
  naively clashes with the TanStack Router code-splitter — "Duplicate declaration
  hot"). After a code change, re-run `bun run dev:serve`. Fixing dev/HMR is a
  separate task.
- The stack is **disposable**: `dev:reset` gives you a clean database in seconds.
- `docker-compose.test.yml` is a separate stack used only by the integration
  tests (`bun run test:int`); it is unrelated to this dev stack.
