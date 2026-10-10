import { NotificationContent } from './notification.types';

/**
 * Copy for every event-driven notification. Pure functions so wording can
 * be reviewed and tested without the event bus.
 */

const fmtDate = (d: Date | string | undefined | null): string => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
};

const naira = (kobo?: number): string =>
  kobo === undefined ? '' : `₦${(kobo / 100).toLocaleString('en-NG')}`;

const reasonSuffix = (reason?: string): string =>
  reason && !['by pharmacy', 'by admin'].includes(reason)
    ? ` Reason: ${reason}.`
    : '';

// ─── Reservations ─────────────────────────────────────────────────────────────

export const msg = {
  reservationCreated: (p: {
    reservationId: string;
    code: string;
    items: { drugName: string; quantity: number }[];
  }): NotificationContent => {
    const first = p.items[0]?.drugName ?? 'a drug';
    const more = p.items.length > 1 ? ` and ${p.items.length - 1} more` : '';
    return {
      title: `New reservation ${p.code}`,
      body: `A customer reserved ${first}${more}. Confirm it so they know to come in.`,
      link: `pharmacy/reservations/${p.reservationId}`,
      data: { reservationId: p.reservationId, code: p.code },
    };
  },

  reservationConfirmed: (p: {
    reservationId: string;
    code: string;
    pharmacyName: string;
  }): NotificationContent => ({
    title: 'Reservation confirmed',
    body: `${p.pharmacyName} has set your drugs aside. Show code ${p.code} when you arrive.`,
    link: `reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  reservationReady: (p: {
    reservationId: string;
    code: string;
    pharmacyName: string;
  }): NotificationContent => ({
    title: 'Ready for pickup',
    body: `Your reservation ${p.code} is ready at ${p.pharmacyName}.`,
    link: `reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  reservationServed: (p: {
    reservationId: string;
    code: string;
    pharmacyName: string;
  }): NotificationContent => ({
    title: 'Reservation collected',
    body: `You picked up ${p.code} from ${p.pharmacyName}. Thanks for using FADA.`,
    link: `reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  reservationCancelledByPharmacy: (p: {
    reservationId: string;
    code: string;
    pharmacyName: string;
    reason?: string;
  }): NotificationContent => ({
    title: 'Reservation cancelled',
    body: `${p.pharmacyName} cancelled reservation ${p.code}.${reasonSuffix(p.reason)}`,
    link: `reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  reservationCancelledByCustomer: (p: {
    reservationId: string;
    code: string;
    reason?: string;
  }): NotificationContent => ({
    title: 'Reservation cancelled',
    body: `The customer cancelled reservation ${p.code}. Any stock set aside is free again.${reasonSuffix(p.reason)}`,
    link: `pharmacy/reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  reservationStockOut: (p: {
    reservationId: string;
    code: string;
    pharmacyName: string;
  }): NotificationContent => ({
    title: 'Reservation cancelled: out of stock',
    body: `${p.pharmacyName} ran out of a drug in ${p.code}, so the reservation was cancelled. Search again to find it nearby.`,
    link: `reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  reservationExpired: (p: {
    reservationId: string;
    code: string;
  }): NotificationContent => ({
    title: 'Reservation expired',
    body: `Reservation ${p.code} was not collected in time and has expired.`,
    link: `reservations/${p.reservationId}`,
    data: { reservationId: p.reservationId, code: p.code },
  }),

  // ─── Inventory ──────────────────────────────────────────────────────────────

  stockLow: (p: {
    drugId: string;
    drugName: string;
    branchName: string;
    quantity: number;
  }): NotificationContent => ({
    title: `Low stock: ${p.drugName}`,
    body: `Only ${p.quantity} left at ${p.branchName}. Restock to keep appearing in customer searches.`,
    link: `pharmacy/inventory/${p.drugId}`,
    data: { drugId: p.drugId },
  }),

  stockOut: (p: {
    drugId: string;
    drugName: string;
    branchName: string;
  }): NotificationContent => ({
    title: `Out of stock: ${p.drugName}`,
    body: `${p.drugName} is out of stock at ${p.branchName}. Pending reservations for it were cancelled.`,
    link: `pharmacy/inventory/${p.drugId}`,
    data: { drugId: p.drugId },
    sms: `FADA: ${p.drugName} is out of stock at ${p.branchName}. Restock in the app to keep receiving reservations.`,
  }),

  batchUploadDone: (p: {
    jobId: string;
    success: number;
    failed: number;
  }): NotificationContent => ({
    title: 'Inventory upload finished',
    body:
      p.failed > 0
        ? `${p.success} drugs added, ${p.failed} rows need fixing.`
        : `${p.success} drugs added to your inventory.`,
    link: `pharmacy/inventory/uploads/${p.jobId}`,
    data: { jobId: p.jobId },
  }),

  // ─── Billing ────────────────────────────────────────────────────────────────

  subscriptionActivated: (p: {
    planName: string;
    expiresAt: Date;
    interval: string;
  }): NotificationContent => ({
    title: `${p.planName} plan active`,
    body: `Your ${p.planName} plan (${p.interval}) is active until ${fmtDate(p.expiresAt)}.`,
    link: 'pharmacy/subscription',
    email: {
      subject: `Your ${p.planName} plan is active`,
      heading: `Welcome to ${p.planName}`,
      body: `Your ${p.planName} plan (${p.interval}) is now active and runs until ${fmtDate(p.expiresAt)}.\n\nYour new inventory slots, branches and features are available right away.`,
      tone: 'success',
    },
  }),

  paymentFailed: (p: {
    planName: string;
    amountKobo?: number;
    graceUntil?: Date;
    reason?: string;
  }): NotificationContent => {
    const until = p.graceUntil ? ` until ${fmtDate(p.graceUntil)}` : '';
    return {
      title: `Payment failed for ${p.planName}`,
      body: `We could not renew your ${p.planName} plan${p.amountKobo ? ` (${naira(p.amountKobo)})` : ''}. It stays active${until}. Update your card or pay in the app to keep it.`,
      link: 'pharmacy/subscription',
      email: {
        subject: `Action needed: ${p.planName} payment failed`,
        heading: 'We could not renew your plan',
        body: `The renewal payment for your ${p.planName} plan${p.amountKobo ? ` (${naira(p.amountKobo)})` : ''} did not go through${p.reason ? `: ${p.reason}` : ''}.\n\nYour plan stays active${until}. After that your pharmacy moves to the free Sokka plan and loses its extra inventory slots and branches.\n\nOpen the FADA pharmacy app and go to Subscription to pay or update your card.`,
        tone: 'warning',
      },
      sms: `FADA: Your ${p.planName} renewal payment failed. Pay in the app${until} to keep your plan.`,
    };
  },

  planExpired: (p: {
    planName: string;
    downgradedTo?: string;
  }): NotificationContent => ({
    title: `Your ${p.planName} plan has ended`,
    body: `Your pharmacy is now on the ${p.downgradedTo ?? 'free'} plan. Resubscribe any time to restore your limits.`,
    link: 'pharmacy/subscription',
    email: {
      subject: `Your ${p.planName} plan has ended`,
      heading: `Your ${p.planName} plan has ended`,
      body: `We did not receive payment, so your pharmacy has moved to the ${p.downgradedTo ?? 'free'} plan.\n\nDrugs beyond your new inventory limit stay saved but are hidden from search until you resubscribe.`,
      tone: 'danger',
    },
  }),

  subscriptionCancelled: (p: {
    planName: string;
    accessUntil: Date;
  }): NotificationContent => ({
    title: 'Auto-renewal turned off',
    body: `Your ${p.planName} plan stays active until ${fmtDate(p.accessUntil)}, then moves to the free plan.`,
    link: 'pharmacy/subscription',
    email: {
      subject: `Your ${p.planName} plan will not renew`,
      heading: 'Auto-renewal turned off',
      body: `Your ${p.planName} plan stays active until ${fmtDate(p.accessUntil)}. After that your pharmacy moves to the free Sokka plan.\n\nChanged your mind? Resubscribe from the Subscription screen before then.`,
      tone: 'info',
    },
  }),

  planChanged: (p: {
    previousPlanName: string;
    newPlanName: string;
    effectiveImmediately: boolean;
    effectiveAt: Date;
  }): NotificationContent => ({
    title: p.effectiveImmediately
      ? `You are now on ${p.newPlanName}`
      : `Plan change scheduled`,
    body: p.effectiveImmediately
      ? `Your plan changed from ${p.previousPlanName} to ${p.newPlanName}.`
      : `Your plan will change from ${p.previousPlanName} to ${p.newPlanName} on ${fmtDate(p.effectiveAt)}.`,
    link: 'pharmacy/subscription',
  }),

  // ─── Ads ────────────────────────────────────────────────────────────────────

  adApproved: (p: {
    campaignId: string;
    title: string;
  }): NotificationContent => ({
    title: 'Ad approved',
    body: `"${p.title}" was approved. It goes live once paid and its start date arrives.`,
    link: `pharmacy/ads/${p.campaignId}`,
    data: { campaignId: p.campaignId },
  }),

  adRejected: (p: {
    campaignId: string;
    title: string;
    reason?: string;
  }): NotificationContent => ({
    title: 'Ad needs changes',
    body: `"${p.title}" was not approved.${p.reason ? ` ${p.reason}` : ''} Edit it and it will be reviewed again.`,
    link: `pharmacy/ads/${p.campaignId}`,
    data: { campaignId: p.campaignId },
  }),

  adActivated: (p: {
    campaignId: string;
    title: string;
  }): NotificationContent => ({
    title: 'Your ad is live',
    body: `"${p.title}" is now showing to customers nearby.`,
    link: `pharmacy/ads/${p.campaignId}`,
    data: { campaignId: p.campaignId },
  }),

  adExpired: (p: {
    campaignId: string;
    title: string;
  }): NotificationContent => ({
    title: 'Ad campaign ended',
    body: `"${p.title}" has finished. See how it performed in Ads analytics.`,
    link: `pharmacy/ads/${p.campaignId}/analytics`,
    data: { campaignId: p.campaignId },
  }),

  // ─── Pharmacy ───────────────────────────────────────────────────────────────

  pharmacyVerified: (): NotificationContent => ({
    title: 'Your pharmacy is verified',
    body: 'Customers can now find your pharmacy in search and reserve your drugs.',
    link: 'pharmacy/profile',
    email: {
      subject: 'Your pharmacy is now live on FADA',
      heading: 'You are verified',
      body: 'Your PCN licence and CAC registration have been verified. Your pharmacy now appears in customer searches and can receive reservations.\n\nAdd your drugs and working hours so customers know what you stock and when you are open.',
      tone: 'success',
    },
  }),

  // ─── Support ────────────────────────────────────────────────────────────────

  ticketReceived: (p: {
    ticketId: string;
    ticketNumber: string;
    subject: string;
  }): NotificationContent => ({
    title: `We got your message (${p.ticketNumber})`,
    body: `Thanks for reaching out about "${p.subject}". Our team usually replies within 24 hours.`,
    link: `support/tickets/${p.ticketId}`,
    data: { ticketId: p.ticketId, ticketNumber: p.ticketNumber },
  }),

  ticketReply: (p: {
    ticketId: string;
    ticketNumber: string;
    preview?: string;
  }): NotificationContent => ({
    title: `New reply on ${p.ticketNumber}`,
    body: p.preview
      ? `FADA Support: ${p.preview}`
      : 'FADA Support replied to your ticket.',
    link: `support/tickets/${p.ticketId}`,
    data: { ticketId: p.ticketId, ticketNumber: p.ticketNumber },
  }),

  ticketStatus: (p: {
    ticketId: string;
    ticketNumber: string;
    subject: string;
    status: string;
    note?: string | null;
  }): NotificationContent => {
    const label: Record<string, string> = {
      in_review: 'is being looked at',
      resolved: 'has been resolved',
      closed: 'has been closed',
      pending: 'was reopened',
    };
    const done = p.status === 'resolved' || p.status === 'closed';
    return {
      title: `Ticket ${p.ticketNumber} ${label[p.status] ?? `is now ${p.status}`}`,
      body: p.note
        ? p.note
        : `Your ticket "${p.subject}" ${label[p.status] ?? `is now ${p.status}`}.`,
      link: `support/tickets/${p.ticketId}`,
      data: {
        ticketId: p.ticketId,
        ticketNumber: p.ticketNumber,
        status: p.status,
      },
      email: done
        ? {
            subject: `[${p.ticketNumber}] ${p.subject}: ${p.status}`,
            heading: `Your ticket ${label[p.status]}`,
            body: `${p.note ?? `We have marked "${p.subject}" as ${p.status}.`}\n\nIf this did not solve it, reply in the app and the ticket will reopen.`,
            tone: 'success',
          }
        : undefined,
    };
  },

  suggestionStatus: (p: {
    title: string;
    status: string;
    note?: string | null;
  }): NotificationContent => {
    const label: Record<string, string> = {
      reviewing: 'is being reviewed',
      planned: 'is on our roadmap',
      shipped: 'is now live',
      declined: 'will not be built for now',
    };
    return {
      title: `Your idea ${label[p.status] ?? `is ${p.status}`}`,
      body: p.note
        ? `"${p.title}": ${p.note}`
        : `Thanks for suggesting "${p.title}".`,
      link: 'support/suggestions',
      data: { status: p.status },
    };
  },

  // ─── Points ─────────────────────────────────────────────────────────────────

  levelUp: (p: {
    toLevel: number;
    levelName: string;
    forPharmacy: boolean;
  }): NotificationContent => ({
    title: `You reached LVL ${p.toLevel}: ${p.levelName}`,
    body: p.forPharmacy
      ? `Your pharmacy is now LVL ${p.toLevel}. The new badge shows on your search results.`
      : `Nice work. You are now LVL ${p.toLevel} on FADA.`,
    link: p.forPharmacy ? 'pharmacy/points' : 'points',
    data: { level: p.toLevel },
  }),
};

export type MessageKey = keyof typeof msg;
