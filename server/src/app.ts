import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import { openDb } from './db';
import { authenticate, authenticateApiOrJwt, registerAuthRoutes, seedOwner } from './auth';
import { registerSyncRoutes } from './routes/sync';
import { registerImageRoutes } from './routes/images';
import { registerAdminRoutes } from './routes/admin';
import { registerUpdateRoutes } from './routes/updates';
import { registerLogRoutes } from './routes/logs';
import { registerDeviceRoutes } from './routes/devices';
import { registerDataRoutes } from './routes/data';
import { Rooms, registerWs } from './ws';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: typeof authenticate;
    authenticateApiOrJwt: typeof authenticateApiOrJwt;
    db: Database.Database;
  }
}

export interface BuildOptions {
  dataDir: string;
  jwtSecret: string;
  logger?: boolean;
  /**
   * Directory with the built web app (app/dist). When it exists, the SPA is
   * served at / so the tool can be used straight from a browser against this
   * server. The app uses hash routing, so no history rewrites are needed.
   */
  webDir?: string;
  /** Directory with committed self-update APKs + version.json (server/apk). */
  apkDir?: string;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 8 * 1024 * 1024,
    // Behind a TLS-terminating reverse proxy in prod, so the real client IP is
    // in X-Forwarded-For — without this, rate limiting would key every request
    // to the proxy's IP. Only enable when a trusted proxy actually fronts us.
    trustProxy: process.env.TRUST_PROXY !== '0',
  });
  const db = openDb(opts.dataDir);
  app.decorate('db', db);

  // Security headers. CSP is left off here (the SPA/build has inline bits — a
  // nonce-based CSP is a separate follow-up); CORP/COEP off so the native app
  // can fetch images/data cross-origin. The cheap high-value headers stay on.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  });

  // Global rate limit: a coarse ceiling per client IP as defence-in-depth
  // against floods reaching Node. Auth routes add much stricter per-route caps
  // (see auth.ts). In-memory store — fine for a single instance; a multi-node
  // deployment would need a shared store (Redis).
  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX || 1000),
    timeWindow: '1 minute',
    // Health check shouldn't burn anyone's budget (uptime probes hit it often).
    allowList: (req) => req.url === '/api/health',
  });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret });
  app.decorate('authenticate', authenticate);
  app.decorate('authenticateApiOrJwt', authenticateApiOrJwt);

  await seedOwner(db);

  const rooms = new Rooms();
  await registerWs(app, rooms, db);
  registerAuthRoutes(app, db, opts.jwtSecret, opts.dataDir);
  registerSyncRoutes(app, db, rooms);
  registerImageRoutes(app, db, opts.dataDir);
  registerAdminRoutes(app, db);
  registerLogRoutes(app, db, opts.dataDir);
  registerDeviceRoutes(app, db);
  registerDataRoutes(app, db);
  if (opts.apkDir) registerUpdateRoutes(app, opts.apkDir);

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  if (opts.webDir && existsSync(join(opts.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: opts.webDir });
    app.log.info(`Serving web app from ${opts.webDir}`);
  }

  app.addHook('onClose', async () => db.close());
  return app;
}
