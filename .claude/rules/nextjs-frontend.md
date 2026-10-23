# Next.js Frontend Rules (`apps/chat`, `apps/back-office`, `apps/landing`)

Always applies to frontend code generated in this repository.

The Next.js 16 App Router apps (React 19, TypeScript strict, Tailwind 4, TanStack Query in chat) are `apps/chat`, `apps/back-office` and `apps/landing`. Commands run from the repo root with bun and Nx: `bun run dev:chat`, `bun run build:back-office`, `nx run-many --targets=serve,dev` for all apps at once (see the root `package.json` scripts; never npm).

## Project Structure

- `app/` — App Router routes and layouts. Route files (`page.tsx`, `layout.tsx`) stay server components and only compose; they contain no interactive logic.
- `components/server/` — server components that compose data + UI for a feature (fetch/session reads, no `'use client'`). The back-office uses this split (`apps/back-office/src/components/server/`, `…/components/client/`); chat composes per-feature folders plus `src/components/` (e.g. `chat/`, `agents/`, `workspace/`) with interactive components marked `'use client'` where needed.
- `components/client/` — interactive components; each starts with `'use client'`.
- `lib/` — feature logic and the HTTP layer. Chat: `apps/chat/src/lib/` (`api-client.ts`, `auth-client.ts`, `stores.ts`, …). Back-office: `apps/back-office/src/lib/api/` (`api-client.ts`, `create-api-client.ts`, `run-with-refresh-lock.ts`, …).
- `proxy.ts` — edge request gate (Next.js 16's replacement for `middleware.ts`), in chat: `apps/chat/src/proxy.ts`. The back-office and landing have no `proxy.ts` today.

## Server / Client Component Division (mandatory)

- Server Components are the default. Add `'use client'` only when the component needs state, effects, event handlers, browser APIs, or TanStack Query hooks.
- Split every feature UI component-wise:
  - **Server side** (`components/server/<feature>/`): data composition, async work, passing serializable props down.
  - **Client side** (`components/client/<feature>/`): forms, tables with interaction, dialogs, anything using hooks.
- A server component may render a client component; a client component must never import a server component.
- Push `'use client'` boundaries as deep (leaf-ward) as possible — don't mark a whole page tree client because one button needs a handler.
- **One component per file (mandatory).** Every file declares exactly one React component, exported as a named export, in a kebab-case file matching the component name (`data-table.tsx` → `DataTable`). Never define helper/sub-components in the same file — e.g. a customized row for a table lives in its own `data-table-row.tsx` next to `data-table.tsx`, not inside it. This applies to render helpers too: if JSX is worth naming, it's worth its own file. Sole exception: shadcn CLI-generated primitive files in the shared UI package (and, until that package is merged, the same files in `apps/chat/src/components/ui/`) (e.g. `select.tsx` exporting `Select`/`SelectTrigger`/`SelectContent`/…) keep their upstream multi-export structure so they stay regenerable — but any customization or composition built on top of them goes in its own file in the app that uses it.
- Use functional components with explicit prop types (no `any`), early returns, small single-purpose components.
- Frontend capability checks are **visibility only** — the API's `AccessGuard` (`apps/api/src/common/guards/access.guard.ts`) remains the source of truth.

## API Integration — hand-written clients (mandatory)

- Each app owns a hand-written API client in its `lib/`: chat's `apps/chat/src/lib/api-client.ts` and the back-office's `apps/back-office/src/lib/api/` modules. They own base URL, auth headers, and 401 handling. Never call `fetch` or axios directly in features, components, or route handlers — go through the app's client.
- Do not hand-declare API response shapes when a generated source exists; today none does (no client generation is in place). Keep request and response types near the client and infer from the API's actual responses.
- Consume TanStack Query hooks (`useQuery`-based) from client components only; wrap them in feature-level hooks when composition or option defaults are needed.

## `proxy.ts` as Middleware (chat only, mandatory)

- Edge request gating lives in `apps/chat/src/proxy.ts` (exported `proxy(request: NextRequest)` function + `config.matcher`) — Next.js 16's convention replacing `middleware.ts`. Do not create a `middleware.ts`.
- `proxy.ts` is the single place for route-level auth gating: read the session, decode/validate claims, and redirect unauthenticated or under-privileged users before the route renders.
- Protect new route groups by extending `config.matcher` and the role checks — do not duplicate auth redirects inside pages or layouts.
- Keep it edge-safe: cookie reads, stateless claim decoding, and redirects only. No Prisma, no Node-only APIs, no API calls; expired/invalid sessions are cleared before redirecting.
- `proxy.ts` gates navigation only — it is not authorization. Every protected API route is still enforced server-side by the NestJS `AccessGuard`.

## UI Components — shadcn, in the shared UI package (mandatory)

- The shadcn/ui primitives (new-york style, Radix primitives) and the shared token layer live in **one shared UI package of the Nx workspace** (D287), with its own `components.json`; generate new primitives with the shadcn CLI against that package. Its name and path are set by its build ticket. Until that package is merged, the existing primitives stay in `apps/chat/src/components/ui/`; do not create another app-local copy of a primitive meanwhile.
- Chat, back-office and landing import the primitives from the shared UI package. Use the primitives it already has (its ui folder is the list); add a missing one to the package with the shadcn CLI, never to an app. New UI controls are built from the shared primitives; a hand-built control is allowed only with the reason stated in the PR.
- Compose the primitives with Tailwind utility classes and the shared UI package's `cn` helper; use `next/image` for images and `next/link` for navigation.
- Each portal keeps its own composition in its own `src/components/`: feature components, layouts, and the mapping of the shared token layer onto its theme per its design canvas. Apps never import each other; code shared between apps lives only in the shared UI package, never in another app.
