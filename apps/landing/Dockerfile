# Build context: monorepo root
# Usage: docker build -f apps/landing/Dockerfile .

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
FROM mirror.gcr.io/library/node:22-alpine AS deps
WORKDIR /app

COPY --from=install /app ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./prisma.config.ts

# ─── Stage 2: Build ───
FROM deps AS builder

COPY . .
COPY --from=deps /app/node_modules ./node_modules

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN cd apps/landing && npx next build

# ─── Stage 3: Production (Hardened) ───
FROM mirror.gcr.io/library/node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/static ./apps/landing/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/public ./apps/landing/public

USER nextjs

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/ || exit 1

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/landing/server.js"]
