import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-ver-'));
  // Simulate what deploy.sh writes into the data volume.
  writeFileSync(join(dataDir, 'commit'), 'deadbee-dirty\n');
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret-xx' });
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/version', () => {
  it('is public and reports the deployed commit from the data volume', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { commit: string }).commit).toBe('deadbee-dirty');
  });
});
