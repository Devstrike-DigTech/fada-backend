-- CreateEnum
CREATE TYPE "ProspectStage" AS ENUM ('to_call', 'to_visit', 'visited');

-- CreateEnum
CREATE TYPE "ProspectStoreType" AS ENUM ('small', 'medium', 'large', 'hospital');

-- CreateEnum
CREATE TYPE "ProspectResponse" AS ENUM ('positive', 'neutral', 'negative');

-- CreateEnum
CREATE TYPE "ProspectInteractionType" AS ENUM ('call', 'visit');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'marketer';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sales_routes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_prospects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "route_id" TEXT NOT NULL,
    "store_type" "ProspectStoreType",
    "stage" "ProspectStage" NOT NULL DEFAULT 'to_call',
    "last_call_response" "ProspectResponse",
    "last_called_at" TIMESTAMP(3),
    "last_visit_response" "ProspectResponse",
    "last_visited_at" TIMESTAMP(3),
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "added_by_id" TEXT NOT NULL,
    "converted_pharmacy_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_interactions" (
    "id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "marketer_id" TEXT NOT NULL,
    "type" "ProspectInteractionType" NOT NULL,
    "response" "ProspectResponse" NOT NULL,
    "comment" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_routes_name_key" ON "sales_routes"("name");

-- CreateIndex
CREATE INDEX "pharmacy_prospects_stage_deleted_at_idx" ON "pharmacy_prospects"("stage", "deleted_at");

-- CreateIndex
CREATE INDEX "pharmacy_prospects_route_id_idx" ON "pharmacy_prospects"("route_id");

-- CreateIndex
CREATE INDEX "pharmacy_prospects_phone_normalized_idx" ON "pharmacy_prospects"("phone_normalized");

-- CreateIndex
CREATE INDEX "pharmacy_prospects_added_by_id_idx" ON "pharmacy_prospects"("added_by_id");

-- CreateIndex
CREATE INDEX "prospect_interactions_prospect_id_occurred_at_idx" ON "prospect_interactions"("prospect_id", "occurred_at");

-- CreateIndex
CREATE INDEX "prospect_interactions_marketer_id_occurred_at_idx" ON "prospect_interactions"("marketer_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "pharmacy_prospects" ADD CONSTRAINT "pharmacy_prospects_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "sales_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prospects" ADD CONSTRAINT "pharmacy_prospects_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prospects" ADD CONSTRAINT "pharmacy_prospects_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_prospects" ADD CONSTRAINT "pharmacy_prospects_converted_pharmacy_id_fkey" FOREIGN KEY ("converted_pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_interactions" ADD CONSTRAINT "prospect_interactions_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "pharmacy_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_interactions" ADD CONSTRAINT "prospect_interactions_marketer_id_fkey" FOREIGN KEY ("marketer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

