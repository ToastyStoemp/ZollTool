<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { SalesEvent } from '@zolltool/shared';
import { useSettingsStore } from '@/stores/settings';
import { useDataStore } from '@/stores/data';
import { getSetting, setSetting, upsertEvent } from '@/db/repo';
import { importBackup } from '@/lib/export/backup-json';
import { uuidv7 } from '@/lib/uuid';
import { showToast } from '@/lib/toast';
import { syncNow, syncState } from '@/sync/engine';

const settings = useSettingsStore();
const data = useDataStore();

type StepId = 'welcome' | 'sync' | 'data' | 'event' | 'artist' | 'done';

const stepIndex = ref(0);
const imported = ref(false);

/**
 * Sync comes first: connecting pulls the account's existing data before the
 * remaining steps, which then adapt (event step disappears once events exist).
 */
const steps = computed<StepId[]>(() => {
  const list: StepId[] = ['welcome', 'sync', 'data'];
  if (!data.events.length) list.push('event');
  list.push('artist', 'done');
  return list;
});
const step = computed<StepId>(() => steps.value[Math.min(stepIndex.value, steps.value.length - 1)]!);

const STEP_TITLES: Record<StepId, string> = {
  welcome: 'Welcome to ZollTool',
  sync: 'Devices & sync',
  data: 'Bring your data',
  event: 'Your first event',
  artist: 'Artist details',
  done: 'All set!',
};

function back(): void {
  if (stepIndex.value > 0) stepIndex.value--;
}

async function next(): Promise<void> {
  if (step.value === 'event') await createEventIfNamed();
  if (step.value === 'artist') await saveArtistDefaults();
  if (step.value === 'sync') await saveDeviceName();
  if (stepIndex.value < steps.value.length - 1) stepIndex.value++;
}

function finish(): void {
  void settings.completeOnboarding();
  // Push whatever the guide created (event, artist defaults, imports) right away.
  if (syncState.enabled) void syncNow();
}

// ── Data step ────────────────────────────────────────────────────────────────
const importInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importing.value = true;
  try {
    const counts = await importBackup(await file.text());
    imported.value = true;
    showToast(`Imported ${counts.events} event(s), ${counts.products} products, ${counts.transactions} sales`, 'success');
  } catch (err) {
    showToast(`Import failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    importing.value = false;
  }
}

// ── Event step ───────────────────────────────────────────────────────────────
const eventForm = reactive({ name: '', dateStart: '', dateEnd: '', currency: 'CHF' });

async function createEventIfNamed(): Promise<void> {
  if (data.activeEvent || !eventForm.name.trim()) return;
  const event: SalesEvent = {
    id: uuidv7(),
    name: eventForm.name.trim(),
    dateStart: eventForm.dateStart || undefined,
    dateEnd: eventForm.dateEnd || undefined,
    venue: {},
    currency: eventForm.currency.trim().toUpperCase() || 'CHF',
    status: 'active',
    updatedAt: Date.now(),
  };
  await upsertEvent(event);
  await settings.setActiveEvent(event.id);
  showToast(`Event "${event.name}" created and activated`, 'success');
}

// ── Artist step ──────────────────────────────────────────────────────────────
const artistForm = reactive({
  companyName: '',
  fullName: '',
  street: '',
  postCodeCity: '',
  countryOfOrigin: '',
  phone: '',
  email: '',
});

async function saveArtistDefaults(): Promise<void> {
  if (Object.values(artistForm).every((v) => !v.trim())) return;
  await setSetting('customs.artistDefaults', { ...artistForm });
}

// Prefill from data that already exists (saved artist defaults, known server).
onMounted(async () => {
  const saved = await getSetting<Partial<typeof artistForm>>('customs.artistDefaults');
  if (saved) {
    for (const key of Object.keys(artistForm) as (keyof typeof artistForm)[]) {
      if (typeof saved[key] === 'string' && saved[key]) artistForm[key] = saved[key];
    }
  }
  if (!auth.url && settings.serverUrl) auth.url = settings.serverUrl;
});

// ── Sync step ────────────────────────────────────────────────────────────────
const deviceNameForm = ref(settings.deviceName);
const authMode = ref<'login' | 'register'>('login');
const auth = reactive({ url: '', email: '', password: '', inviteCode: '', accountName: '' });
const authBusy = ref(false);
const authError = ref('');

async function saveDeviceName(): Promise<void> {
  if (deviceNameForm.value.trim() && deviceNameForm.value !== settings.deviceName) {
    await settings.setDeviceName(deviceNameForm.value.trim());
  }
}

async function connect(): Promise<void> {
  if (!auth.url.trim() || !auth.email.trim() || !auth.password) {
    authError.value = 'Server, email and password are required';
    return;
  }
  authBusy.value = true;
  authError.value = '';
  try {
    await saveDeviceName();
    if (authMode.value === 'login') {
      await settings.loginToServer(auth.url, auth.email.trim(), auth.password);
    } else {
      await settings.registerOnServer(auth.url, {
        email: auth.email.trim(),
        password: auth.password,
        inviteCode: auth.inviteCode.trim() || undefined,
        accountName: auth.accountName.trim() || undefined,
      });
    }
    showToast('Connected — sync is on', 'success');
  } catch (err) {
    authError.value = err instanceof Error ? err.message : String(err);
  } finally {
    authBusy.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[70] flex flex-col bg-slate-950 pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
  >
    <!-- Progress -->
    <div class="flex items-center gap-3 px-6 pt-5">
      <span class="text-lg font-bold tracking-tight text-emerald-400">ZollTool</span>
      <div class="ml-auto flex gap-1.5">
        <span
          v-for="(s, i) in steps"
          :key="s"
          class="h-1.5 w-6 rounded-full"
          :class="i <= stepIndex ? 'bg-emerald-500' : 'bg-slate-800'"
        />
      </div>
    </div>

    <div class="mx-auto flex w-full max-w-md min-h-0 flex-1 flex-col px-6">
      <div class="min-h-0 flex-1 overflow-y-auto py-6">
        <h1 class="mb-2 text-2xl font-bold">{{ STEP_TITLES[step] }}</h1>

        <!-- Welcome -->
        <template v-if="step === 'welcome'">
          <p class="mb-4 text-sm text-slate-400">
            Point of sale and Swiss customs paperwork for conventions — built to work fully offline.
          </p>
          <ul class="space-y-3 text-sm text-slate-300">
            <li class="flex gap-3"><span>🛒</span><span>Sell with tap-to-cart, discounts, cash & card terminals</span></li>
            <li class="flex gap-3"><span>📅</span><span>Organise sales per event with per-event stock</span></li>
            <li class="flex gap-3"><span>🛃</span><span>Generate e-dec XML, forms 11.74 / 11.87 and goods lists</span></li>
            <li class="flex gap-3"><span>🔄</span><span>Optionally sync several devices through your own server</span></li>
          </ul>
          <p class="mt-4 text-xs text-slate-500">This takes about two minutes — you can skip any step.</p>
        </template>

        <!-- Data -->
        <template v-else-if="step === 'data'">
          <p
            v-if="data.events.length || data.products.length"
            class="mb-3 rounded-lg bg-emerald-950/50 px-3 py-2 text-xs text-emerald-300"
          >
            ✓ Sync already brought {{ data.events.length }} event(s) and
            {{ data.products.length }} product(s) — importing is only needed for old local backups.
          </p>
          <p class="mb-4 text-sm text-slate-400">
            Already used ZollTool before? Restore a backup — v2 backups and JSON files saved by the old
            ZollTool both work. Otherwise just start fresh.
          </p>
          <div class="space-y-2">
            <button
              class="w-full rounded-xl bg-slate-800 px-4 py-3 text-left text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
              :disabled="importing"
              @click="importInput?.click()"
            >
              📂 Import a backup or old JSON file
              <span class="mt-0.5 block text-xs font-normal text-slate-500">
                {{ importing ? 'Importing…' : 'Products, sales, discounts and customs data come along' }}
              </span>
            </button>
            <input ref="importInput" type="file" accept="application/json,.json" class="hidden" @change="onImportFile" />
            <p v-if="imported" class="rounded-lg bg-emerald-950/50 px-3 py-2 text-xs text-emerald-300">
              ✓ Imported — your data is ready{{ settings.syncUser ? ' and will sync to your other devices' : '' }}.
            </p>
          </div>
          <p class="mt-4 text-xs text-slate-500">Nothing to import? Just continue — you can also do this later under Settings → Backup.</p>
        </template>

        <!-- Event -->
        <template v-else-if="step === 'event'">
          <p class="mb-4 text-sm text-slate-400">
            Everything in ZollTool happens inside an event: stock, sales and customs documents. Name your
            next convention to get started.
          </p>
          <div class="space-y-3">
            <label class="block text-sm">
              <span class="text-xs text-slate-400">Event name</span>
              <input v-model="eventForm.name" placeholder="e.g. Fantasy Basel 2026" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-sm">
                <span class="text-xs text-slate-400">Starts</span>
                <input v-model="eventForm.dateStart" type="date" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
              </label>
              <label class="block text-sm">
                <span class="text-xs text-slate-400">Ends</span>
                <input v-model="eventForm.dateEnd" type="date" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
              </label>
            </div>
            <label class="block text-sm">
              <span class="text-xs text-slate-400">Currency</span>
              <input v-model="eventForm.currency" class="mt-1 w-24 rounded-lg bg-slate-800 px-3 py-2" />
            </label>
          </div>
          <p class="mt-4 text-xs text-slate-500">Leave the name empty to skip — events live under the Events tab.</p>
        </template>

        <!-- Artist -->
        <template v-else-if="step === 'artist'">
          <p class="mb-4 text-sm text-slate-400">
            These details go on your customs documents (proforma invoice, forms, e-dec). They're saved as
            defaults and pre-fill every new event's Customs page.
          </p>
          <div class="space-y-3">
            <label class="block text-sm">
              <span class="text-xs text-slate-400">Company / artist name</span>
              <input v-model="artistForm.companyName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
            </label>
            <label class="block text-sm">
              <span class="text-xs text-slate-400">Full name</span>
              <input v-model="artistForm.fullName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
            </label>
            <label class="block text-sm">
              <span class="text-xs text-slate-400">Street & house number</span>
              <input v-model="artistForm.street" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-sm">
                <span class="text-xs text-slate-400">Postcode & city</span>
                <input v-model="artistForm.postCodeCity" placeholder="9000 Gent" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
              </label>
              <label class="block text-sm">
                <span class="text-xs text-slate-400">Country</span>
                <input v-model="artistForm.countryOfOrigin" placeholder="Belgium" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
              </label>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-sm">
                <span class="text-xs text-slate-400">Phone</span>
                <input v-model="artistForm.phone" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
              </label>
              <label class="block text-sm">
                <span class="text-xs text-slate-400">Email</span>
                <input v-model="artistForm.email" type="email" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
              </label>
            </div>
          </div>
        </template>

        <!-- Sync -->
        <template v-else-if="step === 'sync'">
          <label class="mb-4 block text-sm">
            <span class="text-xs text-slate-400">Name this device (shown when several devices sell together)</span>
            <input v-model="deviceNameForm" placeholder="e.g. Wolf's tablet" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>

          <template v-if="settings.syncUser">
            <p class="rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
              ✓ Connected as {{ settings.syncUser.email }} — sync is on.
              <span v-if="data.events.length || data.products.length" class="mt-1 block">
                Fetched {{ data.events.length }} event(s) and {{ data.products.length }} product(s)
                from your account.
              </span>
            </p>
          </template>
          <template v-else>
            <p class="mb-3 text-sm text-slate-400">
              Optional: connect to a ZollTool server so several devices share the same catalog and
              sales. Connecting now pulls your existing data before the next steps — and the app
              keeps working fully offline either way.
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
            <div class="space-y-2">
              <input v-model="auth.url" type="url" placeholder="Server URL, e.g. http://192.168.0.10:8787" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
              <input v-model="auth.email" type="email" placeholder="Email" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
              <input v-model="auth.password" type="password" placeholder="Password" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
              <template v-if="authMode === 'register'">
                <input v-model="auth.inviteCode" placeholder="Invite code (joins an existing account)" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
                <input v-if="!auth.inviteCode" v-model="auth.accountName" placeholder="Account name" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
              </template>
              <p v-if="authError" class="text-xs text-red-400">{{ authError }}</p>
              <button
                class="w-full rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                :disabled="authBusy"
                @click="connect"
              >
                {{ authBusy ? 'Connecting…' : authMode === 'login' ? 'Log in' : 'Create account' }}
              </button>
            </div>
            <p class="mt-3 text-xs text-slate-500">No server? Skip this — you can connect any time under Settings.</p>
          </template>
        </template>

        <!-- Done -->
        <template v-else>
          <p class="mb-4 text-sm text-slate-400">You're ready to sell. A quick map of the app:</p>
          <ul class="space-y-3 text-sm text-slate-300">
            <li class="flex gap-3"><span>📅</span><span><strong>Events</strong> — the heart of the app: sell, view history and generate customs documents from each event's card</span></li>
            <li class="flex gap-3"><span>📦</span><span><strong>Catalog</strong> — products, photos, prices, discounts and bulk stock</span></li>
            <li class="flex gap-3"><span>📈</span><span><strong>History</strong> — stats per event or overall, reverts, CSV & PDF exports</span></li>
            <li class="flex gap-3"><span>⚙️</span><span><strong>Settings</strong> — card terminals, payment methods, sync, backups (and this guide)</span></li>
          </ul>
        </template>
      </div>

      <!-- Footer nav -->
      <div class="flex items-center gap-2 border-t border-slate-800 py-4">
        <button v-if="stepIndex > 0 && step !== 'done'" class="rounded-lg px-4 py-2.5 text-sm text-slate-400" @click="back">
          Back
        </button>
        <button v-if="step === 'welcome'" class="rounded-lg px-4 py-2.5 text-sm text-slate-500" @click="finish">
          Skip setup
        </button>
        <button
          v-if="step !== 'done'"
          class="ml-auto rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white"
          @click="next"
        >
          {{ step === 'welcome' ? "Let's go" : 'Continue' }}
        </button>
        <button v-else class="ml-auto rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white" @click="finish">
          Start selling
        </button>
      </div>
    </div>
  </div>
</template>
