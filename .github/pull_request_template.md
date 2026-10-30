<!--
Title: "RNX-<n>: <what works now>". Work without a ticket: "DOCS: ...", "CI: ...", "INFRA: ...".

Keep it to about one screen:
- Outcomes, not code. No code blocks, no file-by-file list.
- One to three bullets per acceptance criterion. If one needs more, the PR is probably too big.
- Delete any section or line that does not apply, including these comments.
-->

## Summary

**Ticket:** [RNX-<n>](https://plane.renovix.id/renovix-ai/browse/RNX-<n>/)
**Why:** <one or two sentences: what this unblocks or which problem it removes>
**Depends on:** <RNX-k / #PR, or "nothing">

## Acceptance criteria

<!-- Copy the ticket's acceptance criteria. Tick what this PR covers; say how in one line. -->

- [x] **AC1. <criterion>**: <how it is covered (test, or checked by hand)>
- [x] **AC2. <criterion>**: <...>
- [ ] AC3. <criterion>: <why not here, and where it is tracked>

## Start review here

1. `<path>`: <what to look for here>
2. `<path>`: <...>

Skip: <generated files (Prisma client, OpenAPI output, lockfile), wiring>.

## Rules touched

<!-- Keep only the lines this PR touches, each with a few words on how it holds. -->

- [ ] **Zod on input:** every new request body, query and param is parsed with Zod on the server
- [ ] **Permission check on the server:** new routes are guarded by `AccessGuard` / a server-side check, not only hidden in the UI
- [ ] **Negative test per denied path:** each denied role, tenant or state has a test that gets the denial
- [ ] **No secrets:** none committed, logged or returned; new secrets listed under How to test
- [ ] **Credits atomic and idempotent:** balance changes in one transaction, a retry charges once; model calls go through the credit service
- [ ] **Migration atomic (D247):** wrapped in `BEGIN`/`COMMIT` (or exemption named); data-changing ones show a planted-failure rollback check; backup note if it drops or rewrites data

## What the tests prove

<!-- One line per behavior, in plain words. The test file in brackets. No output. -->

- <behavior that is now guaranteed> (`<test file>`)
- <denied path that is refused> (`<test file>`)

## How to test

<!-- CI may be unavailable: list the commands you ran locally and their result in a few words. -->

- `bun run prisma:generate`: <ok>
- `bunx prisma validate`: <ok>
- `nx run api:test`: <n passed>
- `npx tsc --noEmit -p <app tsconfig>`: <0 errors>
- `bun run build:<app>`: <ok>
- <manual step, setup, new env var or secret name, migration to apply>

## Not in this PR

- <what is left for later, and where it is tracked>

## Risks

- <what could go wrong in production, and what limits it>
