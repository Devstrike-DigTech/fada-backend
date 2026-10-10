-- Phase 8 — Ads, Promotions & Back Office

-- AlterEnum
ALTER TYPE "BillingPurpose" ADD VALUE 'ad_campaign';

-- CreateEnum
CREATE TYPE "AdReviewStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "AdEventType" AS ENUM ('impression', 'click');
CREATE TYPE "PromotionDiscountType" AS ENUM ('percentage', 'fixed_amount');
CREATE TYPE "PromotionScope" AS ENUM ('subscriptions', 'ads', 'both');

-- CreateTable: promotions
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "PromotionDiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "max_discount_ngn" DECIMAL(10,2),
    "applies_to" "PromotionScope" NOT NULL DEFAULT 'both',
    "plan_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "billing_intervals" "BillingInterval"[] DEFAULT ARRAY[]::"BillingInterval"[],
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "auto_apply" BOOLEAN NOT NULL DEFAULT false,
    "max_redemptions" INTEGER,
    "max_redemptions_per_pharmacy" INTEGER NOT NULL DEFAULT 1,
    "redemptions_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- AlterTable: ad_campaigns
ALTER TABLE "ad_campaigns"
  ADD COLUMN "subtitle" TEXT,
  ADD COLUMN "special_points_title" TEXT,
  ADD COLUMN "special_points" JSONB,
  ADD COLUMN "creative_cloudinary_id" TEXT,
  ADD COLUMN "drug_type_filter" "DrugType",
  ADD COLUMN "target_latitude" DOUBLE PRECISION,
  ADD COLUMN "target_longitude" DOUBLE PRECISION,
  ADD COLUMN "daily_frequency" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "weekly_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "duration_weeks" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "base_rate_ngn" DECIMAL(10,2) NOT NULL DEFAULT 250,
  ADD COLUMN "list_price_ngn" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "plan_discount_pct" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "promotion_id" TEXT,
  ADD COLUMN "promotion_discount_ngn" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "price_ngn" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paid_at" TIMESTAMP(3),
  ADD COLUMN "review_status" "AdReviewStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewed_by_id" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "rejection_reason" TEXT,
  ADD COLUMN "activated_at" TIMESTAMP(3),
  ADD COLUMN "paused_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rating_sum" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: billing_records
ALTER TABLE "billing_records"
  ADD COLUMN "ad_campaign_id" TEXT,
  ADD COLUMN "promotion_id" TEXT,
  ADD COLUMN "list_amount" DECIMAL(10,2),
  ADD COLUMN "discount_ngn" DECIMAL(10,2);

-- CreateTable: ad_events
CREATE TABLE "ad_events" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "type" "AdEventType" NOT NULL,
    "customer_id" TEXT,
    "guest_token" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ad_ratings
CREATE TABLE "ad_ratings" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: promotion_redemptions
CREATE TABLE "promotion_redemptions" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "billing_record_id" TEXT,
    "ad_campaign_id" TEXT,
    "discount_ngn" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: admin_audit_logs
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "details" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");
CREATE INDEX "promotions_is_active_starts_at_ends_at_idx" ON "promotions"("is_active", "starts_at", "ends_at");
CREATE INDEX "ad_campaigns_pharmacy_id_status_idx" ON "ad_campaigns"("pharmacy_id", "status");
CREATE INDEX "ad_campaigns_status_review_status_timeslot_start_idx" ON "ad_campaigns"("status", "review_status", "timeslot_start");
CREATE INDEX "billing_records_ad_campaign_id_idx" ON "billing_records"("ad_campaign_id");
CREATE INDEX "ad_events_campaign_id_type_created_at_idx" ON "ad_events"("campaign_id", "type", "created_at");
CREATE UNIQUE INDEX "ad_ratings_campaign_id_customer_id_key" ON "ad_ratings"("campaign_id", "customer_id");
CREATE INDEX "promotion_redemptions_promotion_id_pharmacy_id_idx" ON "promotion_redemptions"("promotion_id", "pharmacy_id");
CREATE INDEX "admin_audit_logs_admin_user_id_created_at_idx" ON "admin_audit_logs"("admin_user_id", "created_at");
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_ad_campaign_id_fkey" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_ratings" ADD CONSTRAINT "ad_ratings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_billing_record_id_fkey" FOREIGN KEY ("billing_record_id") REFERENCES "billing_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_ad_campaign_id_fkey" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
