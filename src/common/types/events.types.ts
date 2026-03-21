// ─── Event Name Constants ────────────────────────────────────────────────────

export const EVENTS = {
  // Auth Events
  AUTH: {
    USER_REGISTERED: 'auth.user.registered',
    USER_VERIFIED: 'auth.user.verified',
    USER_LOGGED_IN: 'auth.user.logged_in',
    PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
    PASSWORD_RESET_COMPLETED: 'auth.password.reset_completed',
    REFRESH_TOKEN_ROTATED: 'auth.token.refresh_rotated',
    ACCOUNT_DEACTIVATED: 'auth.account.deactivated',
  },

  // Pharmacy Events
  PHARMACY: {
    REGISTERED: 'pharmacy.registered',
    VERIFIED: 'pharmacy.verified',
    BRANCH_ADDED: 'pharmacy.branch.added',
    BRANCH_UPDATED: 'pharmacy.branch.updated',
    PCN_VERIFICATION_REQUESTED: 'pharmacy.pcn.verification_requested',
    PCN_VERIFICATION_COMPLETED: 'pharmacy.pcn.verification_completed',
    PCN_VERIFICATION_FAILED: 'pharmacy.pcn.verification_failed',
    CAC_VERIFICATION_REQUESTED: 'pharmacy.cac.verification_requested',
    CAC_VERIFICATION_COMPLETED: 'pharmacy.cac.verification_completed',
    CAC_VERIFICATION_FAILED: 'pharmacy.cac.verification_failed',
    SUBSCRIPTION_UPGRADED: 'pharmacy.subscription.upgraded',
    SUBSCRIPTION_DOWNGRADED: 'pharmacy.subscription.downgraded',
    SUBSCRIPTION_EXPIRED: 'pharmacy.subscription.expired',
  },

  // Inventory Events
  INVENTORY: {
    DRUG_ADDED: 'inventory.drug.added',
    DRUG_UPDATED: 'inventory.drug.updated',
    DRUG_REMOVED: 'inventory.drug.removed',
    STOCK_UPDATED: 'inventory.stock.updated',
    STOCK_LOW: 'inventory.stock.low',
    STOCK_OUT: 'inventory.stock.out',
    BATCH_UPLOAD_STARTED: 'inventory.batch_upload.started',
    BATCH_UPLOAD_COMPLETED: 'inventory.batch_upload.completed',
    BATCH_UPLOAD_FAILED: 'inventory.batch_upload.failed',
    NAFDAC_CACHE_REFRESHED: 'inventory.nafdac.cache_refreshed',
  },

  // Reservation Events
  RESERVATION: {
    CREATED: 'reservation.created',
    CONFIRMED: 'reservation.confirmed',
    READY: 'reservation.ready',
    SERVED: 'reservation.served',
    CANCELLED_BY_CUSTOMER: 'reservation.cancelled.customer',
    CANCELLED_BY_PHARMACY: 'reservation.cancelled.pharmacy',
    EXPIRED: 'reservation.expired',
    STOCK_OUT_CANCELLED: 'reservation.cancelled.stock_out',
  },

  // Subscription Events
  SUBSCRIPTION: {
    PLAN_SELECTED: 'subscription.plan.selected',
    PAYMENT_INITIALIZED: 'subscription.payment.initialized',
    PAYMENT_SUCCESSFUL: 'subscription.payment.successful',
    PAYMENT_FAILED: 'subscription.payment.failed',
    ACTIVATED: 'subscription.activated',
    RENEWED: 'subscription.renewed',
    CANCELLED: 'subscription.cancelled',
    TRIAL_STARTED: 'subscription.trial.started',
    TRIAL_ENDING: 'subscription.trial.ending',
    TRIAL_EXPIRED: 'subscription.trial.expired',
    UPGRADED: 'subscription.upgraded',
    DOWNGRADED: 'subscription.downgraded',
    GRACE_PERIOD_STARTED: 'subscription.grace_period.started',
    GRACE_PERIOD_EXPIRED: 'subscription.grace_period.expired',
  },

  // Ads Events
  ADS: {
    CAMPAIGN_CREATED: 'ads.campaign.created',
    CAMPAIGN_ACTIVATED: 'ads.campaign.activated',
    CAMPAIGN_PAUSED: 'ads.campaign.paused',
    CAMPAIGN_EXPIRED: 'ads.campaign.expired',
    IMPRESSION_RECORDED: 'ads.impression.recorded',
    CLICK_RECORDED: 'ads.click.recorded',
    PAYMENT_SUCCESSFUL: 'ads.payment.successful',
  },

  // Points Events
  POINTS: {
    EARNED: 'points.earned',
    REDEEMED: 'points.redeemed',
    EXPIRED: 'points.expired',
    MILESTONE_REACHED: 'points.milestone.reached',
  },

  // Search Events
  SEARCH: {
    PERFORMED: 'search.performed',
    DRUG_FOUND: 'search.drug.found',
    DRUG_NOT_FOUND: 'search.drug.not_found',
    GEO_RADIUS_EXPANDED: 'search.geo.radius_expanded',
    GUEST_LIMIT_REACHED: 'search.guest.limit_reached',
  },

  // Notification Events
  NOTIFICATION: {
    PUSH_SEND_REQUESTED: 'notification.push.send_requested',
    SMS_SEND_REQUESTED: 'notification.sms.send_requested',
    EMAIL_SEND_REQUESTED: 'notification.email.send_requested',
    SEND_FAILED: 'notification.send.failed',
  },
} as const;

// ─── Event Payload Types ──────────────────────────────────────────────────────

// Auth Payloads
export interface UserRegisteredPayload {
  userId: string;
  email: string;
  role: string;
  registeredAt: Date;
}

export interface UserVerifiedPayload {
  userId: string;
  email: string;
  verifiedAt: Date;
}

export interface UserLoggedInPayload {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  loggedInAt: Date;
}

export interface PasswordResetRequestedPayload {
  userId: string;
  email: string;
  otpCode: string;
  expiresAt: Date;
}

// Pharmacy Payloads
export interface PharmacyRegisteredPayload {
  pharmacyId: string;
  pharmacistId: string;
  pharmacyName: string;
  registeredAt: Date;
}

export interface PharmacyVerifiedPayload {
  pharmacyId: string;
  verifiedAt: Date;
}

export interface PcnVerificationRequestedPayload {
  pharmacistId: string;
  licenseNumber: string;
  licenseType: string;
  queueJobId?: string;
}

export interface PcnVerificationCompletedPayload {
  pharmacistId: string;
  licenseNumber: string;
  isValid: boolean;
  verifiedAt: Date;
}

export interface CacVerificationRequestedPayload {
  pharmacyId: string;
  cacNumber: string;
  businessName: string;
  queueJobId?: string;
}

export interface CacVerificationCompletedPayload {
  pharmacyId: string;
  cacNumber: string;
  isValid: boolean;
  verifiedAt: Date;
}

// Inventory Payloads
export interface DrugAddedPayload {
  drugId: string;
  branchId: string;
  pharmacyId: string;
  nafdacNumber?: string;
  drugName: string;
  quantity: number;
  addedAt: Date;
}

export interface StockUpdatedPayload {
  drugId: string;
  branchId: string;
  pharmacyId: string;
  previousQuantity: number;
  newQuantity: number;
  updatedAt: Date;
}

export interface StockLowPayload {
  drugId: string;
  branchId: string;
  pharmacyId: string;
  pharmacistUserId: string;
  currentQuantity: number;
  threshold: number;
}

export interface StockOutPayload {
  drugId: string;
  branchId: string;
  pharmacyId: string;
  pharmacistUserId: string;
  affectedReservationIds: string[];
}

export interface BatchUploadStartedPayload {
  jobId: string;
  pharmacyId: string;
  branchId: string;
  fileUrl: string;
  totalRows: number;
  startedAt: Date;
}

export interface BatchUploadCompletedPayload {
  jobId: string;
  pharmacyId: string;
  branchId: string;
  successCount: number;
  failureCount: number;
  completedAt: Date;
}

// Reservation Payloads
export interface ReservationCreatedPayload {
  reservationId: string;
  reservationCode: string;
  customerId: string;
  branchId: string;
  pharmacyId: string;
  items: Array<{
    drugId: string;
    drugName: string;
    quantity: number;
  }>;
  expiresAt: Date;
  createdAt: Date;
}

export interface ReservationStatusChangedPayload {
  reservationId: string;
  reservationCode: string;
  customerId: string;
  pharmacistId?: string;
  pharmacyId: string;
  previousStatus: string;
  newStatus: string;
  changedAt: Date;
  reason?: string;
}

export interface ReservationExpiredPayload {
  reservationId: string;
  reservationCode: string;
  customerId: string;
  pharmacyId: string;
  expiredAt: Date;
}

// Subscription Payloads
export interface SubscriptionPaymentSuccessfulPayload {
  pharmacyId: string;
  subscriptionId: string;
  planId: string;
  planName: string;
  amountKobo: number;
  reference: string;
  paidAt: Date;
  expiresAt: Date;
}

export interface SubscriptionActivatedPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  activatedAt: Date;
  expiresAt: Date;
}

export interface SubscriptionExpiredPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  expiredAt: Date;
}

// Points Payloads
export interface PointsEarnedPayload {
  userId: string;
  points: number;
  reason: string;
  referenceId?: string;
  referenceType?: string;
  earnedAt: Date;
}

export interface PointsRedeemedPayload {
  userId: string;
  points: number;
  reason: string;
  referenceId?: string;
  redeemedAt: Date;
}

// Search Payloads
export interface SearchPerformedPayload {
  userId?: string;
  guestToken?: string;
  query: string;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  resultCount: number;
  searchedAt: Date;
}

export interface GeoRadiusExpandedPayload {
  userId?: string;
  guestToken?: string;
  query: string;
  previousRadiusKm: number;
  newRadiusKm: number;
  expandedAt: Date;
}

// Notification Payloads
export interface PushNotificationRequestedPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface SmsNotificationRequestedPayload {
  to: string;
  message: string;
  userId?: string;
}

export interface EmailNotificationRequestedPayload {
  to: string;
  subject: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
  html?: string;
  userId?: string;
}

// ─── Union type for all event payloads ───────────────────────────────────────
export type EventPayload =
  | UserRegisteredPayload
  | UserVerifiedPayload
  | UserLoggedInPayload
  | PasswordResetRequestedPayload
  | PharmacyRegisteredPayload
  | PharmacyVerifiedPayload
  | PcnVerificationRequestedPayload
  | PcnVerificationCompletedPayload
  | CacVerificationRequestedPayload
  | CacVerificationCompletedPayload
  | DrugAddedPayload
  | StockUpdatedPayload
  | StockLowPayload
  | StockOutPayload
  | BatchUploadStartedPayload
  | BatchUploadCompletedPayload
  | ReservationCreatedPayload
  | ReservationStatusChangedPayload
  | ReservationExpiredPayload
  | SubscriptionPaymentSuccessfulPayload
  | SubscriptionActivatedPayload
  | SubscriptionExpiredPayload
  | PointsEarnedPayload
  | PointsRedeemedPayload
  | SearchPerformedPayload
  | GeoRadiusExpandedPayload
  | PushNotificationRequestedPayload
  | SmsNotificationRequestedPayload
  | EmailNotificationRequestedPayload;
