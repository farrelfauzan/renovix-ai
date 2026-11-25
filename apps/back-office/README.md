# Back-office (apps/back-office)

The Renovix staff app (RX-93). Next.js 16 App Router, Tailwind 4. Local port **4400**
(`bun run dev:back-office`); this is the origin the API expects in `ADMIN_ORIGIN` (`http://localhost:4400`).

## Run it locally

You need Bun, Docker (for Postgres) and a `.env` at the repo root.

1. Install, start Postgres and prepare the database:

   ```bash
   bun install
   docker compose up -d
   bun run prisma:generate
   bun run prisma:migrate
   ```

   Optional: `bun run seed` (see `AGENTS.md`).

2. Make `.env` from the example:

   ```bash
   cp .env.example .env
   ```

   Set these values. The API does not start without them (`.env.example:28-38`):

   - `DATABASE_URL`: the user, password and database from the `postgres` service in `docker-compose.yml:10-12`.
     The example line (`.env.example:2`) is a placeholder.
   - `ADMIN_JWT_SECRET`: `openssl rand -base64 48` (`.env.example:29-31`).
   - `ADMIN_TOTP_ENCRYPTION_KEY`: `openssl rand -base64 32` (`.env.example:32-34`).
   - `ADMIN_ORIGIN="http://localhost:4400"` (`.env.example:38`). Keep it exactly like this.

   Keep the other secrets as `.env.example` ships them: with `NODE_ENV=development` their dev-only values work (`.env.example:7-13`).

3. Start the API, then the back-office, each in its own terminal:

   ```bash
   bun run dev:api          # API on http://localhost:3000
   ```

   ```bash
   bun run dev:back-office  # back-office on http://localhost:4400
   ```

   The API port comes from `PORT` and defaults to 3000 (`apps/api/src/main.ts:70`). The back-office port is fixed in `apps/back-office/project.json:8`.

4. Create the first admin. Run it from the repo root with the same `.env`. It writes to the database in `DATABASE_URL`:

   ```bash
   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD && bun scripts/create-admin.ts you@example.com; unset ADMIN_PASSWORD
   ```

   The script takes one argument, the email (`scripts/create-admin.ts:26`). The password comes from `ADMIN_PASSWORD` or stdin, never from the command line (`scripts/create-admin.ts:5-6`). It creates an owner, and refuses an email that already exists.

5. Open http://localhost:4400 and sign in with the email and password.

   On the first sign-in you have no authenticator yet, and the screen does not start the setup by itself. The files below are in `apps/back-office/src/components/client/sign-in/`:

   - After the password the screen asks for an "Authenticator code". Click the link "No authenticator set up yet: continue without a code" (`sign-in-second-factor-form.tsx:45-47`).
   - The screen says "Your account has no authenticator yet". Click "Set up authenticator" (`totp-enrolment-step.tsx:55-58`).
   - The screen shows a QR code, and below it the TOTP secret as text and as an `otpauth://` URI (`totp-enrolment-step.tsx:43-50`). Scan the QR code with your authenticator app, or add the account by typing the secret or pasting the URI.
   - Enter the code the app shows. This confirms the secret.
   - The screen then shows your recovery codes once (`recovery-codes.tsx:9`). Save them, then click Continue. The secret is dropped after confirmation (`totp-enrolment-step.tsx:14`).

   Later sign-ins ask for the password, then an authenticator code or a recovery code (`sign-in-screen.tsx:53-56`).

### What breaks it

Check the origin first. Open the app at exactly `http://localhost:4400` and keep the API on `http://localhost:3000`.

- **The API is on another port or host** (for example `NEXT_PUBLIC_API_URL=http://localhost:3001` or a LAN IP).
  The browser console shows a CSP error (`connect-src`), and the request never reaches the API.
  Cause: the CSP allows only `'self'`, `https://api.renovix.id` and `http://localhost:3000` (`apps/back-office/next.config.js:29`).
  Fix: move the API back to port 3000, or put a same-origin proxy in front of it. This repo ships no such proxy.

- **`NEXT_PUBLIC_API_URL` is set to anything but `http://localhost:3000`.**
  Same symptom as above, a CSP error in the console, unless the value is `https://api.renovix.id`.
  Cause: the screens read the value (or fall back to `http://localhost:3000`) in `apps/back-office/src/lib/sign-in/default-sign-in-api.ts:7`, and the CSP at `next.config.js:29` blocks other hosts.

- **The app is opened as `127.0.0.1`, a LAN IP or another host name.**
  Every request to the API gets 403 (Network tab). On `/` the page says "Your session could not be checked. Reload the page to try again." (`apps/back-office/src/components/client/session/session-gate.tsx:69`); on `/sign-in` the form shows a refusal instead of signing in. Cause: `AdminOriginGuard` returns 403 to any `Origin` that is not exactly `ADMIN_ORIGIN` (`apps/api/src/common/guards/admin-origin.guard.ts:28`, `apps/api/src/app/admin-auth/utils/is-allowed-admin-origin.ts:9`). The guard is registered globally (`apps/api/src/app/app.module.ts:101`). `http://127.0.0.1:4400` is a different origin from `http://localhost:4400`.

- **The app is opened at a LAN IP or host name that matches `ADMIN_ORIGIN`.**
  Here the Origin check passes, but the cookies are lost. The admin cookies are `Secure` (`apps/api/src/app/admin-auth/utils/build-cookie.ts:5`). Chrome and Firefox keep `Secure` cookies over plain `http` only on `localhost` (Safari has not always kept them even there), so the cookie is never stored. The next page load gets 401 and goes back to the sign-in page (`apps/back-office/src/components/client/session/session-gate.tsx:49`).
  This is a browser rule, not code in this repo.

- **The app runs over `https` locally, or the app and the API are on different sites.**
  `https://localhost:4400` has an `Origin` that is not `http://localhost:4400`, so sign-in gets the 403 above. Cause: `ADMIN_ORIGIN` must match the page's Origin exactly.
  If the API is on a different site, the cookies are `SameSite=Strict` (`build-cookie.ts:5`), so the browser does not send them to the API. Each request gets 401 and the app returns to sign-in (`session-gate.tsx:49`). The CSP also blocks any host except those listed in `next.config.js:29`.
  Ports do not change the site, so `localhost:3000` and `localhost:4400` are the same site. This is a browser rule, not code in this repo.

## Cookies

The app sets no cookies itself. The admin session cookies are set by the API (`ADMIN_COOKIES` in
`apps/api/src/app/admin-auth/config/admin-cookies.ts`):

- `rx_admin_access`: access token, sent to every path.
- `rx_admin_refresh`: refresh token, sent only to `/api/v1/admin/auth/refresh`.

Both are httpOnly, so no script here reads a token. Calls to the API use `credentials: "include"` (see
`src/lib/api/create-api-client.ts`). The API checks the back-office `Origin` on `/admin` routes (RX-156); the browser
sends it by itself.

## API address

The screens call the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:3000`, see
`src/lib/audit-log/default-audit-log-api.ts`).

## Token refresh

The refresh token is rotated with reuse detection, so two refreshes at once end the session. The API client
(`createApiClient`) lets every request that gets a 401 join one shared refresh, then retries each once; a failed
refresh, or a second 401, ends as `SignedOutError`.

## Isolation

This app shares no runtime code with `apps/chat` or `apps/landing`, and they do not refer to it (`src/isolation.spec.ts`).
Small helpers are copied, not imported. It has no Dockerfile and no CI build job yet (hosting is ops).

## Tests

`npx nx run back-office:test` (also part of `bun run check`).
