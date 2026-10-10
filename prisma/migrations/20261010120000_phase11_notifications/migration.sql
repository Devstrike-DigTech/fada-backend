-- Phase 11 — Notifications

-- AlterEnum
ALTER TYPE "DevicePlatform" ADD VALUE 'web';

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('reservation', 'inventory', 'billing', 'ads', 'points', 'account', 'system', 'marketing');
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed', 'skipped');

-- AlterTable: notification_records
ALTER TABLE "notification_records"
  ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'system',
  ADD COLUMN "data" JSONB,
  ADD COLUMN "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
  ADD COLUMN "error" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "sent_at" TIMESTAMP(3);

-- AlterTable: device_tokens
ALTER TABLE "device_tokens"
  ADD COLUMN "device_name" TEXT,
  ADD COLUMN "app_version" TEXT,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable: notification_preferences
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "muted_categories" "NotificationCategory"[] DEFAULT ARRAY[]::"NotificationCategory"[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_records_recipient_id_type_dedupe_key_key" ON "notification_records"("recipient_id", "type", "dedupe_key");
CREATE INDEX "notification_records_recipient_id_type_created_at_idx" ON "notification_records"("recipient_id", "type", "created_at");
CREATE INDEX "notification_records_status_created_at_idx" ON "notification_records"("status", "created_at");
CREATE INDEX "device_tokens_user_id_is_active_idx" ON "device_tokens"("user_id", "is_active");
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
