-- RX-20: the credit ledger (docs/credits.md section 2): credit accounts (one row per account and wallet),
-- ledger entries (append-only) and reservations (table only; RX-22 writes them). Fresh start (section 8):
-- additive only, no existing row is read, converted or touched; User.balance, transactions and the
-- user_subscriptions counters stay as they are.
-- The table SQL is from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- the CHECK constraints, the partial unique index and the append-only trigger at the end are written by hand
-- (Prisma does not model them).

-- CreateEnum
CREATE TYPE "CreditWallet" AS ENUM ('paid', 'weekly_free');

-- CreateEnum
CREATE TYPE "CreditEntryType" AS ENUM ('plan_grant', 'top_up', 'bonus', 'weekly_reset', 'usage', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "CreditCallOutcome" AS ENUM ('completed', 'provider_error', 'client_cancel');

-- CreateEnum
CREATE TYPE "CreditReservationStatus" AS ENUM ('open', 'settled', 'released', 'expired');


-- CreateTable
CREATE TABLE "credit_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "company_id" TEXT,
    "wallet" "CreditWallet" NOT NULL,
    "balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "held" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "wallet" "CreditWallet" NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "CreditEntryType" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "balance_after" DECIMAL(18,6) NOT NULL,
    "uncharged" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "member_user_id" TEXT NOT NULL,
    "request_id" TEXT,
    "call_id" TEXT,
    "run_id" TEXT,
    "agent_id" TEXT,
    "parent_call_id" TEXT,
    "model_id" TEXT,
    "tier" TEXT,
    "rate_new" DECIMAL(18,12),
    "rate_cached" DECIMAL(18,12),
    "rate_out" DECIMAL(18,12),
    "tokens_new" INTEGER,
    "tokens_cached" INTEGER,
    "tokens_out" INTEGER,
    "outcome" "CreditCallOutcome",
    "reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_reservations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "wallet" "CreditWallet" NOT NULL,
    "request_id" TEXT NOT NULL,
    "run_id" TEXT,
    "amount_held" DECIMAL(18,6) NOT NULL,
    "consumed" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "status" "CreditReservationStatus" NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "credit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_user_id_wallet_key" ON "credit_accounts"("user_id", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_company_id_wallet_key" ON "credit_accounts"("company_id", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_entries_account_id_seq_key" ON "credit_ledger_entries"("account_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_entries_account_id_idempotency_key_key" ON "credit_ledger_entries"("account_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "credit_reservations_status_expires_at_idx" ON "credit_reservations"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written: an account belongs to exactly one owner, a user or a company.
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_one_owner_check"
    CHECK (num_nonnulls("user_id", "company_id") = 1);

-- Hand-written: I5. The balance is never negative and the holds never exceed it (available = balance - held >= 0).
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_balance_check" CHECK ("balance" >= 0);
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_held_check" CHECK ("held" >= 0 AND "held" <= "balance");

-- Hand-written: I5 on every entry, and nothing negative is recorded as uncharged.
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_balance_after_check" CHECK ("balance_after" >= 0);
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_uncharged_check" CHECK ("uncharged" >= 0);

-- Hand-written: which fields each type fills (docs/credits.md section 2.1). A usage entry has its request, call,
-- model, rates, token counts and outcome, and removes credits or none (I3); run_id, agent_id and parent_call_id
-- stay optional on it. Any other type has none of the usage fields.
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_usage_fields_check" CHECK (
    CASE WHEN "type" = 'usage'
        THEN num_nulls("request_id", "call_id", "model_id", "tier", "rate_new", "rate_cached", "rate_out",
                       "tokens_new", "tokens_cached", "tokens_out", "outcome") = 0 AND "amount" <= 0
        ELSE num_nonnulls("request_id", "call_id", "run_id", "agent_id", "parent_call_id", "model_id", "tier",
                          "rate_new", "rate_cached", "rate_out", "tokens_new", "tokens_cached", "tokens_out", "outcome") = 0
    END);

-- Hand-written: reference is set on every type except usage and weekly_reset, and only there.
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_reference_check"
    CHECK (("type" IN ('usage', 'weekly_reset')) = ("reference" IS NULL));

-- Hand-written: I3. A call_id appears on at most one usage entry.
CREATE UNIQUE INDEX "credit_ledger_entries_usage_call_id_key" ON "credit_ledger_entries"("call_id") WHERE "type" = 'usage';

-- Hand-written: I4 per reservation, 0 <= consumed <= amount_held.
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_consumed_check"
    CHECK ("consumed" >= 0 AND "consumed" <= "amount_held");

-- Hand-written: I7. Ledger entries are never updated or deleted (a correction is a new adjustment entry). The
-- trigger function is the one migration 20261015150000_offer_catalog created. It is a statement-level trigger, so
-- TRUNCATE is not refused: the test tooling empties the database with it (resetDatabase).
CREATE TRIGGER "credit_ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "credit_ledger_entries"
    FOR EACH STATEMENT EXECUTE FUNCTION "refuse_update_delete_append_only"();
