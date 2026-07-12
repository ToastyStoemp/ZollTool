/**
 * Pack the built web app (app/dist) into server/web-dist.zip.
 *
 * The zip is committed to git: the server unpacks and serves it at startup,
 * so deploying the web app to the sync server is `npm run deploy:web`,
 * commit, and `git pull && docker compose up -d --build` on the box —
 * no scp, no SSH keys, no building on the server.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'app', 'dist');
const outFile = join(root, 'server', 'web-dist.zip');

function collect(dir, files = {}) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, files);
    else files[relative(distDir, full).replaceAll('\\', '/')] = readFileSync(full);
  }
  return files;
}

let files;
try {
  files = collect(distDir);
} catch {
  console.error('app/dist not found — run `npm run build` first.');
  process.exit(1);
}
if (!files['index.html']) {
  console.error('app/dist has no index.html — build looks incomplete.');
  process.exit(1);
}

const zipped = zipSync(files, { level: 9 });
writeFileSync(outFile, zipped);
console.log(
  `Packed ${Object.keys(files).length} files -> server/web-dist.zip (${(zipped.length / 1024).toFixed(0)} KB)`,
);
