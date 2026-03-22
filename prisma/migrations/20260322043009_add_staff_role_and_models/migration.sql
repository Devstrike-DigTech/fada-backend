-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('operator', 'staff');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'staff';

-- CreateTable
CREATE TABLE "pharmacy_staff" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "role" "StaffRole" NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_staff_invites" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "token" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pharmacy_staff_pharmacy_id_idx" ON "pharmacy_staff"("pharmacy_id");

-- CreateIndex
CREATE INDEX "pharmacy_staff_branch_id_idx" ON "pharmacy_staff"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_staff_user_id_pharmacy_id_key" ON "pharmacy_staff"("user_id", "pharmacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_staff_invites_token_key" ON "pharmacy_staff_invites"("token");

-- CreateIndex
CREATE INDEX "pharmacy_staff_invites_token_idx" ON "pharmacy_staff_invites"("token");

-- CreateIndex
CREATE INDEX "pharmacy_staff_invites_pharmacy_id_email_idx" ON "pharmacy_staff_invites"("pharmacy_id", "email");

-- AddForeignKey
ALTER TABLE "pharmacy_staff" ADD CONSTRAINT "pharmacy_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_staff" ADD CONSTRAINT "pharmacy_staff_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_staff" ADD CONSTRAINT "pharmacy_staff_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_staff" ADD CONSTRAINT "pharmacy_staff_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_staff_invites" ADD CONSTRAINT "pharmacy_staff_invites_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_staff_invites" ADD CONSTRAINT "pharmacy_staff_invites_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_staff_invites" ADD CONSTRAINT "pharmacy_staff_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
