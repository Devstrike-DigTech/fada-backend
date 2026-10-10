import { api, createTestApp, TestApp } from '../helpers/app';

describe('Platform: health, headers, limits, validation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('serves liveness without touching dependencies', async () => {
    const res = await t.http.get(api('/health/live')).expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('reports readiness of database and Redis', async () => {
    const res = await t.http.get(api('/health/ready')).expect(200);
    expect(res.body.data.info).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await t.http.get(api('/health/live'));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('issues a request id, and honours a well-formed incoming one', async () => {
    const a = await t.http.get(api('/health/live'));
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await t.http
      .get(api('/health/live'))
      .set('x-request-id', 'client-req-12345');
    expect(b.headers['x-request-id']).toBe('client-req-12345');
    const c = await t.http
      .get(api('/health/live'))
      .set('x-request-id', 'bad id with spaces <script>');
    expect(c.headers['x-request-id']).not.toContain('<script>');
  });

  it('rejects oversized bodies (413)', async () => {
    const huge = { email: 'x@y.ng', password: 'x'.repeat(1_200_000) };
    await t.http.post(api('/auth/login')).send(huge).expect(413);
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const res = await t.http
      .post(api('/auth/login'))
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.ng", "password": ')
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects unknown fields and invalid input (400)', async () => {
    const res = await t.http
      .post(api('/auth/login'))
      .send({ email: 'a@b.ng', password: 'Password123!', isAdmin: true })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toContain('isAdmin');
  });

  it('requires authentication on protected routes', async () => {
    await t.http.get(api('/auth/me')).expect(401);
    await t.http
      .get(api('/auth/me'))
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('serves seeded content publicly', async () => {
    const res = await t.http.get(api('/content/terms-of-service')).expect(200);
    expect(res.body.data.source).toBe('database');
    expect(JSON.stringify(res.body.data.content)).toContain('Enugu State');
    const plans = await t.http.get(api('/subscriptions/plans')).expect(200);
    expect(plans.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      'sokka',
      'toph',
      'katara',
      'zuko',
      'aang',
    ]);
  });
});
