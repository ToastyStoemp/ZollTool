import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('web app serving', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let webDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zolltool-static-'));
    webDir = join(dataDir, 'dist');
    mkdirSync(join(webDir, 'assets'), { recursive: true });
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>ZollTool</title>');
    writeFileSync(join(webDir, 'assets', 'index.js'), 'console.log(1)');
    app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret', webDir });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves index.html at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('ZollTool');
  });

  it('serves asset files', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index.js' });
    expect(res.statusCode).toBe(200);
  });

  it('API routes still win over static', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('boots without a web dir (pure API mode)', async () => {
    const bare = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });
    const res = await bare.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });
});
