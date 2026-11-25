-- RNX-357: the back-office user list (GET /admin/users) reads the users that are not deleted, newest sign-in first with
-- the users who never signed in last, then by id: ORDER BY last_login_at DESC NULLS LAST, id, one page of 50 (51 read).
-- Without an index the unfiltered page sorts every user that is not deleted; this partial index has the same order and
-- the same predicate as the query (status <> 'deleted'), so the page is read from the index and the scan stops after
-- the page (measured on 50,000 users: 66 ms to under 1 ms).
-- Changes no data: one new index.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`, with
-- NULLS LAST added by hand: Prisma's schema cannot say NULLS FIRST/LAST, and a DESC index is NULLS FIRST by default,
-- which does not match the query's order (the planner would sort again). `migrate diff` does not compare the NULLS
-- order, so it sees no drift. The predicate is written as Postgres prints it, as in the schema.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration. Not CONCURRENTLY, which cannot
-- run in a transaction (nothing is deployed, D190).
-- Rollback (manual):
-- BEGIN;
-- DROP INDEX "users_last_login_at_id_idx";
-- COMMIT;
BEGIN;

-- CreateIndex
CREATE INDEX "users_last_login_at_id_idx" ON "users"("last_login_at" DESC NULLS LAST, "id") WHERE (status <> 'deleted'::text);

COMMIT;
