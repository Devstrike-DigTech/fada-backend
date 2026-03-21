import { registerAs } from '@nestjs/config';

export default registerAs('payments', () => ({
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    baseUrl: 'https://api.paystack.co',
  },
  flutterwave: {
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    hash: process.env.FLUTTERWAVE_HASH,
    baseUrl: 'https://api.flutterwave.com/v3',
  },
}));
