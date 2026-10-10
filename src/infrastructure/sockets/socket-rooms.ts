/**
 * Room names are the WebSocket contract with the apps. Everything a client
 * may subscribe to is listed here; anything else is rejected.
 *
 *   user:{userId}                     personal (auto-joined): notifications, ticket replies
 *   customer:{userId}:reservations    a customer's own reservations (auto-joined for customers)
 *   reservation:{reservationId}       one reservation: its customer + that pharmacy's team
 *   pharmacy:{pharmacyId}:reservations live reservation feed for the whole pharmacy
 *   branch:{branchId}:reservations    live feed for one branch (branch-assigned staff)
 *   pharmacy:{pharmacyId}:billing     subscription and ad payment updates (owner / operators)
 *   batch-upload:{jobId}              inventory upload progress
 *   admin:feed                        back-office live feed (auto-joined for admins)
 */

export type RoomKind =
  | 'user'
  | 'customer_reservations'
  | 'reservation'
  | 'pharmacy_reservations'
  | 'branch_reservations'
  | 'pharmacy_billing'
  | 'batch_upload'
  | 'admin_feed';

export interface ParsedRoom {
  kind: RoomKind;
  id: string | null;
  name: string;
}

export const rooms = {
  user: (id: string) => `user:${id}`,
  customerReservations: (id: string) => `customer:${id}:reservations`,
  reservation: (id: string) => `reservation:${id}`,
  pharmacyReservations: (id: string) => `pharmacy:${id}:reservations`,
  branchReservations: (id: string) => `branch:${id}:reservations`,
  pharmacyBilling: (id: string) => `pharmacy:${id}:billing`,
  batchUpload: (id: string) => `batch-upload:${id}`,
  adminFeed: () => 'admin:feed',
} as const;

const ID = '([0-9a-fA-F-]{8,64})';
const PATTERNS: [RegExp, RoomKind][] = [
  [new RegExp(`^user:${ID}$`), 'user'],
  [new RegExp(`^customer:${ID}:reservations$`), 'customer_reservations'],
  [new RegExp(`^reservation:${ID}$`), 'reservation'],
  [new RegExp(`^pharmacy:${ID}:reservations$`), 'pharmacy_reservations'],
  [new RegExp(`^branch:${ID}:reservations$`), 'branch_reservations'],
  [new RegExp(`^pharmacy:${ID}:billing$`), 'pharmacy_billing'],
  [new RegExp(`^batch-upload:${ID}$`), 'batch_upload'],
  [/^admin:feed$/, 'admin_feed'],
];

/** Parses a client-supplied room name; null for anything not in the contract. */
export function parseRoom(name: unknown): ParsedRoom | null {
  if (typeof name !== 'string' || name.length > 120) return null;
  for (const [re, kind] of PATTERNS) {
    const m = re.exec(name);
    if (m) return { kind, id: m[1] ?? null, name };
  }
  return null;
}

/** Server → client event names. */
export const SOCKET_EVENTS = {
  NOTIFICATION: 'notification',
  RESERVATION_CREATED: 'reservation.created',
  RESERVATION_UPDATED: 'reservation.updated',
  BATCH_UPLOAD_PROGRESS: 'batch-upload.progress',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  AD_PAYMENT_UPDATED: 'ad-payment.updated',
  SUPPORT_TICKET_UPDATED: 'support.ticket.updated',
  ADMIN_ACTIVITY: 'admin.activity',
} as const;
