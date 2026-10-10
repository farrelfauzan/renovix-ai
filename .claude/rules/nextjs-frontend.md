# Next.js Frontend Rules (`apps/web`)

Mirrored for Cursor at `.cursor/rules/nextjs-frontend-cursor-rules.mdc` — keep both copies in sync when editing either. Always applies to frontend code generated in this repository.

`apps/web` is a Next.js 16 App Router app (React 19, TypeScript strict, Tailwind 4, TanStack Query). All commands run from the repo root with pnpm (`pnpm --filter @hms/web <script>`), never npm.

## Project Structure

- `app/` — App Router routes and layouts. Route files (`page.tsx`, `layout.tsx`) stay server components and only compose; they contain no interactive logic.
- `components/server/` — server components that compose data + UI for a feature (fetch/session reads, no `'use client'`).
- `components/client/` — interactive components; each starts with `'use client'`.
- `lib/<feature>/` — feature logic (e.g. `lib/auth`, `lib/rbac`, `lib/admin-users`); `lib/api/` — HTTP layer (`http.ts` mutator, `generated/` Orval output).
- `proxy.ts` — edge request gate (Next.js 16's replacement for `middleware.ts`).
- Path aliases via package `imports`: `#components/*`, `#hooks/*`, `#lib/*`. Never use relative `../../` imports across these roots.

## Server / Client Component Division (mandatory)

- Server Components are the default. Add `'use client'` only when the component needs state, effects, event handlers, browser APIs, or TanStack Query hooks.
- Split every feature UI component-wise:
  - **Server side** (`components/server/<feature>/`): data composition, async work, passing serializable props down.
  - **Client side** (`components/client/<feature>/`): forms, tables with interaction, dialogs, anything using hooks.
- A server component may render a client component; a client component must never import a server component.
- Push `'use client'` boundaries as deep (leaf-ward) as possible — don't mark a whole page tree client because one button needs a handler.
- **One component per file (mandatory).** Every file declares exactly one React component, exported as a named export, in a kebab-case file matching the component name (`data-table.tsx` → `DataTable`). Never define helper/sub-components in the same file — e.g. a customized row for a table lives in its own `data-table-row.tsx` next to `data-table.tsx`, not inside it. This applies to render helpers too: if JSX is worth naming, it's worth its own file. Sole exception: shadcn CLI-generated primitive files in `packages/ui/src/components/` (e.g. `table.tsx` exporting `Table`/`TableRow`/`TableHead`) keep their upstream multi-export structure so they stay regenerable — but any customization or composition built on top of them goes in its own file.
- Use functional components with explicit prop types (no `any`), early returns, small single-purpose components.
- Frontend capability checks use CASL (`lib/rbac` / `@hms/ui` rbac helpers) for **visibility only** — the backend `PermissionsGuard` remains the source of truth.

## API Integration — Orval only (mandatory)

- API access is **generated, never hand-written**. Orval (`apps/web/orval.config.ts`) reads `apps/api/openapi.yaml` and emits a TanStack Query client into `lib/api/generated/` (tags-split mode, `react-query` client, axios `httpClient`).
- All requests go through the axios mutator `lib/api/http.ts` (`orvalAxiosMutator`) — it owns base URL, auth headers, and 401 handling. Never call `fetch` or axios directly in features, components, or route handlers.
- Never edit anything under `lib/api/generated/` — it is overwritten (`clean: true`). When the API changes: run the API on :3001, then `pnpm api:contract:sync` (fetches `/api/openapi.yaml` and regenerates), or `pnpm --filter @hms/web orval:generate` against the checked-in YAML.
- Consume generated hooks (`useQuery`-based) from client components only; wrap them in feature-level hooks under `lib/<feature>/` when composition or option defaults are needed.
- The OpenAPI contract is the source of truth: if a field or endpoint is missing, fix it in the API (shared Zod schemas in `@hms/shared-types`) and regenerate — do not hand-declare response types in the web app. See `.claude/skills/api-integration/SKILL.md`.

## `proxy.ts` as Middleware (mandatory)

- Edge request gating lives in `apps/web/proxy.ts` (exported `proxy(request: NextRequest)` function + `config.matcher`) — Next.js 16's convention replacing `middleware.ts`. Do not create a `middleware.ts`.
- `proxy.ts` is the single place for route-level auth gating: read the access-token cookie (`#lib/auth/access-token-cookie`), decode/validate claims (`#lib/auth/access-token-claims`), and redirect unauthenticated or under-privileged users before the route renders.
- Protect new route groups by extending `config.matcher` (e.g. `'/admin/:path*'`) and the role checks — do not duplicate auth redirects inside pages or layouts.
- Keep it edge-safe: cookie reads, stateless JWT claim decoding, and redirects only. No Prisma, no Node-only APIs, no API calls; expired/invalid tokens are cleared (`response.cookies.delete`) before redirecting.
- `proxy.ts` gates navigation only — it is not authorization. Every protected API route is still enforced server-side by the NestJS `PermissionsGuard`.

## UI Components — shadcn via `@hms/ui` only (mandatory)

- All shadcn/ui components live in `packages/ui` (`@hms/ui`) and nowhere else. `apps/web` must not contain its own shadcn primitives, `components/ui/` folder, or copies of `cn`/`cva` utilities.
- Only use shadcn components that already exist in `packages/ui/src/components/` (currently: `button`, `card`, `checkbox`, `input`, `select`, `table`). Import them via the package exports: `import { Button } from '@hms/ui/components/button'` (or the root `@hms/ui` export).
- Need a new shadcn component? Generate it **into `packages/ui`** with the shadcn CLI using that package's `components.json` (style `new-york`, aliases `#components`, `#lib/utils`), then export it and consume it from `@hms/ui`. Never `shadcn add` inside `apps/web`.
- Do not import Radix primitives, `class-variance-authority`, or `tailwind-merge` directly in `apps/web` — those are `@hms/ui` implementation details behind its components and `#lib/utils`.
- Shared hooks and CASL/RBAC UI helpers also come from `@hms/ui` (`/hooks/*`, `/rbac/*`); global styles from `@hms/ui/styles/globals.css`.
- Styling: Tailwind utility classes composed with the `cn` helper; use `next/image` for images and `next/link` for navigation.
