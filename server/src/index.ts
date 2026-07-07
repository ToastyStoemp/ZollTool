import { buildApp } from './app';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16) {
  console.error('JWT_SECRET env var is required (min 16 chars).');
  process.exit(1);
}

const app = await buildApp({
  dataDir: process.env.DATA_DIR || './data',
  jwtSecret,
  logger: true,
});

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: '0.0.0.0' });
