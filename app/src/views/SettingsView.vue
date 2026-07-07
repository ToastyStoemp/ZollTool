<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { getSetting, setSetting } from '@/db/repo';
import { allProviders } from '@/payments/registry';
import { SUMUP_KEY_SETTING } from '@/payments/sumup';
import type { PaymentProviderId, ProviderStatus } from '@/payments/provider';
import { showToast } from '@/lib/toast';
import { exportBackup, importBackup } from '@/lib/export/backup-json';
import { saveTextFile } from '@/lib/download';
import { syncState, syncNow } from '@/sync/engine';

const settings = useSettingsStore();

const statuses = ref<Record<string, ProviderStatus & { available: boolean }>>({});
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshStatuses(): Promise<void> {
  for (const p of allProviders()) {
    const available = await p.isAvailable();
    const status = available ? await p.getStatus() : { connected: false, detail: 'Not available here' };
    statuses.value[p.id] = { ...status, available };
  }
}

const sumupKey = ref('');

onMounted(async () => {
  refreshStatuses();
  pollTimer = setInterval(refreshStatuses, 5000);
  sumupKey.value = (await getSetting<string>(SUMUP_KEY_SETTING)) ?? '';
});

async function saveSumupKey(): Promise<void> {
  await setSetting(SUMUP_KEY_SETTING, sumupKey.value.trim());
  showToast('SumUp affiliate key saved', 'success');
}
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function selectProvider(id: PaymentProviderId): Promise<void> {
  await settings.setPaymentProvider(id);
  showToast('Payment provider updated', 'success');
  refreshStatuses();
}

async function configureProvider(id: PaymentProviderId): Promise<void> {
  const provider = allProviders().find((p) => p.id === id);
  if (!provider?.configure) return;
  try {
    await provider.configure();
    showToast('Connecting…', 'info');
  } catch (err) {
    showToast(String(err), 'error');
  }
  setTimeout(refreshStatuses, 1500);
}

// ── Server sync ─────────────────────────────────────────────────────────────
const authMode = ref<'login' | 'register'>('login');
const authUrl = ref(settings.serverUrl);
const authEmail = ref('');
const authPassword = ref('');
const authInvite = ref('');
const authAccountName = ref('');
const authBusy = ref(false);
const authError = ref('');

async function submitAuth(): Promise<void> {
  if (!authUrl.value.trim() || !authEmail.value.trim() || !authPassword.value) {
    authError.value = 'Server, email and password are required';
    return;
  }
  authBusy.value = true;
  authError.value = '';
  try {
    if (authMode.value === 'login') {
      await settings.loginToServer(authUrl.value, authEmail.value.trim(), authPassword.value);
    } else {
      await settings.registerOnServer(authUrl.value, {
        email: authEmail.value.trim(),
        password: authPassword.value,
        inviteCode: authInvite.value.trim() || undefined,
        accountName: authAccountName.value.trim() || undefined,
      });
    }
    authPassword.value = '';
    showToast('Connected — sync is on', 'success');
  } catch (err) {
    authError.value = err instanceof Error ? err.message : String(err);
  } finally {
    authBusy.value = false;
  }
}

async function doLogout(): Promise<void> {
  await settings.logoutFromServer();
  showToast('Logged out — the app keeps working offline', 'info');
}

function fmtSyncTime(ts: number): string {
  return ts ? new Date(ts).toLocaleTimeString() : 'never';
}

// ── Backup ──────────────────────────────────────────────────────────────────
const importInput = ref<HTMLInputElement | null>(null);
const busyBackup = ref(false);

async function doExportBackup(): Promise<void> {
  busyBackup.value = true;
  try {
    const json = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    await saveTextFile(`zolltool_backup_${stamp}.json`, json, 'application/json');
  } catch (err) {
    showToast(`Backup failed: ${err}`, 'error');
  } finally {
    busyBackup.value = false;
  }
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busyBackup.value = true;
  try {
    const counts = await importBackup(await file.text());
    showToast(
      `Imported ${counts.events} events, ${counts.products} products, ${counts.transactions} sales`,
      'success',
    );
  } catch (err) {
    showToast(`Import failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    busyBackup.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
    <h1 class="text-xl font-bold">Settings</h1>

    <!-- Device -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-3 text-sm font-semibold text-slate-300">This device</h2>
      <label class="block text-sm">
        <span class="text-slate-400">Device name</span>
        <input
          :value="settings.deviceName"
          placeholder="e.g. Wolf's tablet"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
          @change="settings.setDeviceName(($event.target as HTMLInputElement).value)"
        />
      </label>
      <p class="mt-2 text-xs text-slate-500">Device ID: {{ settings.deviceId }}</p>
      <button
        class="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
        @click="settings.reopenOnboarding()"
      >
        Run setup guide
      </button>
    </section>

    <!-- Payment provider -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-3 text-sm font-semibold text-slate-300">Card payment terminal</h2>
      <div class="space-y-2">
        <div
          v-for="p in allProviders()"
          :key="p.id"
          class="flex items-center gap-3 rounded-lg p-3 ring-1"
          :class="
            settings.paymentProviderId === p.id
              ? 'bg-emerald-950/40 ring-emerald-700'
              : 'bg-slate-800/50 ring-slate-700'
          "
        >
          <input
            type="radio"
            name="provider"
            :checked="settings.paymentProviderId === p.id"
            :disabled="!statuses[p.id]?.available"
            @change="selectProvider(p.id)"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium" :class="{ 'opacity-40': !statuses[p.id]?.available }">
              {{ p.label }}
            </p>
            <p class="text-xs text-slate-500">{{ statuses[p.id]?.detail || '…' }}</p>
          </div>
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            :class="statuses[p.id]?.connected ? 'bg-emerald-400' : 'bg-slate-600'"
          />
          <button
            v-if="p.configure && statuses[p.id]?.available"
            class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
            @click="configureProvider(p.id)"
          >
            Connect
          </button>
        </div>
      </div>
      <label v-if="statuses['sumup']?.available" class="mt-3 block text-sm">
        <span class="text-slate-400">SumUp affiliate key</span>
        <input
          v-model="sumupKey"
          type="text"
          placeholder="From the SumUp developer dashboard"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs"
          @change="saveSumupKey"
        />
      </label>
    </section>

    <!-- Backup -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Backup</h2>
      <p class="mb-3 text-xs text-slate-500">
        Export everything (events, products, sales, discounts, photos) as one JSON file, or restore
        from a backup. Importing merges by id — it never deletes existing data. JSON files saved by
        the old ZollTool are accepted too and become a new event.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="busyBackup"
          @click="doExportBackup"
        >
          Export backup
        </button>
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="busyBackup"
          @click="importInput?.click()"
        >
          Import backup
        </button>
        <input ref="importInput" type="file" accept="application/json,.json" class="hidden" @change="onImportFile" />
      </div>
    </section>

    <!-- Server sync -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Server sync</h2>

      <!-- Logged in -->
      <template v-if="settings.syncUser">
        <div class="mb-3 flex items-center gap-2">
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            :class="syncState.online ? (syncState.wsConnected ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-red-400'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ settings.syncUser.email }}</p>
            <p class="truncate text-xs text-slate-500">
              {{ settings.syncUser.accountName }} · {{ settings.serverUrl }}
            </p>
          </div>
        </div>
        <p class="mb-3 text-xs text-slate-500">
          <template v-if="syncState.syncing">Syncing…</template>
          <template v-else-if="syncState.lastError">
            <span class="text-amber-400">Offline mode — {{ syncState.lastError }}</span>
          </template>
          <template v-else>
            Last sync {{ fmtSyncTime(syncState.lastSyncAt) }}
            <span v-if="syncState.pendingOps"> · {{ syncState.pendingOps }} change(s) waiting</span>
            <span v-else> · everything is up to date</span>
          </template>
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
            :disabled="syncState.syncing"
            @click="syncNow"
          >
            Sync now
          </button>
          <RouterLink
            v-if="settings.syncUser.role === 'owner'"
            to="/admin"
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
          >
            Server admin
          </RouterLink>
          <button class="rounded-lg px-4 py-2 text-sm text-red-400 hover:bg-red-950" @click="doLogout">
            Log out
          </button>
        </div>
      </template>

      <!-- Logged out -->
      <template v-else>
        <p class="mb-3 text-xs text-slate-500">
          Optional: connect to a ZollTool server so several devices can sell into the same event.
          The app keeps working fully offline — changes sync whenever there's a connection.
        </p>
        <div class="mb-3 flex rounded-lg bg-slate-800 p-1 text-sm">
          <button
            class="flex-1 rounded-md px-3 py-1.5"
            :class="authMode === 'login' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
            @click="authMode = 'login'"
          >
            Log in
          </button>
          <button
            class="flex-1 rounded-md px-3 py-1.5"
            :class="authMode === 'register' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
            @click="authMode = 'register'"
          >
            Create account
          </button>
        </div>
        <form class="space-y-2" @submit.prevent="submitAuth">
          <input
            v-model="authUrl"
            type="url"
            placeholder="Server URL, e.g. https://sync.example.com"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            v-model="authEmail"
            type="email"
            autocomplete="email"
            placeholder="Email"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            v-model="authPassword"
            type="password"
            :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
            placeholder="Password"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <template v-if="authMode === 'register'">
            <input
              v-model="authInvite"
              type="text"
              placeholder="Invite code (joins an existing account)"
              class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              v-if="!authInvite"
              v-model="authAccountName"
              type="text"
              placeholder="Account name, e.g. GET UP GAMES"
              class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
            />
          </template>
          <p v-if="authError" class="text-xs text-red-400">{{ authError }}</p>
          <button
            type="submit"
            class="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            :disabled="authBusy"
          >
            {{ authBusy ? 'Connecting…' : authMode === 'login' ? 'Log in' : 'Create account' }}
          </button>
        </form>
      </template>
    </section>

    <!-- Legacy -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Legacy app</h2>
      <p class="mb-3 text-xs text-slate-500">
        The previous version (incl. the customs tool) ships alongside until every feature is ported.
        <span v-if="settings.migratedFromV1">Your old data was imported automatically.</span>
      </p>
      <a
        href="legacy/index.html"
        class="inline-block rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
      >
        Open legacy ZollTool
      </a>
    </section>
  </div>
</template>
