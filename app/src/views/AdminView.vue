<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Copy } from 'lucide-vue-next';
import type { AdminAccount, AdminAccountDetail, AdminMetricRow, AdminOverview } from '@zolltool/shared';
import { useSettingsStore } from '@/stores/settings';
import { apiJson } from '@/sync/api';
import { showToast } from '@/lib/toast';

const settings = useSettingsStore();
const isOwner = computed(() => settings.syncUser?.role === 'owner');

const loading = ref(true);
const loadError = ref('');
const overview = ref<AdminOverview | null>(null);
const accounts = ref<AdminAccount[]>([]);
const metrics = ref<AdminMetricRow[]>([]);
const expandedId = ref<string | null>(null);
const detail = ref<AdminAccountDetail | null>(null);
const inviteCode = ref('');
const inviteBusy = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    [overview.value, accounts.value, metrics.value] = await Promise.all([
      apiJson<AdminOverview>('/api/admin/overview'),
      apiJson<AdminAccount[]>('/api/admin/accounts'),
      apiJson<AdminMetricRow[]>('/api/admin/metrics?days=30'),
    ]);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (isOwner.value) void load();
  else loading.value = false;
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

    <p v-if="!isOwner" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      This page is only available to the server owner.
      <span v-if="!settings.syncUser"> Log in under Settings first.</span>
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
    </template>
  </div>
</template>
