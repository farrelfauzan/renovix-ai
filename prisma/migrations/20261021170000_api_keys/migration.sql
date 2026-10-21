-- RNX-18 (18a, D49, D50): API keys are stored hashed in their own table, several per user. A key is shown once at
-- creation; the table keeps its prefix (the lookup, unique) and its HMAC-SHA256 under API_KEY_HASH_SECRET, never
-- the plaintext. Deleting a user removes their keys. The plaintext users."apiKey" column is dropped: nothing is
-- deployed, so there are no keys to migrate (D49). Destructive: the old column's values are gone.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (hand-added, D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one;
-- with BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
BEGIN;

-- DropIndex
DROP INDEX "users_apiKey_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "apiKey";

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_user_id_created_at_idx" ON "api_keys"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
