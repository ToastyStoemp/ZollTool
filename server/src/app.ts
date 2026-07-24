import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import { openDb } from './db';
import { authenticate, registerAuthRoutes, seedOwner } from './auth';
import { registerSyncRoutes } from './routes/sync';
import { registerImageRoutes } from './routes/images';
import { registerAdminRoutes } from './routes/admin';
import { registerUpdateRoutes } from './routes/updates';
import { registerLogRoutes } from './routes/logs';
import { Rooms, registerWs } from './ws';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: typeof authenticate;
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
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024 });
  const db = openDb(opts.dataDir);
  app.decorate('db', db);

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret });
  app.decorate('authenticate', authenticate);

  await seedOwner(db);

  const rooms = new Rooms();
  await registerWs(app, rooms);
  registerAuthRoutes(app, db);
  registerSyncRoutes(app, db, rooms);
  registerImageRoutes(app, db, opts.dataDir);
  registerAdminRoutes(app, db);
  registerLogRoutes(app, db, opts.dataDir);
  if (opts.apkDir) registerUpdateRoutes(app, opts.apkDir);

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  if (opts.webDir && existsSync(join(opts.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: opts.webDir });
    app.log.info(`Serving web app from ${opts.webDir}`);
  }

  app.addHook('onClose', async () => db.close());
  return app;
}
