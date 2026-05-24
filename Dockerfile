# syntax=docker/dockerfile:1.7

FROM oven/bun:1-slim AS builder
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build

FROM oven/bun:1-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --production --frozen-lockfile || bun install --production

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "scripts/serve.ts"]
