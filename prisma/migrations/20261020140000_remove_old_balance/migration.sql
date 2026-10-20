-- RNX-186 (RX-186, D190): removes the old balance. Nothing is deployed, so there is no data migration: the credit
-- ledger (credit_accounts, credit_ledger_entries) is the only balance. Drops users.balance, the transactions table and
-- the user_subscriptions counters messages_used and tokens_used. Destructive: their rows and values are gone.
-- The SQL is from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_userId_fkey";

-- AlterTable
ALTER TABLE "user_subscriptions" DROP COLUMN "messages_used",
DROP COLUMN "tokens_used";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "balance";

-- DropTable
DROP TABLE "transactions";
