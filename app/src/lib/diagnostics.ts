import { getSetting } from '@/db/repo';
import { apiFetch } from '@/sync/api';
import { currentFlavor } from './updates';
import { Updater, hasNativePlugin, isNative } from '@/native/plugins';

/**
 * In-memory ring buffer of console warnings/errors, uncaught exceptions, and
 * explicit breadcrumbs — uploaded to the sync server on request (Settings, or
 * right from a failed-payment screen) so a device without a usable USB/ADB
 * connection can still get diagnostics to whoever's investigating.
 */

const MAX_ENTRIES = 500;

interface LogEntry {
  ts: number;
  level: 'log' | 'warn' | 'error';
  message: string;
}

const buffer: LogEntry[] = [];

function stringify(v: unknown): string {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`;
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function push(level: LogEntry['level'], args: unknown[]): void {
  buffer.push({ ts: Date.now(), level, message: args.map(stringify).join(' ') });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

let installed = false;

/** Call once at startup — patches console.warn/error and catches uncaught errors. */
export function installDiagnostics(): void {
  if (installed) return;
  installed = true;
  const original = { warn: console.warn.bind(console), error: console.error.bind(console) };
  console.warn = (...args: unknown[]) => {
    push('warn', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    push('error', args);
    original.error(...args);
  };
  window.addEventListener('error', (e) => push('error', [`Uncaught: ${e.message}`, e.error?.stack ?? '']));
  window.addEventListener('unhandledrejection', (e) => push('error', ['Unhandled rejection:', e.reason]));
}

/** Breadcrumb for call sites worth capturing even when nothing throws (e.g. payment attempts). */
export function logDiagnostic(message: string): void {
  push('log', [message]);
}

function formatLog(): string {
  return buffer.map((e) => `[${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()} ${e.message}`).join('\n');
}

/** Sends the buffered log to the configured sync server; throws on failure. */
export async function sendDiagnosticLog(reason?: string): Promise<void> {
  const deviceId = (await getSetting<string>('deviceId')) ?? 'unknown';
  const deviceName = await getSetting<string>('deviceName');
  let appVersion: string | undefined;
  if (hasNativePlugin('Updater')) {
    try {
      const v = await Updater.getCurrentVersion();
      appVersion = v.versionName;
    } catch {
      /* fall through with no version */
    }
  }

  const res = await apiFetch('/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      deviceName,
      flavor: currentFlavor() ?? (isNative ? undefined : 'web'),
      appVersion,
      reason,
      log: formatLog() || '(no diagnostic entries recorded)',
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Log upload failed (${res.status})`);
  }
}
