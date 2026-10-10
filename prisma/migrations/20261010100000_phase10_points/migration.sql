-- Phase 10 — Points & Reputation

-- AlterEnum
ALTER TYPE "PointsReason" ADD VALUE 'admin_adjustment';

-- AlterTable: points_ledgers (owner is a user OR a pharmacy)
ALTER TABLE "points_ledgers" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "points_ledgers"
  ADD COLUMN "pharmacy_id" TEXT,
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: points_transactions
ALTER TABLE "points_transactions"
  ADD COLUMN "balance_after" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "created_by_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "points_ledgers_pharmacy_id_key" ON "points_ledgers"("pharmacy_id");
CREATE INDEX "points_ledgers_balance_idx" ON "points_ledgers"("balance");
CREATE UNIQUE INDEX "points_transactions_ledger_id_reason_reference_id_key" ON "points_transactions"("ledger_id", "reason", "reference_id");
CREATE INDEX "points_transactions_ledger_id_created_at_idx" ON "points_transactions"("ledger_id", "created_at");

-- AddForeignKey
ALTER TABLE "points_ledgers" ADD CONSTRAINT "points_ledgers_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
