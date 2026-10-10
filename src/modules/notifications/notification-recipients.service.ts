import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';

/**
 * Resolves "who at this pharmacy should hear about it" into user ids.
 *   owner     → the pharmacy owner only (billing, SMS alerts)
 *   managers  → owner + operators
 *   branch    → managers + active staff assigned to that branch (or to no branch)
 */
@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  async pharmacyOwner(pharmacyId: string): Promise<string[]> {
    const p = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { ownerId: true },
    });
    return p ? this.activeOnly([p.ownerId]) : [];
  }

  async pharmacyManagers(pharmacyId: string): Promise<string[]> {
    const [pharmacy, profiles] = await Promise.all([
      this.prisma.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: { ownerId: true },
      }),
      this.prisma.pharmacistProfile.findMany({
        where: { pharmacyId, roleInPharmacy: { in: ['owner', 'operator'] } },
        select: { userId: true },
      }),
    ]);
    const ids = [pharmacy?.ownerId, ...profiles.map((p) => p.userId)].filter(
      (x): x is string => !!x,
    );
    return this.activeOnly(ids);
  }

  async pharmacyBranchTeam(
    pharmacyId: string,
    branchId?: string,
  ): Promise<string[]> {
    const [managers, staff] = await Promise.all([
      this.pharmacyManagers(pharmacyId),
      this.prisma.pharmacyStaff.findMany({
        where: {
          pharmacyId,
          isActive: true,
          ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        },
        select: { userId: true },
      }),
    ]);
    return this.activeOnly([...managers, ...staff.map((s) => s.userId)]);
  }

  private async activeOnly(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique }, isActive: true },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
