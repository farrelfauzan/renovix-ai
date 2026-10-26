# RNX-75 manual browser runbook

This is a local-only runbook for the TL. It does not include screenshots. Do not use
`bun run dev:api`, `bun run dev:chat`, or any Nx `serve` target.

## 1. Own throwaway database

Port 55437 must be free; if a container already uses it, stop only your own
rx75-runbook project first. Do not run this runbook concurrently with another role.

Use a PostgreSQL instance owned by this run only, on port `55437`; do not use the
default development database or shared containers. Set `DATABASE_URL` to that
database: `postgresql://rnx75:rnx75@127.0.0.1:55437/rnx75_test`.

Create it with this isolated compose project:

```bash
mkdir -p /tmp/rnx75-runbook
cat > /tmp/rnx75-runbook/compose.yml <<'YAML'
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: rnx75
      POSTGRES_PASSWORD: rnx75
      POSTGRES_DB: rnx75_test
    ports: ["55437:5432"]
    volumes: ["dbdata:/var/lib/postgresql/data"]
volumes:
  dbdata:
YAML
docker compose -p rx75-runbook -f /tmp/rnx75-runbook/compose.yml up -d
```

Create the disposable environment file outside the repository (never commit it).
Copy this entire block unchanged; it generates secrets automatically:

```bash
mkdir -p "$HOME/.config/rnx75"
umask 077
cat > "$HOME/.config/rnx75/local.env" <<EOF
NODE_ENV=development
DATABASE_URL=postgresql://rnx75:rnx75@127.0.0.1:55437/rnx75_test
API_PUBLIC_URL=http://127.0.0.1:3351
CHAT_APP_URL=http://127.0.0.1:4351
APP_BASE_URL=http://127.0.0.1:4351
ADMIN_ORIGIN=http://127.0.0.1:4400
CORS_ORIGIN=http://127.0.0.1:4351
JWT_SECRET=$(openssl rand -base64 48)
BETTER_AUTH_SECRET=$(openssl rand -base64 48)
ADMIN_JWT_SECRET=$(openssl rand -base64 48)
ADMIN_TOTP_ENCRYPTION_KEY=$(openssl rand -base64 32)
IP_HASH_SECRET=$(openssl rand -base64 48)
API_KEY_HASH_SECRET=$(openssl rand -base64 48)
MCP_ENCRYPTION_KEY=$(openssl rand -hex 32)
MCP_OAUTH_STATE_SECRET=$(openssl rand -base64 48)
LLM_KEY_ENCRYPTION_KEY=$(openssl rand -hex 32)
LLM_PROVIDER=fake
PAYMENT_PROVIDER=fake
PAYMENTS_FORCE_OFF=true
S3_BUCKET=rnx75-test
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=local-test
S3_SECRET_ACCESS_KEY=local-test
S3_CDN_DOMAIN=
S3_ENDPOINT=http://127.0.0.1:59999
EOF
unset OPENROUTER_API_KEY LLM_API_KEY EMBEDDING_API_KEY
```

The fake provider means no real LLM/OpenRouter key is needed.
Unset `OPENROUTER_API_KEY`, `LLM_API_KEY`, and `EMBEDDING_API_KEY` before starting.
No object store is started: the local S3 endpoint deliberately refuses connections;
startup system-knowledge sync may log a warning. Uploads/completions are not tested.
The fixture command uses the disposable password `Rnx75-local-test-2026!`.

From this worktree:

```bash
set -a; . "$HOME/.config/rnx75/local.env"; set +a
bun install --frozen-lockfile
bun run prisma:generate
./node_modules/.bin/prisma migrate deploy
bun run build:api
```

The verified API artifact is `apps/api/dist/main.js`. Start it directly:

```bash
set -a; . "$HOME/.config/rnx75/local.env"; set +a
PORT=3351 node apps/api/dist/main.js
```

In a second terminal, with the same environment:

```bash
curl --fail http://127.0.0.1:3351/api/health
```

Expected: HTTP 200 health response. Keep this API process running for the
browser checks.

## 2. Create the accounts and legacy fixtures

The fixture script uses the fixed local-only individual, Enterprise owner, and
Enterprise member accounts listed in the script. It writes only
the explicit legacy `UserSubscription` identity, default workspace membership,
and Enterprise plan row; it never infers a plan from UI state and makes no model
calls.

```bash
set -a; . "$HOME/.config/rnx75/local.env"; set +a
bun scripts/rnx75-local-fixtures.ts
```

Expected: three signup statuses, one signin status, and fixture JSON. The script
fails loudly on any non-2xx response before DB writes and never prints cookies or
tokens. Rerunning on the same database fails with HTTP 409; recreate the database.

## 3. Start chat directly

In a third terminal:

```bash
set -a; . "$HOME/.config/rnx75/local.env"; set +a
NEXT_PUBLIC_API_URL=http://127.0.0.1:3351/api/v1 \
  bunx next dev apps/chat --port 4351
```

Open `http://127.0.0.1:4351` in browser widths 1440px and 375px. Sign in with
the individual test account. Expected shell routes/behavior: `/login` and
`/register` are reachable unauthenticated; successful sign-in returns to `/`;
the primary navigation shows exactly Chat, Agents, Settings. Open `/`, `/agents`,
`/settings/general`, `/settings/workspace`, `/settings/billing`, `/settings/tools`,
and `/settings/api-keys`. Settings shows General, Workspace, Billing and credits,
Connected tools, API keys for the individual. General reuses profile contents;
Workspace uses the existing channel selector/settings; Billing reuses top-up;
Tools shows existing MCP connections; API keys reuses the existing key controls.
Verify `/profile` redirects to `/settings/general`, `/top-up` to
`/settings/billing`, and `/settings` to `/settings/general`.

For Enterprise owner/member checks, sign in with the two fixture accounts.
Select the Enterprise workspace in the switcher. Only the collaborating owner
sees Workspace and members / Company and credits labels. The member and an
individual owner must not see those specialized entries. Billing-admin support
is pending the Tech Lead's scope decision; no such role is created here.

In DevTools device mode set width 375px, reload each page, open the mobile drawer,
and confirm the final URL is the requested route, not `/login`. Check the actual
page heading/content, then evaluate `document.documentElement.scrollWidth <=
window.innerWidth` in the console (must be true). Repeat at 1440px. Record manual
visual signoff against the artboards; previous automated screenshots are invalid.

## 4. Cleanup (only after all checks)

Stop the API and Next processes, then run the compose project cleanup. Remove
`/tmp/rnx75-*.cookies` and the local env file. Record disk before and after:

```bash
docker system df
docker builder prune -af
docker compose -p rx75-runbook -f /tmp/rnx75-runbook/compose.yml down -v --remove-orphans
docker image prune -af
docker system df
```

Never run `docker compose down`, `docker system prune`, or a reset against the
shared development stack.
