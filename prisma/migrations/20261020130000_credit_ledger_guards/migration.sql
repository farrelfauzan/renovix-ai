-- RX-20 follow-up (D203): guards the credit ledger tables of 20261019120000_credit_ledger against values its CHECKs
-- let through. Additive: no row is read, converted or touched.
-- The foreign key SQL is from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- the CHECK constraints are written by hand (Prisma does not model them).
-- TRUNCATE stays accepted on purpose: the append-only trigger of 20261019120000 is statement-level for UPDATE and
-- DELETE only, and the test tooling empties the database with TRUNCATE (resetDatabase).

-- An entry's or a reservation's wallet is its account's wallet: (account_id, wallet) references (id, wallet).
-- DropForeignKey
ALTER TABLE "credit_ledger_entries" DROP CONSTRAINT "credit_ledger_entries_account_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_reservations" DROP CONSTRAINT "credit_reservations_account_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_id_wallet_key" ON "credit_accounts"("id", "wallet");

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_account_id_wallet_fkey" FOREIGN KEY ("account_id", "wallet") REFERENCES "credit_accounts"("id", "wallet") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_account_id_wallet_fkey" FOREIGN KEY ("account_id", "wallet") REFERENCES "credit_accounts"("id", "wallet") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: no amount is NaN. Postgres orders NaN above every number, so `>= 0` and `<= 0` alone let it through
-- and a NaN balance would accept any debit (I5). Infinity needs no CHECK: a numeric(18,6) column cannot hold it
-- ("numeric field overflow").
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_balance_not_nan_check" CHECK ("balance" <> 'NaN');
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_held_not_nan_check" CHECK ("held" <> 'NaN');
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_amount_not_nan_check" CHECK ("amount" <> 'NaN');
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_balance_after_not_nan_check" CHECK ("balance_after" <> 'NaN');
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_uncharged_not_nan_check" CHECK ("uncharged" <> 'NaN');
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_amount_held_not_nan_check" CHECK ("amount_held" <> 'NaN');
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_consumed_not_nan_check" CHECK ("consumed" <> 'NaN');

-- Hand-written: the sign of each entry type (docs/credits.md section 2.1). plan_grant, top_up and bonus add credits;
-- usage removes credits or none (credit_ledger_entries_usage_fields_check); weekly_reset, adjustment and refund take
-- either sign (section 2.1 does not fix the sign of a refund).
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_amount_sign_check"
    CHECK ("type" NOT IN ('plan_grant', 'top_up', 'bonus') OR "amount" > 0);
