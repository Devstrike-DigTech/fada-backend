/**
 * Category and area lists mirror the customer app's dropdowns. The API
 * accepts the slug; labels are returned for display.
 */
export const COMPLAINT_CATEGORIES = [
  { key: 'general_inquiry', label: 'General Inquiry', defaultPriority: 'low' },
  {
    key: 'reservation_issue',
    label: 'Reservation Issue',
    defaultPriority: 'normal',
  },
  { key: 'payment_problem', label: 'Payment Problem', defaultPriority: 'high' },
  {
    key: 'pharmacy_complaint',
    label: 'Pharmacy Complaint',
    defaultPriority: 'normal',
  },
  {
    key: 'drug_not_available',
    label: 'Drug Not Available',
    defaultPriority: 'normal',
  },
  {
    key: 'wrong_drug_dispensed',
    label: 'Wrong Drug Dispensed',
    defaultPriority: 'urgent',
  },
  { key: 'account_issue', label: 'Account Issue', defaultPriority: 'normal' },
  { key: 'app_bug', label: 'App Bug', defaultPriority: 'normal' },
  { key: 'other', label: 'Other', defaultPriority: 'low' },
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number]['key'];
export const COMPLAINT_CATEGORY_KEYS = COMPLAINT_CATEGORIES.map(
  (c) => c.key,
) as string[];

export const SUGGESTION_AREAS = [
  { key: 'search_discovery', label: 'Search & Discovery' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'profile_account', label: 'Profile & Account' },
  { key: 'pharmacy_experience', label: 'Pharmacy Experience' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'payment_pricing', label: 'Payment & Pricing' },
  { key: 'drug_information', label: 'Drug Information' },
  { key: 'other', label: 'Other' },
] as const;

export const SUGGESTION_AREA_KEYS = SUGGESTION_AREAS.map(
  (a) => a.key,
) as string[];

export const categoryLabel = (key: string): string =>
  COMPLAINT_CATEGORIES.find((c) => c.key === key)?.label ?? key;

export const areaLabel = (key: string): string =>
  SUGGESTION_AREAS.find((a) => a.key === key)?.label ?? key;

/** Anti-spam: tickets one account may open per rolling 24 h */
export const MAX_TICKETS_PER_DAY = 10;
export const MAX_SUGGESTIONS_PER_DAY = 10;
