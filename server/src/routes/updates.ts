import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Serves APK self-update info + downloads for the Android app. Committed to
 * git the same way the web build is (server/apk/*.apk + version.json via
 * `npm run pack:apk`) — a redeploy is the whole release process, no separate
 * upload/transfer step. Public/unauthenticated, same as /api/health: an APK
 * build carries no user data, and requiring login here would block a device
 * that hasn't set up sync yet from getting updates at all.
 */
const FLAVORS = new Set(['carbon', 'compat', 'full']);

export interface UpdateManifest {
  versionCode: number;
  versionName: string;
}

export function registerUpdateRoutes(app: FastifyInstance, apkDir: string): void {
  app.get('/api/updates/latest', async (_req, reply) => {
    const versionPath = join(apkDir, 'version.json');
    if (!existsSync(versionPath)) return reply.code(404).send({ error: 'No update published' });
    const manifest = JSON.parse(readFileSync(versionPath, 'utf-8')) as UpdateManifest;
    return manifest;
  });

  app.get('/api/updates/download/:flavor', async (req, reply) => {
    const { flavor } = req.params as { flavor: string };
    if (!FLAVORS.has(flavor)) return reply.code(400).send({ error: 'Unknown flavor' });
    const apkPath = join(apkDir, `${flavor}.apk`);
    if (!existsSync(apkPath)) return reply.code(404).send({ error: 'Not built for this flavor' });
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Disposition', `attachment; filename="zolltool-${flavor}.apk"`);
    return reply.send(readFileSync(apkPath));
  });
}
