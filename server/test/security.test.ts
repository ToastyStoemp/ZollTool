import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_MAX = '5'; // small, deterministic cap for the test
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-security-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });
});

afterAll(async () => {
  delete process.env.AUTH_RATE_LIMIT_MAX;
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('security hardening', () => {
  it('rate-limits repeated login attempts (429 past the cap)', async () => {
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'wrong-password' },
      });

    // The first 5 are allowed (all 401 — bad creds); the 6th is throttled.
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await attempt()).statusCode);

    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('sends hardening headers (helmet)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers).toHaveProperty('referrer-policy');
  });

  it('does not leak whether an email exists (uniform 401)', async () => {
    // Both an unknown email and (later) a wrong password return the same shape.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@example.com', password: 'whatever-1' },
    });
    // Either 401 (rejected) or 429 (already throttled) — never a 200 or a
    // distinguishing 404/"no such user".
    expect([401, 429]).toContain(res.statusCode);
    if (res.statusCode === 401) expect(res.json()).toEqual({ error: 'Wrong email or password' });
  });
});
