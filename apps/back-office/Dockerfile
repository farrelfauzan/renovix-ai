# Build context: monorepo root
# Usage: docker build -f apps/back-office/Dockerfile .

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
COPY libs/ui/package.json ./libs/ui/

# --frozen-lockfile fails the build when bun.lock does not match the manifests.
# --linker hoisted gives the flat, npm-style node_modules the build and runtime stages expect.
RUN bun install --frozen-lockfile --ignore-scripts --linker hoisted

# ─── Stage 1b: Node base with the installed dependencies ───
FROM mirror.gcr.io/library/node:22-alpine AS deps
WORKDIR /app

COPY --from=install /app ./

# ─── Stage 2: Build ───
FROM deps AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# NEXT_PUBLIC_* values are baked into the bundle here, at build time.
ARG NEXT_PUBLIC_API_URL=https://api.renovix.id
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ADMIN_ENV_LABEL=
ENV NEXT_PUBLIC_ADMIN_ENV_LABEL=$NEXT_PUBLIC_ADMIN_ENV_LABEL

RUN cd apps/back-office && npx next build

# ─── Stage 3: Production (Hardened) ───
FROM mirror.gcr.io/library/node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/back-office/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/back-office/.next/static ./apps/back-office/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/back-office/public ./apps/back-office/public

USER nextjs

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4400/sign-in || exit 1

EXPOSE 4400
ENV PORT=4400
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/back-office/server.js"]
