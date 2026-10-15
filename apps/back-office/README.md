# Back-office (apps/back-office)

The Renovix staff app (RX-93). Next.js 16 App Router, Tailwind 4. Local port **4400**
(`bun run dev:back-office`); this is the origin the API expects in `ADMIN_ORIGIN` (`http://localhost:4400`).

## Cookies

The app sets no cookies itself. The admin session cookies are set by the API (`ADMIN_COOKIES` in
`apps/api/src/app/admin-auth/config/admin-cookies.ts`):

- `rx_admin_access`: access token, sent to every path.
- `rx_admin_refresh`: refresh token, sent only to `/api/v1/admin/auth/refresh`.

Both are httpOnly, so no script here reads a token. Calls to the API use `credentials: "include"` (see
`src/lib/api/create-api-client.ts`). The API checks the back-office `Origin` on `/admin` routes (RX-156); the browser
sends it by itself.

## Token refresh

The refresh token is rotated with reuse detection, so two refreshes at once end the session. The API client
(`createApiClient`) lets every request that gets a 401 join one shared refresh, then retries each once; a failed
refresh, or a second 401, ends as `SignedOutError`.

## Isolation

This app shares no runtime code with `apps/chat` or `apps/landing`, and they do not refer to it (`src/isolation.spec.ts`).
Small helpers are copied, not imported. It has no Dockerfile and no CI build job yet (hosting is ops).

## Tests

`npx nx run back-office:test` (also part of `bun run check`).
