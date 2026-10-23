# Build context: monorepo root
# Usage: docker build -f apps/api/Dockerfile .

# ─── Stage 1a: Install dependencies from bun.lock ───
# Same Bun version as CI; alpine (musl) to match the node:alpine stages.
FROM mirror.gcr.io/oven/bun:1.3.11-alpine AS install
WORKDIR /app

# A frozen install of the workspace root needs every workspace manifest bun.lock lists.
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json ./apps/api/
COPY apps/api-e2e/package.json ./apps/api-e2e/
COPY apps/back-office/package.json ./apps/back-office/
COPY apps/chat/package.json ./apps/chat/
COPY apps/landing/package.json ./apps/landing/

# --frozen-lockfile fails the build when bun.lock does not match the manifests.
# --linker hoisted gives the flat, npm-style node_modules the build and runtime stages expect.
RUN bun install --frozen-lockfile --ignore-scripts --linker hoisted

# ─── Stage 1b: Node base with the installed dependencies ───
FROM mirror.gcr.io/library/node:22.23.3-alpine AS deps
WORKDIR /app

RUN apk add --no-cache dumb-init

COPY --from=install /app ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./prisma.config.ts

# ─── Stage 2: Generate Prisma client ───
FROM deps AS prisma

COPY prisma/ ./prisma/
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# ─── Stage 3: Build ───
FROM prisma AS builder

COPY --from=prisma /app/node_modules ./node_modules
COPY --from=prisma /app/apps/api/src/generated ./apps/api/src/generated

COPY . .

RUN cd apps/api && npx webpack-cli build --config webpack.docker.config.js

# ─── Stage 4: Production (Hardened) ───
FROM mirror.gcr.io/library/node:22.23.3-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

COPY --from=builder --chown=appuser:nodejs /app/apps/api/dist ./dist
COPY --from=prisma --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=prisma --chown=appuser:nodejs /app/prisma ./prisma
COPY --from=prisma --chown=appuser:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=prisma --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=prisma --chown=appuser:nodejs /app/apps/api/src/generated ./apps/api/src/generated

USER appuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
