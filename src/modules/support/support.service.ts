import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import {
  EVENTS,
  EmailNotificationRequestedPayload,
  FeatureSuggestionPayload,
  SupportTicketPayload,
} from '@common/types/events.types';
import {
  COMPLAINT_CATEGORIES,
  MAX_SUGGESTIONS_PER_DAY,
  MAX_TICKETS_PER_DAY,
  SUGGESTION_AREAS,
  areaLabel,
  categoryLabel,
} from './support.constants';
import {
  AdminSuggestionQueryDto,
  AdminTicketMessageDto,
  AdminTicketQueryDto,
  AdminUpdateSuggestionDto,
  AdminUpdateTicketDto,
  ComplaintQueryDto,
  CreateComplaintDto,
  CreateSuggestionDto,
  TicketMessageDto,
} from './dto/support.dto';

const ticketSuffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const DAY_MS = 24 * 60 * 60 * 1000;

const TICKET_LIST_SELECT = {
  id: true,
  ticketNumber: true,
  complaintType: true,
  subject: true,
  status: true,
  priority: true,
  reservationId: true,
  pharmacyId: true,
  resolutionNote: true,
  lastActivityAt: true,
  resolvedAt: true,
  createdAt: true,
  _count: { select: { messages: { where: { isInternal: false } } } },
} satisfies Prisma.SupportTicketSelect;

/**
 * Support tickets and feature suggestions. Users (customers, pharmacists,
 * staff) file and follow up on tickets; the back office triages, replies,
 * and resolves. Status changes and staff replies notify the submitter
 * through events picked up by the notifications module.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly supportInbox?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    config: ConfigService,
  ) {
    this.supportInbox = config.get<string>('app.supportInboxEmail');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Reference data
  // ═══════════════════════════════════════════════════════════════════════════

  categories() {
    return {
      complaintCategories: COMPLAINT_CATEGORIES.map(({ key, label }) => ({
        key,
        label,
      })),
      suggestionAreas: SUGGESTION_AREAS,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tickets — user side
  // ═══════════════════════════════════════════════════════════════════════════

  async createComplaint(
    user: { sub: string; role: string; email: string },
    dto: CreateComplaintDto,
  ) {
    const recent = await this.prisma.supportTicket.count({
      where: {
        submitterId: user.sub,
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
      },
    });
    if (recent >= MAX_TICKETS_PER_DAY) {
      throw new HttpException(
        'You have opened a lot of tickets today. Please reply on an existing ticket or try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Resolve and authorise the reservation / pharmacy context
    let pharmacyId = dto.pharmacyId;
    if (dto.reservationId) {
      const r = await this.prisma.reservation.findUnique({
        where: { id: dto.reservationId },
        select: { customerId: true, branch: { select: { pharmacyId: true } } },
      });
      if (!r) throw new NotFoundException('Reservation not found');
      const isCustomer = r.customerId === user.sub;
      const isMember =
        !isCustomer &&
        (await this.isPharmacyMember(user.sub, r.branch.pharmacyId));
      if (!isCustomer && !isMember) {
        throw new ForbiddenException(
          'You can only raise tickets about your own reservations',
        );
      }
      pharmacyId = pharmacyId ?? r.branch.pharmacyId;
    }
    if (pharmacyId) {
      const exists = await this.prisma.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Pharmacy not found');
    }

    const category = COMPLAINT_CATEGORIES.find((c) => c.key === dto.category)!;
    const ticket = await this.createWithUniqueNumber({
      submitterId: user.sub,
      submitterRole: user.role,
      complaintType: dto.category,
      subject: dto.subject.trim(),
      description: dto.description.trim(),
      priority: category.defaultPriority as SupportTicketPriority,
      reservationId: dto.reservationId,
      pharmacyId,
    });

    this.emitTicket(EVENTS.SUPPORT.TICKET_CREATED, ticket);
    this.copyToInbox(ticket, user.email);
    this.logger.log(
      `Ticket ${ticket.ticketNumber} opened by ${user.sub} (${dto.category})`,
    );
    return this.presentTicket(ticket);
  }

  async listMyComplaints(userId: string, query: ComplaintQueryDto) {
    const where: Prisma.SupportTicketWhereInput = {
      submitterId: userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        select: TICKET_LIST_SELECT,
        orderBy: { lastActivityAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return {
      items: items.map((t) => this.presentTicket(t)),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  async getMyComplaint(userId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, submitterId: userId },
      include: {
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return {
      ...this.presentTicket(ticket),
      description: ticket.description,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        body: m.body,
        fromSupport: m.isStaff,
        createdAt: m.createdAt,
      })),
    };
  }

  /** User follow-up. Reopens a resolved ticket; closed tickets are final. */
  async replyToMyComplaint(userId: string, id: string, dto: TicketMessageDto) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, submitterId: userId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'closed') {
      throw new ConflictException(
        'This ticket is closed. Please open a new one.',
      );
    }

    const reopen = ticket.status === 'resolved';
    const now = new Date();
    const [message, updated] = await this.prisma.$transaction([
      this.prisma.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: userId,
          isStaff: false,
          body: dto.body.trim(),
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: {
          lastActivityAt: now,
          ...(reopen ? { status: 'pending', resolvedAt: null } : {}),
        },
      }),
    ]);

    this.emitTicket(EVENTS.SUPPORT.TICKET_USER_REPLIED, updated, {
      previousStatus: ticket.status,
      messagePreview: dto.body.slice(0, 140),
    });
    return {
      message: {
        id: message.id,
        body: message.body,
        fromSupport: false,
        createdAt: message.createdAt,
      },
      status: updated.status,
      reopened: reopen,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Suggestions — user side
  // ═══════════════════════════════════════════════════════════════════════════

  async createSuggestion(userId: string, dto: CreateSuggestionDto) {
    const recent = await this.prisma.featureSuggestion.count({
      where: {
        submitterId: userId,
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
      },
    });
    if (recent >= MAX_SUGGESTIONS_PER_DAY) {
      throw new HttpException(
        'Thanks for all the ideas! Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const s = await this.prisma.featureSuggestion.create({
      data: {
        submitterId: userId,
        area: dto.area,
        title: dto.title.trim(),
        description: dto.description.trim(),
      },
    });
    const payload: FeatureSuggestionPayload = {
      suggestionId: s.id,
      submitterId: userId,
      title: s.title,
      status: s.status,
      occurredAt: s.createdAt,
    };
    this.eventBus.emit(EVENTS.SUPPORT.SUGGESTION_CREATED, payload);
    return this.presentSuggestion(s);
  }

  async listMySuggestions(userId: string, query: ComplaintQueryDto) {
    const where: Prisma.FeatureSuggestionWhereInput = { submitterId: userId };
    const [items, total] = await Promise.all([
      this.prisma.featureSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.featureSuggestion.count({ where }),
    ]);
    return {
      items: items.map((s) => this.presentSuggestion(s)),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Back office
  // ═══════════════════════════════════════════════════════════════════════════

  async adminListTickets(query: AdminTicketQueryDto) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.category ? { complaintType: query.category } : {}),
      ...(query.assignedTo === 'unassigned'
        ? { assignedToId: null }
        : query.assignedTo
          ? { assignedToId: query.assignedTo }
          : {}),
      ...(query.search
        ? {
            OR: [
              { ticketNumber: { contains: query.search.toUpperCase() } },
              { subject: { contains: query.search, mode: 'insensitive' } },
              {
                submitter: {
                  email: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          submitter: {
            select: {
              id: true,
              email: true,
              fadaId: true,
              role: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: { select: { messages: true } },
        },
        // Open work first: urgent → low, then most recently active
        orderBy: [
          { status: 'asc' },
          { priority: 'desc' },
          { lastActivityAt: 'desc' },
        ],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    return {
      items: items.map((t) => ({
        ...this.presentTicket(t),
        submitter: t.submitter,
        assignedToId: t.assignedToId,
        messageCount: t._count.messages,
      })),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
        countsByStatus: Object.fromEntries(
          byStatus.map((r) => [r.status, r._count._all]),
        ),
      },
    };
  }

  async adminGetTicket(id: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        submitter: {
          select: {
            id: true,
            email: true,
            phone: true,
            fadaId: true,
            role: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found');

    const [reservation, pharmacy, otherTickets] = await Promise.all([
      t.reservationId
        ? this.prisma.reservation.findUnique({
            where: { id: t.reservationId },
            select: {
              id: true,
              alphanumericCode: true,
              status: true,
              createdAt: true,
              branchId: true,
            },
          })
        : null,
      t.pharmacyId
        ? this.prisma.pharmacy.findUnique({
            where: { id: t.pharmacyId },
            select: { id: true, name: true, fadaId: true, phone: true },
          })
        : null,
      t.submitterId
        ? this.prisma.supportTicket.count({
            where: { submitterId: t.submitterId, NOT: { id } },
          })
        : 0,
    ]);

    return {
      ...this.presentTicket(t),
      description: t.description,
      assignedToId: t.assignedToId,
      submitter: t.submitter,
      submitterOtherTickets: otherTickets,
      reservation,
      pharmacy,
      messages: t.messages.map((m) => ({
        id: m.id,
        body: m.body,
        authorId: m.authorId,
        fromSupport: m.isStaff,
        internal: m.isInternal,
        createdAt: m.createdAt,
      })),
    };
  }

  async adminUpdateTicket(
    id: string,
    dto: AdminUpdateTicketDto,
    adminUserId: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (dto.assignedToId) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: dto.assignedToId },
        select: { role: true },
      });
      if (assignee?.role !== 'admin')
        throw new BadRequestException('Tickets can only be assigned to admins');
    }

    const statusChanged =
      dto.status !== undefined && dto.status !== ticket.status;
    const closing = dto.status === 'resolved' || dto.status === 'closed';
    const now = new Date();

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: dto.status,
        priority: dto.priority,
        assignedToId:
          dto.assignedToId === undefined ? undefined : dto.assignedToId,
        resolutionNote: dto.resolutionNote,
        lastActivityAt: now,
        ...(statusChanged ? { resolvedAt: closing ? now : null } : {}),
      },
    });

    if (dto.resolutionNote && closing) {
      await this.prisma.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: adminUserId,
          isStaff: true,
          body: dto.resolutionNote,
        },
      });
    }
    if (statusChanged) {
      this.emitTicket(EVENTS.SUPPORT.TICKET_STATUS_CHANGED, updated, {
        previousStatus: ticket.status,
      });
    }
    this.emitAdmin(adminUserId, 'support.ticket.update', id, {
      ...dto,
      previousStatus: ticket.status,
    });
    return this.adminGetTicket(id);
  }

  async adminReply(
    id: string,
    dto: AdminTicketMessageDto,
    adminUserId: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const internal = dto.internal ?? false;
    const moveToReview = !internal && ticket.status === 'pending';
    await this.prisma.$transaction([
      this.prisma.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: adminUserId,
          isStaff: true,
          isInternal: internal,
          body: dto.body.trim(),
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: {
          lastActivityAt: new Date(),
          ...(moveToReview
            ? { status: 'in_review' as SupportTicketStatus }
            : {}),
          // Replying claims an unassigned ticket
          ...(ticket.assignedToId ? {} : { assignedToId: adminUserId }),
        },
      }),
    ]);

    if (!internal) {
      const fresh = await this.prisma.supportTicket.findUniqueOrThrow({
        where: { id },
      });
      this.emitTicket(EVENTS.SUPPORT.TICKET_STAFF_REPLIED, fresh, {
        previousStatus: ticket.status,
        messagePreview: dto.body.slice(0, 140),
      });
    }
    this.emitAdmin(
      adminUserId,
      internal ? 'support.ticket.note' : 'support.ticket.reply',
      id,
      {},
    );
    return this.adminGetTicket(id);
  }

  async adminListSuggestions(query: AdminSuggestionQueryDto) {
    const where: Prisma.FeatureSuggestionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.area ? { area: query.area } : {}),
    };
    const [items, total, byArea] = await Promise.all([
      this.prisma.featureSuggestion.findMany({
        where,
        include: {
          submitter: { select: { id: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.featureSuggestion.count({ where }),
      this.prisma.featureSuggestion.groupBy({
        by: ['area'],
        _count: { _all: true },
      }),
    ]);
    return {
      items: items.map((s) => ({
        ...this.presentSuggestion(s),
        submitter: s.submitter,
      })),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
        countsByArea: Object.fromEntries(
          byArea.map((r) => [r.area, r._count._all]),
        ),
      },
    };
  }

  async adminUpdateSuggestion(
    id: string,
    dto: AdminUpdateSuggestionDto,
    adminUserId: string,
  ) {
    const s = await this.prisma.featureSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Suggestion not found');
    const updated = await this.prisma.featureSuggestion.update({
      where: { id },
      data: { status: dto.status, adminNote: dto.adminNote },
    });
    if (s.status !== dto.status) {
      const payload: FeatureSuggestionPayload = {
        suggestionId: id,
        submitterId: s.submitterId,
        title: s.title,
        status: dto.status,
        previousStatus: s.status,
        adminNote: dto.adminNote,
        occurredAt: new Date(),
      };
      this.eventBus.emit(EVENTS.SUPPORT.SUGGESTION_STATUS_CHANGED, payload);
    }
    this.emitAdmin(adminUserId, 'support.suggestion.update', id, {
      ...dto,
      previousStatus: s.status,
    });
    return this.presentSuggestion(updated);
  }

  /** Counts for the back-office dashboard. */
  async adminSummary() {
    const [open, unassigned, urgent, staleCutoff] = await Promise.all([
      this.prisma.supportTicket.count({
        where: { status: { in: ['pending', 'in_review'] } },
      }),
      this.prisma.supportTicket.count({
        where: { status: { in: ['pending', 'in_review'] }, assignedToId: null },
      }),
      this.prisma.supportTicket.count({
        where: {
          status: { in: ['pending', 'in_review'] },
          priority: { in: ['high', 'urgent'] },
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          status: 'pending',
          lastActivityAt: { lt: new Date(Date.now() - DAY_MS) },
        },
      }),
    ]);
    const newSuggestions = await this.prisma.featureSuggestion.count({
      where: { status: 'submitted' },
    });
    return {
      openTickets: open,
      unassignedTickets: unassigned,
      highPriorityOpen: urgent,
      pendingOver24h: staleCutoff,
      newSuggestions,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════════════════════════════════════════

  private async createWithUniqueNumber(
    data: Omit<Prisma.SupportTicketUncheckedCreateInput, 'ticketNumber'>,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.supportTicket.create({
          data: { ...data, ticketNumber: `TKT-${ticketSuffix()}` },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        )
          continue;
        throw err;
      }
    }
    throw new ConflictException(
      'Could not allocate a ticket number, please retry',
    );
  }

  private async isPharmacyMember(
    userId: string,
    pharmacyId: string,
  ): Promise<boolean> {
    const [profile, staff] = await Promise.all([
      this.prisma.pharmacistProfile.findFirst({
        where: { userId, pharmacyId },
        select: { id: true },
      }),
      this.prisma.pharmacyStaff.findFirst({
        where: { userId, pharmacyId, isActive: true },
        select: { id: true },
      }),
    ]);
    return !!profile || !!staff;
  }

  private presentTicket(t: {
    id: string;
    ticketNumber: string;
    complaintType: string;
    subject: string;
    status: SupportTicketStatus;
    priority: SupportTicketPriority;
    reservationId: string | null;
    pharmacyId: string | null;
    resolutionNote: string | null;
    lastActivityAt: Date;
    resolvedAt: Date | null;
    createdAt: Date;
    _count?: { messages: number };
  }) {
    return {
      id: t.id,
      ticketNumber: t.ticketNumber,
      category: t.complaintType,
      categoryLabel: categoryLabel(t.complaintType),
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      reservationId: t.reservationId,
      pharmacyId: t.pharmacyId,
      resolutionNote: t.resolutionNote,
      replyCount: t._count?.messages,
      lastActivityAt: t.lastActivityAt,
      resolvedAt: t.resolvedAt,
      createdAt: t.createdAt,
    };
  }

  private presentSuggestion(s: {
    id: string;
    area: string;
    title: string;
    description: string;
    status: string;
    adminNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      area: s.area,
      areaLabel: areaLabel(s.area),
      title: s.title,
      description: s.description,
      status: s.status,
      adminNote: s.adminNote,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private emitTicket(
    event: string,
    t: {
      id: string;
      ticketNumber: string;
      submitterId: string | null;
      complaintType: string;
      subject: string;
      status: string;
      resolutionNote: string | null;
    },
    extra: { previousStatus?: string; messagePreview?: string } = {},
  ): void {
    const payload: SupportTicketPayload = {
      ticketId: t.id,
      ticketNumber: t.ticketNumber,
      submitterId: t.submitterId,
      category: t.complaintType,
      subject: t.subject,
      status: t.status,
      previousStatus: extra.previousStatus,
      resolutionNote: t.resolutionNote,
      messagePreview: extra.messagePreview,
      occurredAt: new Date(),
    };
    this.eventBus.emit(event, payload);
  }

  private emitAdmin(
    adminUserId: string,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
  ) {
    this.eventBus.emit(EVENTS.ADMIN.ACTION_PERFORMED, {
      adminUserId,
      action,
      targetType: action.includes('suggestion')
        ? 'feature_suggestion'
        : 'support_ticket',
      targetId,
      details,
      occurredAt: new Date(),
    });
  }

  private copyToInbox(
    t: {
      ticketNumber: string;
      complaintType: string;
      subject: string;
      description: string;
      priority: string;
    },
    submitterEmail: string,
  ): void {
    if (!this.supportInbox) return;
    const payload: EmailNotificationRequestedPayload = {
      to: this.supportInbox,
      subject: `[${t.ticketNumber}] ${categoryLabel(t.complaintType)}: ${t.subject}`,
      templateId: 'notification',
      templateData: {
        heading: `New ticket ${t.ticketNumber}`,
        body: `From: ${submitterEmail}\nCategory: ${categoryLabel(t.complaintType)} (${t.priority} priority)\n\n${t.description}`,
        tone:
          t.priority === 'urgent' || t.priority === 'high' ? 'warning' : 'info',
      },
    };
    this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, payload);
  }
}
