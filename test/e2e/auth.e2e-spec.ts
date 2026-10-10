import { api, createTestApp, eventually, TestApp } from '../helpers/app';

const PASSWORD = 'Str0ng!Pass';

describe('Auth: customer and pharmacist registration, login, sessions', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const otpFor = (email: string) =>
    t.redis.get(`auth:otp:${email.toLowerCase()}`);
  const email = (p: string) =>
    `${p}.${Date.now()}${Math.floor(Math.random() * 1e4)}@test.ng`;
  const phone = () =>
    `080${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  async function registerAndVerifyCustomer() {
    const addr = email('cust');
    await t.http
      .post(api('/auth/register/customer'))
      .send({
        firstName: 'Chioma',
        lastName: 'Okeke',
        email: addr,
        phone: phone(),
        password: PASSWORD,
      })
      .expect(201);
    const otp = await otpFor(addr);
    expect(otp).toMatch(/^\d{6}$/);
    const res = await t.http
      .post(api('/auth/verify-email'))
      .send({ email: addr, otp })
      .expect(200);
    return { addr, body: res.body.data };
  }

  it('registers a customer, verifies by OTP, and returns tokens + FADA id', async () => {
    const { body } = await registerAndVerifyCustomer();
    expect(body.user.role).toBe('customer');
    expect(body.user.fadaId).toMatch(/^CUS/);
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
  });

  it('awards the +50 registration points once the email is verified', async () => {
    const { body } = await registerAndVerifyCustomer();
    const ledger = await eventually(() =>
      t.prisma.pointsLedger.findUnique({ where: { userId: body.user.id } }),
    );
    expect(ledger?.balance).toBe(50);
  });

  it('logs in, reads /me, refreshes (rotating), and logs out', async () => {
    const { addr } = await registerAndVerifyCustomer();
    const login = await t.http
      .post(api('/auth/login'))
      .send({ email: addr, password: PASSWORD })
      .expect(200);
    const { accessToken, refreshToken } = login.body.data.tokens;

    const me = await t.http
      .get(api('/auth/me'))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(addr);

    const refreshed = await t.http
      .post(api('/auth/refresh'))
      .send({ refreshToken })
      .expect(200);
    const next = refreshed.body.data;
    expect(next.refreshToken).not.toBe(refreshToken);
    // the used refresh token is single-use
    await t.http.post(api('/auth/refresh')).send({ refreshToken }).expect(401);

    await t.http
      .post(api('/auth/logout'))
      .set('Authorization', `Bearer ${next.accessToken}`)
      .send({ refreshToken: next.refreshToken })
      .expect((r) => expect([200, 204]).toContain(r.status));
    await t.http
      .post(api('/auth/refresh'))
      .send({ refreshToken: next.refreshToken })
      .expect(401);
  });

  it('rejects wrong passwords and unverified accounts', async () => {
    const { addr } = await registerAndVerifyCustomer();
    await t.http
      .post(api('/auth/login'))
      .send({ email: addr, password: 'Wr0ng!Pass' })
      .expect(401);

    const unverified = email('unv');
    await t.http
      .post(api('/auth/register/customer'))
      .send({
        firstName: 'Un',
        lastName: 'Verified',
        email: unverified,
        phone: phone(),
        password: PASSWORD,
      })
      .expect(201);
    const res = await t.http
      .post(api('/auth/login'))
      .send({ email: unverified, password: PASSWORD });
    expect([401, 403]).toContain(res.status);
  });

  it('destroys an OTP after 5 wrong guesses (brute-force protection)', async () => {
    const addr = email('brute');
    await t.http
      .post(api('/auth/register/customer'))
      .send({
        firstName: 'Brute',
        lastName: 'Force',
        email: addr,
        phone: phone(),
        password: PASSWORD,
      })
      .expect(201);
    const real = await otpFor(addr);
    const wrong = real === '111111' ? '222222' : '111111';

    for (let i = 0; i < 4; i++) {
      await t.http
        .post(api('/auth/verify-email'))
        .send({ email: addr, otp: wrong })
        .expect(400);
    }
    await t.http
      .post(api('/auth/verify-email'))
      .send({ email: addr, otp: wrong })
      .expect(429);
    // even the right code no longer works; a new one must be requested
    await t.http
      .post(api('/auth/verify-email'))
      .send({ email: addr, otp: real })
      .expect(400);
    expect(await otpFor(addr)).toBeNull();
  });

  it('resets a password by OTP and signs out every existing session', async () => {
    const { addr } = await registerAndVerifyCustomer();
    const login = await t.http
      .post(api('/auth/login'))
      .send({ email: addr, password: PASSWORD })
      .expect(200);
    const oldRefresh = login.body.data.tokens.refreshToken;

    await t.http
      .post(api('/auth/forgot-password'))
      .send({ email: addr })
      .expect(200);
    const code = await t.redis.get(`auth:pwd-reset:${addr}`);
    expect(code).toMatch(/^\d{6}$/);

    const NEW = 'N3w!Password';
    await t.http
      .post(api('/auth/reset-password'))
      .send({ email: addr, otp: code, newPassword: NEW })
      .expect(200);
    await t.http
      .post(api('/auth/refresh'))
      .send({ refreshToken: oldRefresh })
      .expect(401);
    await t.http
      .post(api('/auth/login'))
      .send({ email: addr, password: PASSWORD })
      .expect(401);
    await t.http
      .post(api('/auth/login'))
      .send({ email: addr, password: NEW })
      .expect(200);
  });

  it('does not reveal whether an email is registered on forgot-password', async () => {
    const res = await t.http
      .post(api('/auth/forgot-password'))
      .send({ email: email('nobody') })
      .expect(200);
    expect(res.body.data.message).toMatch(/If this email is registered/);
  });

  it('registers a pharmacist and queues PCN verification', async () => {
    const addr = email('pharm');
    await t.http
      .post(api('/auth/register/pharmacist'))
      .send({
        firstName: 'Emeka',
        lastName: 'Nwosu',
        email: addr,
        phone: phone(),
        password: PASSWORD,
        licenseType: 'PHARMACIST',
        licenseNumber: `PCN-${Date.now()}`,
      })
      .expect(201);
    const otp = await otpFor(addr);
    const verified = await t.http
      .post(api('/auth/verify-email'))
      .send({ email: addr, otp })
      .expect(200);
    expect(verified.body.data.user.role).toBe('pharmacist');
    const profile = await t.prisma.pharmacistProfile.findFirst({
      where: { user: { email: addr } },
    });
    expect(profile?.licenseNumber).toMatch(/^PCN-/);
  });

  it('bootstraps the first admin only with the right secret, only once', async () => {
    const body = { email: email('root'), password: PASSWORD };
    await t.http
      .post(api('/auth/bootstrap-admin'))
      .send({ ...body, secret: 'wrong' })
      .expect(401);
    const first = await t.http
      .post(api('/auth/bootstrap-admin'))
      .send({ ...body, secret: process.env.ADMIN_BOOTSTRAP_SECRET });
    // another suite may already have created an admin in this database
    expect([201, 409]).toContain(first.status);
    await t.http
      .post(api('/auth/bootstrap-admin'))
      .send({
        email: email('root2'),
        password: PASSWORD,
        secret: process.env.ADMIN_BOOTSTRAP_SECRET,
      })
      .expect(409);
  });

  it('boots without Google/Apple credentials and answers 503 on their routes', async () => {
    const google = await t.http.get(api('/auth/google')).expect(503);
    expect(JSON.stringify(google.body)).toContain(
      'google_sign_in_not_configured',
    );
    const apple = await t.http.post(api('/auth/apple')).expect(503);
    expect(JSON.stringify(apple.body)).toContain(
      'apple_sign_in_not_configured',
    );
  });
});
