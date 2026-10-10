import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { ParsedRoom } from './socket-rooms';

export interface SocketUser {
  id: string;
  role: string;
}

/**
 * Decides whether a connected user may join a room. Mirrors the HTTP access
 * rules: customers see their own reservations; pharmacy owners, operators and
 * unassigned staff see the whole pharmacy; branch-assigned staff see only
 * their branch; billing is owner / operators only; admins see everything.
 */
@Injectable()
export class SocketAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async canJoin(user: SocketUser, room: ParsedRoom): Promise<boolean> {
    if (user.role === 'admin') return true;
    const id = room.id ?? '';

    switch (room.kind) {
      case 'user':
      case 'customer_reservations':
        return id === user.id;

      case 'admin_feed':
        return false;

      case 'pharmacy_reservations':
        return (await this.scope(user.id, id)).wholePharmacy;

      case 'pharmacy_billing':
        return (await this.scope(user.id, id)).manager;

      case 'branch_reservations': {
        const branch = await this.prisma.branch.findUnique({
          where: { id },
          select: { pharmacyId: true },
        });
        return (
          !!branch && (await this.canSeeBranch(user.id, branch.pharmacyId, id))
        );
      }

      case 'reservation': {
        const r = await this.prisma.reservation.findUnique({
          where: { id },
          select: {
            customerId: true,
            branchId: true,
            branch: { select: { pharmacyId: true } },
          },
        });
        if (!r) return false;
        if (r.customerId === user.id) return true;
        return this.canSeeBranch(user.id, r.branch.pharmacyId, r.branchId);
      }

      case 'batch_upload': {
        const job = await this.prisma.batchUploadJob.findUnique({
          where: { id },
          select: { branchId: true },
        });
        if (!job) return false;
        const branch = await this.prisma.branch.findUnique({
          where: { id: job.branchId },
          select: { pharmacyId: true },
        });
        return (
          !!branch &&
          (await this.canSeeBranch(user.id, branch.pharmacyId, job.branchId))
        );
      }
    }
  }

  private async canSeeBranch(
    userId: string,
    pharmacyId: string,
    branchId: string,
  ): Promise<boolean> {
    const s = await this.scope(userId, pharmacyId);
    return s.wholePharmacy || s.branchIds.includes(branchId);
  }

  /** What this user can see inside one pharmacy. */
  private async scope(userId: string, pharmacyId: string) {
    const [profile, staff] = await Promise.all([
      this.prisma.pharmacistProfile.findFirst({
        where: { userId, pharmacyId },
        select: { roleInPharmacy: true },
      }),
      this.prisma.pharmacyStaff.findMany({
        where: { userId, pharmacyId, isActive: true },
        select: { role: true, branchId: true },
      }),
    ]);
    const manager =
      profile?.roleInPharmacy === 'owner' ||
      profile?.roleInPharmacy === 'operator' ||
      staff.some((s) => s.role === 'operator');
    const wholePharmacy =
      !!profile || staff.some((s) => s.branchId === null) || manager;
    return {
      manager,
      wholePharmacy,
      branchIds: staff.map((s) => s.branchId).filter((b): b is string => !!b),
    };
  }
}
