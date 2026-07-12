import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { unpackWebDist } from './webdist';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16) {
  console.error('JWT_SECRET env var is required (min 16 chars).');
  process.exit(1);
}

// Which web app to serve, in order of precedence:
// 1. explicit WEB_DIR env
// 2. the committed build (server/web-dist.zip via `npm run deploy:web`),
//    unpacked at every startup — this is what Docker deploys use
// 3. dev fallback: the repo's app/dist (cwd is server/ in dev)
const zipPath = fileURLToPath(new URL('../web-dist.zip', import.meta.url));
const unpackDir = fileURLToPath(new URL('../web-unpacked', import.meta.url));
const webDir = process.env.WEB_DIR
  ? resolve(process.env.WEB_DIR)
  : (unpackWebDist(zipPath, unpackDir) ?? resolve('../app/dist'));

const app = await buildApp({
  dataDir: process.env.DATA_DIR || './data',
  jwtSecret,
  logger: true,
  webDir,
});

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: '0.0.0.0' });
