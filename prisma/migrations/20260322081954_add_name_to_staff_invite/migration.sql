-- AlterTable
ALTER TABLE "pharmacy_staff_invites" ADD COLUMN     "first_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "last_name" TEXT NOT NULL DEFAULT '';

-- Remove defaults after adding (existing rows get empty string, future rows require value)
ALTER TABLE "pharmacy_staff_invites" ALTER COLUMN "first_name" DROP DEFAULT;
ALTER TABLE "pharmacy_staff_invites" ALTER COLUMN "last_name" DROP DEFAULT;
