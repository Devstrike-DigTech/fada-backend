-- Phase 12 — Support & Content

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE "ContentFormat" AS ENUM ('markdown', 'html', 'json');
CREATE TYPE "GoodCauseProjectStatus" AS ENUM ('upcoming', 'active', 'completed');

-- AlterTable: support_tickets (ticket_number backfilled for any existing rows, then made required)
ALTER TABLE "support_tickets"
  ADD COLUMN "ticket_number" TEXT,
  ADD COLUMN "submitter_role" TEXT,
  ADD COLUMN "subject" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "priority" "SupportTicketPriority" NOT NULL DEFAULT 'normal',
  ADD COLUMN "reservation_id" TEXT,
  ADD COLUMN "pharmacy_id" TEXT,
  ADD COLUMN "assigned_to_id" TEXT,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "support_tickets"
  SET "ticket_number" = 'TKT-' || UPPER(SUBSTRING(REPLACE("id", '-', '') FROM 1 FOR 6))
  WHERE "ticket_number" IS NULL;
ALTER TABLE "support_tickets" ALTER COLUMN "ticket_number" SET NOT NULL;

-- CreateTable: support_ticket_messages
CREATE TABLE "support_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_id" TEXT,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- AlterTable: feature_suggestions
ALTER TABLE "feature_suggestions"
  ADD COLUMN "area" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "admin_note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: app_content
ALTER TABLE "app_content"
  ADD COLUMN "format" "ContentFormat" NOT NULL DEFAULT 'markdown',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "effective_date" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT;

-- AlterTable: good_cause_projects
ALTER TABLE "good_cause_projects"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "image_cloudinary_id" TEXT,
  ADD COLUMN "status" "GoodCauseProjectStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "target_amount_ngn" DECIMAL(14,2),
  ADD COLUMN "raised_amount_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "beneficiaries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "start_date" TIMESTAMP(3),
  ADD COLUMN "end_date" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: good_cause_testimonials
ALTER TABLE "good_cause_testimonials"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "avatar_cloudinary_id" TEXT,
  ADD COLUMN "author_location" TEXT,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");
CREATE INDEX "support_tickets_submitter_id_created_at_idx" ON "support_tickets"("submitter_id", "created_at");
CREATE INDEX "support_tickets_status_priority_last_activity_at_idx" ON "support_tickets"("status", "priority", "last_activity_at");
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");
CREATE INDEX "feature_suggestions_status_created_at_idx" ON "feature_suggestions"("status", "created_at");
CREATE INDEX "good_cause_projects_is_active_sort_order_idx" ON "good_cause_projects"("is_active", "sort_order");
CREATE INDEX "good_cause_testimonials_is_active_sort_order_idx" ON "good_cause_testimonials"("is_active", "sort_order");

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "good_cause_testimonials" ADD CONSTRAINT "good_cause_testimonials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "good_cause_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
