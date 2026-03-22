-- AlterTable
ALTER TABLE "pharmacist_profiles" ADD COLUMN     "pcn_override_note" TEXT,
ADD COLUMN     "pcn_verification_source" TEXT,
ADD COLUMN     "pcn_verified_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "pharmacist_profiles" ADD CONSTRAINT "pharmacist_profiles_pcn_verified_by_id_fkey" FOREIGN KEY ("pcn_verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
