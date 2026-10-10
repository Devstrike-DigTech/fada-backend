-- Phase 7 — Subscription & Payments

-- CreateEnum
CREATE TYPE "BillingPurpose" AS ENUM ('new_subscription', 'renewal', 'plan_change');

-- AlterTable: subscription_plans
ALTER TABLE "subscription_plans"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "provider_plan_codes" JSONB;

-- AlterTable: pharmacy_subscriptions
ALTER TABLE "pharmacy_subscriptions"
  ADD COLUMN "payment_provider" "PaymentProvider",
  ADD COLUMN "paystack_authorization_code" TEXT,
  ADD COLUMN "pending_plan_id" TEXT,
  ADD COLUMN "pending_billing_interval" "BillingInterval",
  ADD COLUMN "last_plan_change_at" TIMESTAMP(3),
  ADD COLUMN "grace_until" TIMESTAMP(3);

-- AlterTable: billing_records
ALTER TABLE "billing_records"
  ADD COLUMN "purpose" "BillingPurpose" NOT NULL DEFAULT 'new_subscription',
  ADD COLUMN "plan_id" TEXT,
  ADD COLUMN "billing_interval" "BillingInterval",
  ADD COLUMN "description" TEXT,
  ADD COLUMN "failure_reason" TEXT,
  ADD COLUMN "provider_metadata" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "billing_records_provider_reference_key" ON "billing_records"("provider_reference");
CREATE INDEX "billing_records_subscription_id_created_at_idx" ON "billing_records"("subscription_id", "created_at");
CREATE INDEX "pharmacy_subscriptions_status_current_period_end_idx" ON "pharmacy_subscriptions"("status", "current_period_end");

-- AddForeignKey
ALTER TABLE "pharmacy_subscriptions"
  ADD CONSTRAINT "pharmacy_subscriptions_pending_plan_id_fkey"
  FOREIGN KEY ("pending_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
