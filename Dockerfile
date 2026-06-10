# syntax=docker/dockerfile:1.7

# Pinned Bun base shared by every stage. Dependabot (docker ecosystem) bumps it.
# Pinning keeps builds reproducible and the install cache stable across deploys.
FROM oven/bun:1.3.11-slim AS base
WORKDIR /app

# Install all dependencies (incl. dev) and build. The cache mount keeps Bun's
# global package cache between builds, so unchanged dependencies are not
# re-downloaded on every deploy. Railway's builder requires the cache id to be
# prefixed with s/<service-id>-; the literal UUID is required because build args
# are not expanded inside the mount id. Service: svuwv (production).
FROM base AS builder
COPY package.json bun.lock ./
RUN --mount=type=cache,id=s/83b908ee-38bf-4cc4-bc5e-0e02252c9f4f-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production-only dependencies for the slim runtime. Shares the same Bun cache,
# so these packages were already fetched in the builder stage.
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN --mount=type=cache,id=s/83b908ee-38bf-4cc4-bc5e-0e02252c9f4f-bun-cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile
# Strip build-only tooling that production deps drag in transitively. Only the
# unambiguous bundlers/transpilers/generators are removed -- NOT the @swc or
# @babel scopes, which also hold runtime helper libraries (@swc/helpers,
# @babel/runtime) that fontkit/@react-pdf load lazily. Verified by rendering a
# PDF and loading the built server against the pruned tree; the /api/health
# check renders a PDF too, so a bad prune fails the healthcheck instead of
# going live. Scope-level deletes are arch-agnostic (Linux rolldown/esbuild).
RUN rm -rf \
      node_modules/typescript \
      node_modules/drizzle-kit \
      node_modules/vite node_modules/rolldown node_modules/@rolldown \
      node_modules/esbuild node_modules/@esbuild \
      node_modules/tsx node_modules/lightningcss node_modules/@types \
      node_modules/@tanstack/react-start \
      node_modules/@tanstack/router-plugin \
      node_modules/@tanstack/router-generator \
      node_modules/@tanstack/router-utils

# Runtime: built output plus production node_modules only. No node toolchain --
# everything (server, migrator, scheduler) runs under Bun.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules

# Drop privileges: run as the unprivileged `bun` user that ships in the base
# image (uid 1000) instead of root. The app writes nothing to the container
# filesystem at runtime (state lives in Postgres, Redis and S3) and the copied
# files are world-readable, so no chown is needed. Limits the blast radius if
# the process is ever compromised.
USER bun
EXPOSE 3000
CMD ["bun", "scripts/serve.ts"]
