import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Product, TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let alice: TokenResponse;
let roToken: string; // read-only
let rwToken: string; // read/write

const DEV = 'dev-1';
let opN = 0;
function op(type: WireOp['type'], payload: unknown): WireOp {
  opN += 1;
  return { opId: `op-${opN}`.padEnd(16, '0'), deviceId: DEV, ts: Date.now(), type, payload };
}

function product(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    title: `Print ${id}`,
    sku: `OLD-${id}`,
    forSale: true,
    unlisted: false,
    price: 20,
    weightG: 100,
    variants: [{ id: 'v1', name: 'Small', sku: `OLD-${id}-S`, price: 20 }],
    sortOrder: 0,
    updatedAt: 100,
    ...extra,
  };
}

const rw = () => ({ authorization: `Bearer ${rwToken}` });

async function currentProduct(id: string): Promise<Product | undefined> {
  const res = await app.inject({ method: 'GET', url: '/api/data/products', headers: rw() });
  return (res.json() as Product[]).find((p) => p.id === id);
}

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-data-write-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });

  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'alice@write-test.com', password: 'password123', accountName: 'Alice' },
  });
  alice = reg.json();
  const auth = { authorization: `Bearer ${alice.accessToken}` };

  const push = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: auth,
    payload: { deviceId: DEV, ops: [op('product.upsert', product('p1'))] },
  });
  expect(push.statusCode).toBe(200);

  const mintRo = await app.inject({ method: 'POST', url: '/api/tokens', headers: auth, payload: { name: 'ro', scopes: 'data:read' } });
  roToken = (mintRo.json() as { token: string }).token;
  const mintRw = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: auth,
    payload: { name: 'rw', scopes: 'data:read data:write' },
  });
  rwToken = (mintRw.json() as { token: string }).token;
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('data write API', () => {
  it('rejects a read-only token from patching (403, lacks data:write)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/data/products/p1',
      headers: { authorization: `Bearer ${roToken}` },
      payload: { sku: 'HACK' },
    });
    expect(res.statusCode).toBe(403);
    expect(await currentProduct('p1').then((p) => p?.sku)).toBe('OLD-p1'); // unchanged
  });

  it('patches scalar fields and bumps updatedAt', async () => {
    const before = await currentProduct('p1');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/data/products/p1',
      headers: rw(),
      payload: { sku: 'NEW-p1', price: 25, weightG: 150 },
    });
    expect(res.statusCode).toBe(200);
    const after = await currentProduct('p1');
    expect(after?.sku).toBe('NEW-p1');
    expect(after?.price).toBe(25);
    expect(after?.weightG).toBe(150);
    expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt);
    // Untouched fields survive the merge.
    expect(after?.title).toBe('Print p1');
  });

  it('merges variant SKUs by id, ignoring unknown variants', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/data/products/p1',
      headers: rw(),
      payload: { variants: [{ id: 'v1', sku: 'NEW-p1-S' }, { id: 'ghost', sku: 'X' }] },
    });
    expect(res.statusCode).toBe(200);
    const after = await currentProduct('p1');
    expect(after?.variants).toHaveLength(1);
    expect(after?.variants[0].sku).toBe('NEW-p1-S');
    expect(after?.variants[0].name).toBe('Small'); // preserved
  });

  it('404s patching a product that does not exist', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/data/products/nope', headers: rw(), payload: { sku: 'X' } });
    expect(res.statusCode).toBe(404);
  });

  it('attaches an image and makes it fetchable, linking it to the product', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex'); // tiny PNG signature stand-in
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/products/p1/image',
      headers: rw(),
      payload: { full: png.toString('base64'), thumb: 'dGh1bWI=', mime: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    const { imageId } = res.json() as { imageId: string };
    expect(imageId).toBeTruthy();

    const after = await currentProduct('p1');
    expect(after?.imageId).toBe(imageId);

    // The full image round-trips through the read API.
    const img = await app.inject({ method: 'GET', url: `/api/images/${imageId}`, headers: rw() });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(img.rawPayload.equals(png)).toBe(true);
  });

  it('attaches an image to a named variant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/data/products/p1/image',
      headers: rw(),
      payload: { full: Buffer.from('data').toString('base64'), thumb: 'dA==', variantId: 'v1' },
    });
    expect(res.statusCode).toBe(200);
    const { imageId } = res.json() as { imageId: string };
    const after = await currentProduct('p1');
    expect(after?.variants[0].imageId).toBe(imageId);
  });

  it('isolates accounts — Bob cannot patch Alice\'s product', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@write-test.com', password: 'password123', accountName: 'Bob' },
    });
    const bob = reg.json() as TokenResponse;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/data/products/p1',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { sku: 'STEAL' },
    });
    // p1 belongs to Alice's account; in Bob's account it does not exist.
    expect(res.statusCode).toBe(404);
    expect(await currentProduct('p1').then((p) => p?.sku)).toBe('NEW-p1');
  });
});
