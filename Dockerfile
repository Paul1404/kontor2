# syntax=docker/dockerfile:1.7

# Pinned Bun base shared by every stage. Dependabot (docker ecosystem) bumps it.
# Pinning keeps builds reproducible and the install cache stable across deploys.
FROM oven/bun:1.3.11-slim AS base
WORKDIR /app

# Install all dependencies (incl. dev) and build. The cache mount keeps Bun's
# global package cache between builds, so unchanged dependencies are not
# re-downloaded on every deploy.
FROM base AS builder
COPY package.json bun.lock ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production-only dependencies for the slim runtime. Shares the same Bun cache,
# so these packages were already fetched in the builder stage.
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile

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
EXPOSE 3000
CMD ["bun", "scripts/serve.ts"]
