import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { generateToken } from '../src/totp';
import { issueChallenge } from '../src/captcha';

let app: FastifyInstance;
let dataDir: string;
let secret = '';
let trustToken = '';
let recovery: string[] = [];

function leadingZeroBits(buf: Buffer): number {
  let bits = 0;
  for (const b of buf) {
    if (b === 0) { bits += 8; continue; }
    for (let m = 7; m >= 0; m--) { if ((b >> m) & 1) return bits; bits++; }
    break;
  }
  return bits;
}
function solve(): { captchaToken: string; captchaSolution: string } {
  const ch = issueChallenge();
  for (let i = 0; ; i++) {
    if (leadingZeroBits(createHash('sha256').update(`${ch.nonce}:${i}`).digest()) >= ch.difficulty) {
      return { captchaToken: ch.token, captchaSolution: String(i) };
    }
  }
}
const post = async (url: string, payload: Record<string, unknown>, token?: string) =>
  await app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = async (extra: Record<string, unknown>) =>
  await post('/api/auth/login', { email: 'a@x.com', password: 'password12', deviceId: 'dev-1', ...extra });

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '1';
  process.env.CAPTCHA_BITS = '12';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-2fa-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret-2fa' });
});
afterAll(async () => {
  delete process.env.REQUIRE_CAPTCHA;
  delete process.env.CAPTCHA_BITS;
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('captcha + 2FA + sessions', () => {
  it('registration requires a solved CAPTCHA', async () => {
    expect((await post('/api/auth/register', { email: 'a@x.com', password: 'password12' })).statusCode).toBe(400);
    const good = await post('/api/auth/register', { email: 'a@x.com', password: 'password12', deviceId: 'dev-1' });
    expect(good.statusCode).toBe(400); // still missing captcha
    const ok = await post('/api/auth/register', { email: 'a@x.com', password: 'password12', deviceId: 'dev-1', ...solve() });
    expect(ok.statusCode).toBe(200);
  });

  it('enrolls 2FA (setup → enable → recovery codes)', async () => {
    const access = (await login({})).json().accessToken as string;
    const setup = await post('/api/2fa/setup', {}, access);
    secret = setup.json().secret as string;
    expect(setup.json().otpauth).toMatch(/^otpauth:\/\/totp\/ZollTool/);
    expect((await post('/api/2fa/enable', { code: '000000' }, access)).statusCode).toBe(400);
    const en = await post('/api/2fa/enable', { code: generateToken(secret) }, access);
    expect(en.statusCode).toBe(200);
    recovery = en.json().recovery as string[];
    expect(recovery).toHaveLength(10);
  });

  it('enforces 2FA at login and remembers a trusted device', async () => {
    const noCode = await login({});
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().needs2fa).toBe(true);
    expect((await login({ code: '123456' })).statusCode).toBe(401);

    const good = await login({ code: generateToken(secret), rememberDevice: true });
    expect(good.statusCode).toBe(200);
    trustToken = good.json().deviceTrustToken as string;
    expect(trustToken).toBeTruthy();

    // Trusted device skips the code; a different device still needs it.
    expect((await login({ trustToken })).statusCode).toBe(200);
    expect((await post('/api/auth/login', { email: 'a@x.com', password: 'password12', deviceId: 'dev-2', trustToken })).statusCode).toBe(401);
  });

  it('recovery codes are single-use', async () => {
    expect((await login({ code: recovery[0] })).statusCode).toBe(200);
    expect((await login({ code: recovery[0] })).statusCode).toBe(401);
  });

  it('lists sessions and revokes one remotely', async () => {
    const access = (await login({ trustToken })).json().accessToken as string;
    const list = await app.inject({ method: 'GET', url: '/api/sessions', headers: { authorization: `Bearer ${access}` } });
    expect(list.statusCode).toBe(200);
    const sessions = list.json().sessions as Array<{ id: string; deviceId: string; device: string }>;
    expect(sessions.length).toBeGreaterThan(1);

    const target = sessions.find((s) => s.deviceId !== 'dev-1') ?? sessions[sessions.length - 1];
    const del = await app.inject({ method: 'DELETE', url: `/api/sessions/${target.id}`, headers: { authorization: `Bearer ${access}` } });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/sessions', headers: { authorization: `Bearer ${access}` } });
    expect((after.json().sessions as unknown[]).some((s) => (s as { id: string }).id === target.id)).toBe(false);
  });

  it('logs out all other devices, keeping the current one', async () => {
    // Create a real session on another device (needs a code), plus the trusted dev-1.
    expect((await post('/api/auth/login', { email: 'a@x.com', password: 'password12', deviceId: 'dev-2', code: generateToken(secret) })).statusCode).toBe(200);
    const access = (await login({ trustToken })).json().accessToken as string;
    const res = await post('/api/sessions/revoke-others', { deviceId: 'dev-1' }, access);
    expect(res.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/sessions', headers: { authorization: `Bearer ${access}` } })).json()
      .sessions as Array<{ deviceId: string }>;
    expect(after.some((s) => s.deviceId === 'dev-2')).toBe(false);
    expect(after.some((s) => s.deviceId === 'dev-1')).toBe(true);
  });

  it('disabling 2FA restores password-only login', async () => {
    const access = (await login({ trustToken })).json().accessToken as string;
    expect((await post('/api/2fa/disable', { code: generateToken(secret) }, access)).statusCode).toBe(200);
    const plain = await post('/api/auth/login', { email: 'a@x.com', password: 'password12', deviceId: 'dev-3' });
    expect(plain.statusCode).toBe(200);
  });
});
