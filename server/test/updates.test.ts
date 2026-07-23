import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('APK self-update serving', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let apkDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zolltool-apk-'));
    apkDir = join(dataDir, 'apk');
    mkdirSync(apkDir, { recursive: true });
    writeFileSync(join(apkDir, 'version.json'), JSON.stringify({ versionCode: 12345, versionName: '2026.07.23 12:00' }));
    writeFileSync(join(apkDir, 'carbon.apk'), 'fake-apk-bytes');
    app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret', apkDir });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves the version manifest without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/updates/latest' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ versionCode: 12345, versionName: '2026.07.23 12:00' });
  });

  it('downloads a flavor that was built', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/updates/download/carbon' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(res.body).toBe('fake-apk-bytes');
  });

  it('404s a flavor that was not built', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/updates/download/full' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an unknown flavor', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/updates/download/unknown' });
    expect(res.statusCode).toBe(400);
  });

  it('404s the manifest when apk dir has no version.json', async () => {
    const bareDir = mkdtempSync(join(tmpdir(), 'zolltool-apk-empty-'));
    const bare = await buildApp({ dataDir: bareDir, jwtSecret: 'test-secret-test-secret', apkDir: join(bareDir, 'apk') });
    const res = await bare.inject({ method: 'GET', url: '/api/updates/latest' });
    expect(res.statusCode).toBe(404);
    await bare.close();
    rmSync(bareDir, { recursive: true, force: true });
  });
});
