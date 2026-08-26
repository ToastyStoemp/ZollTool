import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DeviceSummary, TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let alice: TokenResponse;
let bob: TokenResponse;

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-devices-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });

  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'alice@devices-test.com', password: 'password123', accountName: 'Alice Corp' },
  });
  alice = reg.json();

  const reg2 = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'bob@devices-test.com', password: 'password123', accountName: 'Bob Corp' },
  });
  bob = reg2.json();
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function op(id: string): WireOp {
  return { opId: id.padEnd(16, '0'), deviceId: 'carbon-1', ts: Date.now(), type: 'tx.create', payload: {} };
}

describe('device presence + listing', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/devices' });
    expect(res.statusCode).toBe(401);
  });

  it('records the flavor from a sync push and lists it back', async () => {
    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { deviceId: 'carbon-1', deviceName: 'Front Carbon', flavor: 'carbon', ops: [op('devtest-op-1')] },
    });
    expect(push.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    const devices = list.json() as DeviceSummary[];
    const carbon = devices.find((d) => d.id === 'carbon-1');
    expect(carbon).toBeDefined();
    expect(carbon!.name).toBe('Front Carbon');
    expect(carbon!.flavor).toBe('carbon');
  });

  it('scopes the device list to the caller\'s own account', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    const devices = list.json() as DeviceSummary[];
    expect(devices.find((d) => d.id === 'carbon-1')).toBeUndefined();
  });

  it('keeps a previously-set flavor when a later push omits it', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { deviceId: 'carbon-1', ops: [op('devtest-op-2')] }, // no flavor this time
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const carbon = (list.json() as DeviceSummary[]).find((d) => d.id === 'carbon-1');
    expect(carbon!.flavor).toBe('carbon');
  });
});
