import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import type Database from 'better-sqlite3';
import { openDb } from './db';
import { authenticate, registerAuthRoutes, seedOwner } from './auth';
import { registerSyncRoutes } from './routes/sync';
import { registerImageRoutes } from './routes/images';
import { registerAdminRoutes } from './routes/admin';
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

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  app.addHook('onClose', async () => db.close());
  return app;
}
