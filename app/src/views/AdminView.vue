<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Copy } from 'lucide-vue-next';
import type { AdminAccount, AdminAccountDetail, AdminLogEntry, AdminMetricRow, AdminOverview } from '@zolltool/shared';
import { useSettingsStore } from '@/stores/settings';
import {
  apiFetch,
  apiJson,
  listApiTokens,
  createApiToken,
  revokeApiToken,
  listAdminSessions,
  revokeAdminSession,
  getDeviceId,
  type ApiTokenSummary,
  type MintedApiToken,
  type AdminSessionInfo,
} from '@/sync/api';
import { sendDiagnosticLog } from '@/lib/diagnostics';
import { showToast } from '@/lib/toast';

const settings = useSettingsStore();
const isOwner = computed(() => settings.syncUser?.role === 'owner');
// Minting API tokens is an owner/admin capability; the server enforces the same.
const canManageTokens = computed(() => !!settings.syncUser && settings.syncUser.role !== 'member');

const loading = ref(true);
const loadError = ref('');
const overview = ref<AdminOverview | null>(null);
const accounts = ref<AdminAccount[]>([]);
const metrics = ref<AdminMetricRow[]>([]);
const logs = ref<AdminLogEntry[]>([]);
const expandedId = ref<string | null>(null);
const detail = ref<AdminAccountDetail | null>(null);
const inviteCode = ref('');
const inviteBusy = ref(false);
const sessions = ref<AdminSessionInfo[]>([]);
const sessionsGeo = ref(false);
const myDeviceId = ref<string | undefined>();

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [ov, acc, met, lg, ses, dev] = await Promise.all([
      apiJson<AdminOverview>('/api/admin/overview'),
      apiJson<AdminAccount[]>('/api/admin/accounts'),
      apiJson<AdminMetricRow[]>('/api/admin/metrics?days=30'),
      apiJson<AdminLogEntry[]>('/api/admin/logs'),
      listAdminSessions(),
      getDeviceId(),
    ]);
    overview.value = ov;
    accounts.value = acc;
    metrics.value = met;
    logs.value = lg;
    sessions.value = ses.sessions;
    sessionsGeo.value = ses.geo;
    myDeviceId.value = dev;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function revokeSessionRemote(s: AdminSessionInfo): Promise<void> {
  if (!confirm(`Force log out ${s.email}${s.deviceName ? ` (${s.deviceName})` : ''}?`)) return;
  try {
    await revokeAdminSession(s.id);
    sessions.value = sessions.value.filter((x) => x.id !== s.id);
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
  }
}

async function downloadLog(entry: AdminLogEntry): Promise<void> {
  try {
    const res = await apiFetch(`/api/admin/logs/${entry.id}`);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.deviceName || entry.deviceId}-${entry.id.slice(0, 8)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
  }
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

// ── Diagnostics — upload THIS device's recent console logs (any logged-in user).
const diagnosticsSending = ref(false);
const diagnosticsSent = ref(false);

async function doSendDiagnostics(): Promise<void> {
  diagnosticsSending.value = true;
  diagnosticsSent.value = false;
  try {
    await sendDiagnosticLog('manual');
    diagnosticsSent.value = true;
  } catch (err) {
    showToast(`Send failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    diagnosticsSending.value = false;
  }
}

// ── API access — scoped, read-only tokens for back-office tools (owner/admin).
const apiTokens = ref<ApiTokenSummary[]>([]);
const apiTokensLoading = ref(false);
const apiTokensError = ref('');
const newTokenName = ref('');
const creatingToken = ref(false);
const mintedToken = ref<MintedApiToken | null>(null);

async function refreshApiTokens(): Promise<void> {
  apiTokensLoading.value = true;
  apiTokensError.value = '';
  try {
    apiTokens.value = await listApiTokens();
  } catch (err) {
    apiTokensError.value = err instanceof Error ? err.message : String(err);
  } finally {
    apiTokensLoading.value = false;
  }
}

async function createToken(): Promise<void> {
  creatingToken.value = true;
  apiTokensError.value = '';
  try {
    mintedToken.value = await createApiToken(newTokenName.value.trim() || undefined);
    newTokenName.value = '';
    await refreshApiTokens();
  } catch (err) {
    apiTokensError.value = err instanceof Error ? err.message : String(err);
  } finally {
    creatingToken.value = false;
  }
}

async function copyMintedToken(): Promise<void> {
  if (!mintedToken.value) return;
  try {
    await navigator.clipboard.writeText(mintedToken.value.token);
    showToast('Token copied to clipboard', 'success');
  } catch {
    showToast('Could not copy — select and copy it manually', 'error');
  }
}

async function revokeToken(t: ApiTokenSummary): Promise<void> {
  if (!confirm(`Revoke "${t.name}"? Any tool using it will immediately lose access.`)) return;
  apiTokensError.value = '';
  try {
    await revokeApiToken(t.id);
    if (mintedToken.value?.id === t.id) mintedToken.value = null;
    await refreshApiTokens();
    showToast('Token revoked', 'info');
  } catch (err) {
    apiTokensError.value = err instanceof Error ? err.message : String(err);
  }
}

function fmtDay(ts: number | null | undefined): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

onMounted(() => {
  if (isOwner.value) void load();
  else loading.value = false;
  if (canManageTokens.value) void refreshApiTokens();
});

async function toggleAccount(id: string): Promise<void> {
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
  detail.value = null;
  try {
    detail.value = await apiJson<AdminAccountDetail>(`/api/admin/accounts/${id}`);
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function createInvite(newAccount: boolean): Promise<void> {
  inviteBusy.value = true;
  try {
    const res = await apiJson<{ code: string }>('/api/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newAccount }),
    });
    inviteCode.value = res.code;
  } catch (err) {
    showToast(String(err), 'error');
  } finally {
    inviteBusy.value = false;
  }
}

async function copyInvite(): Promise<void> {
  await navigator.clipboard.writeText(inviteCode.value);
  showToast('Invite code copied', 'success');
}

/** Daily totals across all accounts for the activity chart. */
const daily = computed(() => {
  const map = new Map<string, { ops: number; tx: number; logins: number }>();
  for (const row of metrics.value) {
    const cur = map.get(row.day) ?? { ops: 0, tx: 0, logins: 0 };
    cur.ops += row.opsReceived;
    cur.tx += row.txCount;
    cur.logins += row.logins;
    map.set(row.day, cur);
  }
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const max = Math.max(1, ...entries.map(([, v]) => v.ops));
  return entries.map(([day, v]) => ({ day, ...v, pct: (v.ops / max) * 100 }));
});

function fmtWhen(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const tiles = computed(() =>
  overview.value
    ? ([
        ['Accounts', overview.value.accounts],
        ['Users', overview.value.users],
        ['Devices', overview.value.devices],
        ['Ops stored', overview.value.ops],
        ['Sales synced', overview.value.transactions],
        ['Active today', overview.value.activeToday],
      ] as [string, number][])
    : [],
);
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-6">
    <div class="mb-4 flex items-center gap-3">
      <h1 class="text-xl font-bold">Server admin</h1>
      <span v-if="settings.serverUrl" class="truncate text-sm text-slate-400">{{ settings.serverUrl }}</span>
      <button
        v-if="isOwner"
        class="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
        @click="load"
      >
        Refresh
      </button>
    </div>

    <p v-if="!settings.syncUser" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      Log in under Settings first to use this page.
    </p>

    <template v-else>
      <!-- Diagnostics — upload THIS device's logs (any logged-in user) -->
      <div class="mb-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Diagnostics — this device</h2>
        <p class="mb-3 text-xs text-slate-500">
          Sends recent console warnings/errors from <strong>this device</strong> to the sync server,
          where the owner can download them below. Needs a server URL set under Settings → Server sync.
        </p>
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="diagnosticsSending"
          @click="doSendDiagnostics"
        >
          {{ diagnosticsSending ? 'Sending…' : "Send this device's log" }}
        </button>
        <p v-if="diagnosticsSent" class="mt-2 text-xs text-emerald-400">Sent.</p>
      </div>

      <!-- API access — scoped read-only tokens (owner/admin) -->
      <div v-if="canManageTokens" class="mb-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">API access</h2>
        <p class="mb-3 text-xs text-slate-500">
          Read-only tokens let back-office tools (e.g. ZollTax) pull this account's events and
          transactions without an account password. Each token is scoped to <code>data:read</code>
          and can be revoked any time.
        </p>

        <div class="mb-3 flex flex-wrap gap-2">
          <input
            v-model="newTokenName"
            type="text"
            placeholder="Token name, e.g. ZollTax"
            class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm"
            @keydown.enter.prevent="createToken"
          />
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            :disabled="creatingToken"
            @click="createToken"
          >
            {{ creatingToken ? 'Creating…' : 'Create token' }}
          </button>
        </div>

        <div v-if="mintedToken" class="mb-3 rounded-lg bg-emerald-950 p-3 ring-1 ring-emerald-800">
          <p class="mb-1 text-xs font-medium text-emerald-300">Copy this token now — it won't be shown again.</p>
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 break-all rounded bg-slate-950 px-2 py-1.5 font-mono text-xs text-emerald-200">{{ mintedToken.token }}</code>
            <button class="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700" @click="copyMintedToken">Copy</button>
            <button class="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200" title="Dismiss" @click="mintedToken = null">Done</button>
          </div>
        </div>

        <p v-if="apiTokensError" class="mb-2 text-xs text-red-400">{{ apiTokensError }}</p>

        <p v-if="apiTokensLoading" class="text-xs text-slate-500">Loading…</p>
        <p v-else-if="!apiTokens.length" class="text-xs text-slate-500">No tokens yet.</p>
        <ul v-else class="divide-y divide-slate-800 overflow-hidden rounded-lg ring-1 ring-slate-800">
          <li
            v-for="t in apiTokens"
            :key="t.id"
            class="flex items-center gap-3 bg-slate-900 px-3 py-2"
            :class="t.revokedAt ? 'opacity-50' : ''"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ t.name }}
                <span v-if="t.revokedAt" class="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">revoked</span>
              </p>
              <p class="truncate text-xs text-slate-500">
                {{ t.scopes }} · created {{ fmtDay(t.createdAt) }} · last used {{ fmtDay(t.lastUsedAt) }}
              </p>
            </div>
            <button
              v-if="!t.revokedAt"
              class="shrink-0 rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              @click="revokeToken(t)"
            >
              Revoke
            </button>
          </li>
        </ul>
      </div>

      <!-- Server-wide management — owner only -->
      <p v-if="!isOwner" class="rounded-xl bg-slate-900 p-4 text-xs text-slate-500">
        Server-wide management (accounts, invites, activity, log downloads) is only available to the server owner.
      </p>
      <p v-else-if="loading" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">Loading…</p>
      <p v-else-if="loadError" class="rounded-xl bg-red-950/40 p-6 text-center text-sm text-red-400">{{ loadError }}</p>
      <template v-else>
      <!-- Overview tiles -->
      <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div v-for="[label, value] in tiles" :key="label" class="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
          <p class="text-xs text-slate-400">{{ label }}</p>
          <p class="text-lg font-bold">{{ value }}</p>
        </div>
      </div>

      <!-- Activity chart -->
      <div class="mb-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Activity — last 30 days</h2>
        <p v-if="!daily.length" class="text-xs text-slate-500">No activity recorded yet.</p>
        <div class="space-y-1.5">
          <div v-for="d in daily" :key="d.day" class="flex items-center gap-2 text-xs">
            <span class="w-20 shrink-0 text-slate-400">{{ d.day.slice(5) }}</span>
            <div class="h-4 flex-1 overflow-hidden rounded bg-slate-800">
              <div class="h-full rounded bg-emerald-500/70" :style="{ width: d.pct + '%' }" />
            </div>
            <span class="w-40 text-right text-slate-400">
              {{ d.ops }} ops · {{ d.tx }} sales · {{ d.logins }} logins
            </span>
          </div>
        </div>
      </div>

      <!-- Invites -->
      <div class="mb-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Invites</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="inviteBusy"
            @click="createInvite(false)"
          >
            Invite member to my account
          </button>
          <button
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="inviteBusy"
            @click="createInvite(true)"
          >
            New-account invite
          </button>
          <button
            v-if="inviteCode"
            class="rounded-lg bg-emerald-950 px-4 py-2 font-mono text-sm font-semibold text-emerald-300 ring-1 ring-emerald-700"
            title="Copy to clipboard"
            @click="copyInvite"
          >
            <span class="flex items-center gap-1.5">{{ inviteCode }} <Copy class="h-3.5 w-3.5" /></span>
          </button>
        </div>
        <p class="mt-2 text-xs text-slate-500">Codes are single-use and valid for 14 days.</p>
      </div>

      <!-- Accounts -->
      <div class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Accounts</h2>
        <ul class="space-y-2">
          <li v-for="a in accounts" :key="a.id" class="rounded-lg bg-slate-800/50 ring-1 ring-slate-700">
            <button class="flex w-full items-center gap-3 p-3 text-left" @click="toggleAccount(a.id)">
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ a.name }}</span>
              <span class="text-xs text-slate-400">{{ a.userCount }} users</span>
              <span class="text-xs text-slate-400">{{ a.deviceCount }} devices</span>
              <span class="text-xs text-slate-400">{{ a.txTotal }} sales</span>
              <span class="text-xs text-slate-500">seen {{ fmtWhen(a.lastActivityAt) }}</span>
              <span class="text-slate-500">{{ expandedId === a.id ? '▾' : '▸' }}</span>
            </button>
            <div v-if="expandedId === a.id" class="border-t border-slate-700 p-3">
              <p v-if="!detail" class="text-xs text-slate-500">Loading…</p>
              <template v-else>
                <h3 class="mb-1 text-xs font-semibold text-slate-400">Users</h3>
                <ul class="mb-3 space-y-1">
                  <li v-for="u in detail.users" :key="u.id" class="flex items-center gap-2 text-xs">
                    <span class="min-w-0 flex-1 truncate">{{ u.email }}</span>
                    <span class="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase">{{ u.role }}</span>
                    <span class="text-slate-500">last login {{ fmtWhen(u.lastLoginAt) }}</span>
                  </li>
                </ul>
                <h3 class="mb-1 text-xs font-semibold text-slate-400">Devices</h3>
                <p v-if="!detail.devices.length" class="text-xs text-slate-500">No devices seen yet.</p>
                <ul class="space-y-1">
                  <li v-for="d in detail.devices" :key="d.id" class="flex items-center gap-2 text-xs">
                    <span class="min-w-0 flex-1 truncate">{{ d.name || d.id }}</span>
                    <span class="text-slate-500">seen {{ fmtWhen(d.lastSeenAt) }}</span>
                  </li>
                </ul>
              </template>
            </div>
          </li>
        </ul>
      </div>

      <!-- Diagnostic logs -->
      <div class="mt-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Diagnostic logs</h2>
        <p v-if="!logs.length" class="text-xs text-slate-500">No logs uploaded yet.</p>
        <ul class="space-y-2">
          <li
            v-for="l in logs"
            :key="l.id"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-800/50 p-3 text-xs ring-1 ring-slate-700"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ l.deviceName || l.deviceId }}</span>
            <span class="text-slate-400">{{ l.accountName }}</span>
            <span v-if="l.flavor" class="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase">{{ l.flavor }}</span>
            <span v-if="l.appVersion" class="text-slate-500">{{ l.appVersion }}</span>
            <span v-if="l.reason" class="text-amber-400">{{ l.reason }}</span>
            <span class="text-slate-500">{{ fmtBytes(l.size) }}</span>
            <span class="text-slate-500">{{ fmtWhen(l.createdAt) }}</span>
            <button
              class="rounded bg-slate-700 px-2 py-1 font-medium hover:bg-slate-600"
              @click="downloadLog(l)"
            >
              Download
            </button>
          </li>
        </ul>
      </div>

      <!-- Login sessions (all accounts) -->
      <div class="mt-4 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Login sessions</h2>
        <p class="mb-2 text-xs text-slate-500">
          Every device currently signed in, across accounts — with remote log-out.
          <span v-if="!sessionsGeo">Location is off (set GEO_LOOKUP=1 to resolve city/country).</span>
        </p>
        <p v-if="!sessions.length" class="text-xs text-slate-500">No active sessions.</p>
        <ul class="space-y-2">
          <li
            v-for="s in sessions"
            :key="s.id"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-800/50 p-3 text-xs ring-1 ring-slate-700"
          >
            <span class="min-w-0 flex-1 truncate font-medium">
              {{ s.email }}
              <span v-if="s.deviceId && s.deviceId === myDeviceId" class="ml-1 rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">this device</span>
            </span>
            <span class="text-slate-400">{{ s.accountName }}</span>
            <span v-if="s.flavor" class="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase">{{ s.flavor }}</span>
            <span class="text-slate-500">{{ [s.device, s.ip, s.geo].filter(Boolean).join(' · ') }}</span>
            <span class="text-slate-500">seen {{ fmtWhen(s.lastUsedAt) }}</span>
            <button class="rounded bg-red-950 px-2 py-1 font-medium text-red-300 hover:bg-red-900" @click="revokeSessionRemote(s)">
              Log out
            </button>
          </li>
        </ul>
      </div>
      </template>
    </template>
  </div>
</template>
