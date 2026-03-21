import { SetMetadata } from '@nestjs/common';

export const ALLOW_GUEST_KEY = 'allowGuest';

/**
 * Mark a route as accessible by both authenticated users and guest token holders.
 * Guest users will have their request enriched with { guestToken } instead of a user object.
 */
export const AllowGuest = () => SetMetadata(ALLOW_GUEST_KEY, true);
