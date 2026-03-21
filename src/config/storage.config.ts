import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  r2: {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    accessKey: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
    bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME ?? 'fada-storage',
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL,
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
}));
