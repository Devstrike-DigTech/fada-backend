import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  /** Previous secrets, accepted for verification only while rotating (see docs/SECURITY.md) */
  accessSecretPrevious: process.env.JWT_ACCESS_SECRET_PREVIOUS || undefined,
  refreshSecretPrevious: process.env.JWT_REFRESH_SECRET_PREVIOUS || undefined,
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
}));
