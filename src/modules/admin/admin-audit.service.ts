import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EVENTS, AdminActionPayload } from '@common/types/events.types';

export interface AuditQuery {
  adminUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

/**
 * Immutable trail of back-office actions. Written directly by admin
 * controllers and also fed by `admin.*` events emitted deeper in the stack
 * (e.g. subscription overrides), so nothing money- or plan-affecting is missed.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: {
    adminUserId: string;
    action: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminUserId: entry.adminUserId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          details: (entry.details ?? null) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress,
        },
      });
    } catch (err) {
      // Auditing must never break the action itself
      this.logger.error(
        `Failed to write audit log for ${entry.action}`,
        err as Error,
      );
    }
  }

  @OnEvent(EVENTS.ADMIN.SUBSCRIPTION_OVERRIDDEN, { async: true })
  @OnEvent(EVENTS.ADMIN.ACTION_PERFORMED, { async: true })
  async onAdminEvent(payload: AdminActionPayload): Promise<void> {
    await this.log({
      adminUserId: payload.adminUserId,
      action: payload.action,
      targetType: payload.targetType,
      targetId: payload.targetId,
      details: payload.details,
    });
  }

  async list(query: AuditQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.adminUserId ? { adminUserId: query.adminUserId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    const adminIds = [...new Set(items.map((i) => i.adminUserId))];
    const admins = adminIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const adminById = new Map(admins.map((a) => [a.id, a]));

    return {
      items: items.map((i) => ({
        ...i,
        admin: adminById.get(i.adminUserId) ?? null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
