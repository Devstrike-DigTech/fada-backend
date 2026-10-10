/**
 * Runs before every e2e test file. Points the app at the throwaway test
 * Postgres + Redis and blanks real provider credentials so no email, SMS,
 * push or payment ever leaves the machine. Values set here win over .env
 * (dotenv never overrides variables that already exist).
 */
const db = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
if (!db || !redis) {
  throw new Error(
    'Set TEST_DATABASE_URL and TEST_REDIS_URL (or run `npm run test:e2e:docker`).',
  );
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: db,
  REDIS_URL: redis,
  JWT_ACCESS_SECRET: 'e2e-access-secret-e2e-access-secret-0001',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-e2e-refresh-secret-0002',
  JWT_ACCESS_SECRET_PREVIOUS: '',
  JWT_REFRESH_SECRET_PREVIOUS: '',
  ADMIN_BOOTSTRAP_SECRET: 'e2e-bootstrap-secret',
  PAYSTACK_SECRET_KEY: 'sk_test_e2e_paystack_secret',
  PAYSTACK_PUBLIC_KEY: 'pk_test_e2e',
  FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-e2e',
  FLUTTERWAVE_HASH: 'e2e-flw-hash',
  PAYMENT_CALLBACK_URL: 'http://localhost/callback',
  PAYMENT_SUCCESS_REDIRECT_URL: '',
  // Social sign-in unconfigured, as on a fresh deploy: the app must still boot
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  APPLE_CLIENT_ID: '',
  APPLE_TEAM_ID: '',
  APPLE_KEY_ID: '',
  APPLE_PRIVATE_KEY: '',
  RESEND_API_KEY: '',
  TERMII_API_KEY: '',
  FIREBASE_PROJECT_ID: '',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  CAC_API_URL: '',
  CAC_API_KEY: '',
  EMDEX_API_URL: '',
  EMDEX_API_KEY: '',
  PCN_REGISTRY_API_URL: '',
  PCN_REGISTRY_API_KEY: '',
  SUPPORT_INBOX_EMAIL: '',
  ALLOWED_ORIGINS: '',
  REQUEST_LOGGING: 'false',
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED ?? 'false',
});

/**
 * No real network in e2e tests. Requests to localhost pass through; anything
 * else must be answered by a handler registered with `fakeNetwork()`
 * (test/helpers/network.ts) or it fails loudly with 599.
 */
type Handler = {
  match: (url: string) => boolean;
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
const handlers: Handler[] = [];
(globalThis as unknown as { __fakeNetwork: Handler[] }).__fakeNetwork =
  handlers;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url))
    return realFetch(input, init);
  const h = [...handlers].reverse().find((x) => x.match(url));
  if (h) return h.respond(url, init);
  return new Response(
    JSON.stringify({ message: `network disabled in tests: ${url}` }),
    { status: 599 },
  );
}) as typeof fetch;
