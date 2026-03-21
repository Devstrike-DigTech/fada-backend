import { registerAs } from '@nestjs/config';

export default registerAs('notifications', () => ({
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  termii: {
    apiKey: process.env.TERMII_API_KEY,
    apiUrl: process.env.TERMII_API_URL ?? 'https://api.ng.termii.com/api',
    senderId: process.env.TERMII_SENDER_ID ?? 'FADA',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM ?? 'noreply@thefadaapp.com',
    fromName: process.env.EMAIL_FROM_NAME ?? 'FADA',
  },
}));
