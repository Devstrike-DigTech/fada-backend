import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route as publicly accessible (no JWT required).
 * Use alongside @AllowGuest() if guest tokens should also be accepted.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
