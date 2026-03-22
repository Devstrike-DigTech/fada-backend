-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('primary', 'secondary');

-- CreateEnum
CREATE TYPE "PrescriptionType" AS ENUM ('otc', 'prescription_only', 'controlled');

-- AlterTable: add type as nullable first, backfill, then set NOT NULL
ALTER TABLE "drug_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "drug_categories" ADD COLUMN "type" "CategoryType";
UPDATE "drug_categories" SET "type" = 'primary' WHERE "type" IS NULL;
ALTER TABLE "drug_categories" ALTER COLUMN "type" SET NOT NULL;

-- AlterTable
ALTER TABLE "drugs" DROP COLUMN IF EXISTS "is_prescription",
ADD COLUMN "prescription_type" "PrescriptionType";
