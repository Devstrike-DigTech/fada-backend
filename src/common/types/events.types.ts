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
    PROFILE_COMPLETED: 'pharmacy.profile.completed',
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
    BATCH_UPLOAD_PROGRESS: 'inventory.batch_upload.progress',
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
    CAMPAIGN_SUBMITTED: 'ads.campaign.submitted',
    CAMPAIGN_APPROVED: 'ads.campaign.approved',
    CAMPAIGN_REJECTED: 'ads.campaign.rejected',
    CAMPAIGN_ACTIVATED: 'ads.campaign.activated',
    CAMPAIGN_PAUSED: 'ads.campaign.paused',
    CAMPAIGN_RESUMED: 'ads.campaign.resumed',
    CAMPAIGN_EXPIRED: 'ads.campaign.expired',
    CAMPAIGN_CANCELLED: 'ads.campaign.cancelled',
    IMPRESSION_RECORDED: 'ads.impression.recorded',
    CLICK_RECORDED: 'ads.click.recorded',
    RATING_RECORDED: 'ads.rating.recorded',
    PAYMENT_SUCCESSFUL: 'ads.payment.successful',
  },

  // Promotion Events (back office)
  PROMOTION: {
    CREATED: 'promotion.created',
    UPDATED: 'promotion.updated',
    REDEEMED: 'promotion.redeemed',
  },

  // Admin / Back-office Events
  ADMIN: {
    ACTION_PERFORMED: 'admin.action.performed',
    SUBSCRIPTION_OVERRIDDEN: 'admin.subscription.overridden',
  },

  // Points Events
  POINTS: {
    EARNED: 'points.earned',
    REDEEMED: 'points.redeemed',
    EXPIRED: 'points.expired',
    MILESTONE_REACHED: 'points.milestone.reached',
    LEVEL_UPGRADED: 'points.level.upgraded',
    ADJUSTED: 'points.adjusted',
  },

  // Search Events
  SEARCH: {
    PERFORMED: 'search.performed',
    DRUG_FOUND: 'search.drug.found',
    DRUG_NOT_FOUND: 'search.drug.not_found',
    GEO_RADIUS_EXPANDED: 'search.geo.radius_expanded',
    GUEST_LIMIT_REACHED: 'search.guest.limit_reached',
    RESULTS_SERVED: 'search.results.served',
  },

  // Customer Events
  CUSTOMER: {
    PROFILE_UPDATED: 'customer.profile.updated',
    PROFILE_COMPLETED: 'customer.profile.completed',
    ADDRESS_ADDED: 'customer.address.added',
    DRUG_SAVED: 'customer.drug.saved',
    DRUG_UNSAVED: 'customer.drug.unsaved',
    PHARMACY_SAVED: 'customer.pharmacy.saved',
    PHARMACY_UNSAVED: 'customer.pharmacy.unsaved',
    LIST_CREATED: 'customer.list.created',
    LIST_RESERVED: 'customer.list.reserved',
    SEARCH_HISTORY_RECORDED: 'customer.search_history.recorded',
  },

  // Support Events
  SUPPORT: {
    TICKET_CREATED: 'support.ticket.created',
    TICKET_STATUS_CHANGED: 'support.ticket.status_changed',
    TICKET_STAFF_REPLIED: 'support.ticket.staff_replied',
    TICKET_USER_REPLIED: 'support.ticket.user_replied',
    SUGGESTION_CREATED: 'support.suggestion.created',
    SUGGESTION_STATUS_CHANGED: 'support.suggestion.status_changed',
  },

  // Content Events
  CONTENT: {
    UPDATED: 'content.updated',
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

export interface BatchUploadProgressPayload {
  jobId: string;
  pharmacyId: string;
  branchId: string;
  status: 'processing' | 'completed' | 'completed_with_errors' | 'failed';
  processed: number;
  total: number;
  added: number;
  errors: number;
  percent: number;
  message?: string;
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
  branchId?: string;
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
  branchId?: string;
  expiredAt: Date;
}

// Subscription Payloads
export interface SubscriptionPaymentInitializedPayload {
  pharmacyId: string;
  subscriptionId: string;
  billingRecordId: string;
  planId: string;
  planName: string;
  billingInterval: string;
  amountKobo: number;
  reference: string;
  provider: string;
  initializedAt: Date;
}

export interface SubscriptionPaymentSuccessfulPayload {
  pharmacyId: string;
  subscriptionId: string;
  planId: string;
  planName: string;
  amountKobo: number;
  reference: string;
  provider: string;
  paidAt: Date;
  expiresAt: Date;
}

export interface SubscriptionPaymentFailedPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  amountKobo?: number;
  reference?: string;
  provider: string;
  reason?: string;
  graceUntil?: Date;
  failedAt: Date;
}

export interface SubscriptionActivatedPayload {
  pharmacyId: string;
  subscriptionId: string;
  planId: string;
  planName: string;
  billingInterval: string;
  activatedAt: Date;
  expiresAt: Date;
}

export interface SubscriptionRenewedPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  renewedAt: Date;
  expiresAt: Date;
}

export interface SubscriptionPlanChangedPayload {
  pharmacyId: string;
  subscriptionId: string;
  previousPlanId: string;
  previousPlanName: string;
  newPlanId: string;
  newPlanName: string;
  billingInterval: string;
  /** true when the change was applied now; false when scheduled for the next renewal */
  effectiveImmediately: boolean;
  effectiveAt: Date;
}

export interface SubscriptionCancelledPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  cancelledAt: Date;
  /** Access continues until this date */
  accessUntil: Date;
}

export interface SubscriptionGracePeriodPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  graceUntil: Date;
}

export interface SubscriptionExpiredPayload {
  pharmacyId: string;
  subscriptionId: string;
  planName: string;
  /** Plan the pharmacy was moved to (the free plan) */
  downgradedToPlanName?: string;
  expiredAt: Date;
}

// Ads Payloads
export interface AdCampaignPayload {
  campaignId: string;
  pharmacyId: string;
  title: string;
  drugId?: string | null;
  status: string;
  reviewStatus?: string;
  occurredAt: Date;
  reason?: string;
}

export interface AdPaymentSuccessfulPayload {
  campaignId: string;
  pharmacyId: string;
  billingRecordId: string;
  amountKobo: number;
  reference: string;
  provider: string;
  paidAt: Date;
}

export interface AdEngagementPayload {
  campaignId: string;
  pharmacyId: string;
  customerId?: string;
  guestToken?: string;
  occurredAt: Date;
}

export interface AdRatingRecordedPayload {
  campaignId: string;
  pharmacyId: string;
  customerId: string;
  stars: number;
  averageRating: number;
  ratingCount: number;
  occurredAt: Date;
}

// Promotion Payloads
export interface PromotionPayload {
  promotionId: string;
  code: string;
  name: string;
  adminUserId?: string;
  occurredAt: Date;
}

export interface PromotionRedeemedPayload {
  promotionId: string;
  code: string;
  pharmacyId: string;
  discountNgn: number;
  billingRecordId?: string;
  adCampaignId?: string;
  occurredAt: Date;
}

// Admin Payloads
export interface AdminActionPayload {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  occurredAt: Date;
}

// Points Payloads
export interface PointsEarnedPayload {
  /** Customer user id (customer ledgers) */
  userId?: string;
  /** Pharmacy id (pharmacy ledgers) */
  pharmacyId?: string;
  ledgerId: string;
  points: number;
  newBalance: number;
  lifetimeEarned: number;
  reason: string;
  ruleKey?: string;
  referenceId?: string;
  referenceType?: string;
  earnedAt: Date;
}

export interface PointsLevelUpgradedPayload {
  userId?: string;
  pharmacyId?: string;
  ledgerId: string;
  fromLevel: number;
  toLevel: number;
  levelName: string;
  lifetimeEarned: number;
  upgradedAt: Date;
}

export interface PharmacyProfileCompletedPayload {
  pharmacyId: string;
  completedAt: Date;
}

export interface PointsRedeemedPayload {
  userId: string;
  points: number;
  reason: string;
  referenceId?: string;
  redeemedAt: Date;
}

// Search Payloads
export type SearchKind = 'drug' | 'ailment' | 'pharmacy';

export interface SearchPerformedPayload {
  userId?: string;
  guestToken?: string;
  query: string;
  searchType?: SearchKind;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  resultCount: number;
  searchedAt: Date;
}

/** Which pharmacies a search showed — feeds search-appearance analytics. */
export interface SearchResultsServedPayload {
  searchType: SearchKind;
  query?: string;
  /** Total matches (all pages) */
  resultCount: number;
  /** Distinct pharmacies on the page actually returned */
  pharmacyIds: string[];
  userId?: string;
  guestToken?: string;
  servedAt: Date;
}

// Customer Payloads
export interface CustomerProfileUpdatedPayload {
  customerId: string;
  changedFields: string[];
  isComplete: boolean;
  updatedAt: Date;
}

export interface CustomerAddressPayload {
  customerId: string;
  addressId: string;
  isDefault: boolean;
  occurredAt: Date;
}

export interface CustomerSavePayload {
  customerId: string;
  /** drugId or pharmacyId */
  targetId: string;
  pharmacyId?: string;
  occurredAt: Date;
}

export interface CustomerListPayload {
  customerId: string;
  listId: string;
  name: string;
  itemCount: number;
  reservationId?: string;
  occurredAt: Date;
}

export interface GeoRadiusExpandedPayload {
  userId?: string;
  guestToken?: string;
  query: string;
  previousRadiusKm: number;
  newRadiusKm: number;
  expandedAt: Date;
}

// Support Payloads
export interface SupportTicketPayload {
  ticketId: string;
  ticketNumber: string;
  submitterId: string | null;
  category: string;
  subject: string;
  status: string;
  previousStatus?: string;
  resolutionNote?: string | null;
  messagePreview?: string;
  occurredAt: Date;
}

export interface FeatureSuggestionPayload {
  suggestionId: string;
  submitterId: string | null;
  title: string;
  status: string;
  previousStatus?: string;
  adminNote?: string | null;
  occurredAt: Date;
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
  | BatchUploadProgressPayload
  | ReservationCreatedPayload
  | ReservationStatusChangedPayload
  | ReservationExpiredPayload
  | SubscriptionPaymentInitializedPayload
  | SubscriptionPaymentSuccessfulPayload
  | SubscriptionPaymentFailedPayload
  | SubscriptionActivatedPayload
  | SubscriptionRenewedPayload
  | SubscriptionPlanChangedPayload
  | SubscriptionCancelledPayload
  | SubscriptionGracePeriodPayload
  | SubscriptionExpiredPayload
  | AdCampaignPayload
  | AdPaymentSuccessfulPayload
  | AdEngagementPayload
  | AdRatingRecordedPayload
  | PromotionPayload
  | PromotionRedeemedPayload
  | AdminActionPayload
  | PointsEarnedPayload
  | PointsLevelUpgradedPayload
  | PharmacyProfileCompletedPayload
  | PointsRedeemedPayload
  | SearchPerformedPayload
  | GeoRadiusExpandedPayload
  | SearchResultsServedPayload
  | CustomerProfileUpdatedPayload
  | CustomerAddressPayload
  | CustomerSavePayload
  | CustomerListPayload
  | SupportTicketPayload
  | FeatureSuggestionPayload
  | PushNotificationRequestedPayload
  | SmsNotificationRequestedPayload
  | EmailNotificationRequestedPayload;
