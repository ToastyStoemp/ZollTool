<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { showToast } from '@/lib/toast';
import { syncState, syncNow } from '@/sync/engine';
import {
  TwoFactorRequired,
  get2faStatus,
  setup2fa,
  enable2fa,
  disable2fa,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  getDeviceId,
  type SessionInfo,
  type TotpSetup,
} from '@/sync/api';
import { connectQrDataUrl, decodeConnectQr, qrDataUrl } from '@/lib/qr';
import { hashPin, pinState, setPin } from '@/lib/pin';
import { isNative } from '@/native/plugins';
import { Camera, QrCode } from 'lucide-vue-next';
import ModalShell from '@/components/ModalShell.vue';
import SettingsShell from './SettingsShell.vue';

const settings = useSettingsStore();

onMounted(() => {
  if (settings.syncUser) {
    void loadTwofa();
    void loadSessions();
  }
});

// ── Server sync / login ─────────────────────────────────────────────────────
const authMode = ref<'login' | 'register'>('login');
const authUrl = ref(settings.serverUrl);
const authEmail = ref('');
const authPassword = ref('');
const authInvite = ref('');
const authAccountName = ref('');
const authCode = ref('');
const authNeeds2fa = ref(false);
const authRemember = ref(true);
const authBusy = ref(false);
const authError = ref('');

watch(
  () => settings.ready,
  (ready) => {
    if (ready && !authUrl.value) authUrl.value = settings.serverUrl;
  },
  { immediate: true },
);

async function submitAuth(): Promise<void> {
  if (!authUrl.value.trim() || !authEmail.value.trim() || !authPassword.value) {
    authError.value = 'Server, email and password are required';
    return;
  }
  authBusy.value = true;
  authError.value = '';
  try {
    if (authMode.value === 'login') {
      await settings.loginToServer(authUrl.value, authEmail.value.trim(), authPassword.value, {
        code: authCode.value.trim() || undefined,
        rememberDevice: authRemember.value,
      });
    } else {
      await settings.registerOnServer(authUrl.value, {
        email: authEmail.value.trim(),
        password: authPassword.value,
        inviteCode: authInvite.value.trim() || undefined,
        accountName: authAccountName.value.trim() || undefined,
      });
    }
    authPassword.value = '';
    authCode.value = '';
    authNeeds2fa.value = false;
    showToast('Connected — sync is on', 'success');
  } catch (err) {
    if (err instanceof TwoFactorRequired) {
      authNeeds2fa.value = true;
      authError.value = err.invalidCode ? 'That code is not valid — try again.' : '';
    } else {
      authError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    authBusy.value = false;
  }
}
async function doLogout(): Promise<void> {
  await settings.logoutFromServer();
  showToast(isNative ? 'Logged out — the app keeps working offline' : 'Logged out', 'info');
}
function fmtSyncTime(ts: number): string {
  return ts ? new Date(ts).toLocaleTimeString() : 'never';
}

// ── Quick connect via QR ────────────────────────────────────────────────────
const showShareQr = ref(false);
const shareQrPassword = ref('');
const shareQrImg = ref('');
const scanInput = ref<HTMLInputElement | null>(null);

function openShareQr(): void {
  shareQrPassword.value = '';
  shareQrImg.value = '';
  showShareQr.value = true;
}
async function generateShareQr(): Promise<void> {
  if (!shareQrPassword.value) return;
  shareQrImg.value = await connectQrDataUrl({
    url: settings.serverUrl,
    email: settings.syncUser?.email ?? '',
    password: shareQrPassword.value,
  });
}
async function onScanFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const payload = await decodeConnectQr(file);
    if (!payload) {
      showToast('No ZollTool connect code found in the photo', 'error');
      return;
    }
    authMode.value = 'login';
    authUrl.value = payload.url;
    authEmail.value = payload.email;
    authPassword.value = payload.password;
    showToast('Code scanned — connecting…', 'info');
    await submitAuth();
  } catch (err) {
    showToast(`Scan failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── Two-factor auth ─────────────────────────────────────────────────────────
const twofaEnabled = ref(false);
const twofaLoading = ref(true);
const twofaSetup = ref<TotpSetup | null>(null);
const twofaQr = ref('');
const twofaConfirmCode = ref('');
const twofaRecovery = ref<string[] | null>(null);
const twofaMsg = ref('');
const twofaBusy = ref(false);

async function loadTwofa(): Promise<void> {
  twofaLoading.value = true;
  try {
    twofaEnabled.value = (await get2faStatus()).enabled;
  } catch {
    /* not reachable — leave disabled */
  } finally {
    twofaLoading.value = false;
  }
}
async function startTwofaSetup(): Promise<void> {
  twofaMsg.value = '';
  twofaBusy.value = true;
  try {
    twofaSetup.value = await setup2fa();
    twofaQr.value = await qrDataUrl(twofaSetup.value.otpauth);
  } catch (err) {
    twofaMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    twofaBusy.value = false;
  }
}
async function confirmTwofa(): Promise<void> {
  twofaMsg.value = '';
  twofaBusy.value = true;
  try {
    twofaRecovery.value = (await enable2fa(twofaConfirmCode.value.trim())).recovery;
    twofaEnabled.value = true;
    twofaSetup.value = null;
    twofaQr.value = '';
    twofaConfirmCode.value = '';
  } catch (err) {
    twofaMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    twofaBusy.value = false;
  }
}
function cancelTwofaSetup(): void {
  twofaSetup.value = null;
  twofaQr.value = '';
  twofaConfirmCode.value = '';
  twofaMsg.value = '';
}
async function doDisableTwofa(): Promise<void> {
  const code = window.prompt('Enter an authenticator or recovery code to disable 2FA:');
  if (!code) return;
  try {
    await disable2fa(code.trim());
    twofaEnabled.value = false;
    showToast('Two-factor authentication disabled', 'info');
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
  }
}

// ── Login sessions ──────────────────────────────────────────────────────────
const sessions = ref<SessionInfo[]>([]);
const sessionsGeo = ref(false);
const sessionsLoading = ref(false);
const myDeviceId = ref<string | undefined>();

async function loadSessions(): Promise<void> {
  sessionsLoading.value = true;
  try {
    const d = await listSessions();
    sessions.value = d.sessions;
    sessionsGeo.value = d.geo;
    myDeviceId.value = await getDeviceId();
  } catch {
    /* ignore */
  } finally {
    sessionsLoading.value = false;
  }
}
async function doRevokeSession(id: string): Promise<void> {
  if (!confirm('Log out this session?')) return;
  try {
    await revokeSession(id);
    await loadSessions();
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
  }
}
async function doRevokeOthers(): Promise<void> {
  if (!confirm('Log out all other devices? They will need to sign in again.')) return;
  try {
    const r = await revokeOtherSessions();
    await loadSessions();
    showToast(`Logged out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}`, 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
  }
}
const isMySession = (s: SessionInfo): boolean => !!s.deviceId && s.deviceId === myDeviceId.value;

// ── Security: PIN lock ──────────────────────────────────────────────────────
const pinCurrent = ref('');
const pinNew = ref('');
const pinConfirm = ref('');
const hasPin = () => !!pinState.hash;

async function verifyCurrentPin(): Promise<boolean> {
  if (!pinState.hash) return true;
  if ((await hashPin(pinCurrent.value)) === pinState.hash) return true;
  showToast('Current PIN is wrong.', 'error');
  return false;
}
async function savePinSettings(): Promise<void> {
  if (!/^\d{4,8}$/.test(pinNew.value)) {
    showToast('PIN must be 4–8 digits.', 'error');
    return;
  }
  if (pinNew.value !== pinConfirm.value) {
    showToast('PINs do not match.', 'error');
    return;
  }
  if (!(await verifyCurrentPin())) return;
  await setPin(pinNew.value);
  pinCurrent.value = pinNew.value = pinConfirm.value = '';
  showToast('PIN set — Settings, Catalog, History, Customs and Admin now require it', 'success');
}
async function removePinSettings(): Promise<void> {
  if (!(await verifyCurrentPin())) return;
  await setPin(null);
  pinCurrent.value = pinNew.value = pinConfirm.value = '';
  showToast('PIN removed', 'info');
}
</script>

<template>
  <SettingsShell title="Account &amp; security">
    <!-- Server sync -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Server sync</h2>

      <template v-if="settings.syncUser">
        <div class="mb-3 flex items-center gap-2">
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            :class="syncState.online ? (syncState.wsConnected ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-red-400'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ settings.syncUser.email }}</p>
            <p class="truncate text-xs text-slate-500">{{ settings.syncUser.accountName }} · {{ settings.serverUrl }}</p>
          </div>
        </div>
        <p class="mb-3 text-xs text-slate-500">
          <template v-if="syncState.syncing">Syncing…</template>
          <template v-else-if="syncState.lastError"><span class="text-amber-400">Offline mode — {{ syncState.lastError }}</span></template>
          <template v-else>
            Last sync {{ fmtSyncTime(syncState.lastSyncAt) }}
            <span v-if="syncState.pendingOps"> · {{ syncState.pendingOps }} change(s) waiting</span>
            <span v-else> · everything is up to date</span>
          </template>
        </p>
        <div class="flex flex-wrap gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700" :disabled="syncState.syncing" @click="syncNow">Sync now</button>
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700" @click="openShareQr">
            <span class="flex items-center gap-1.5"><QrCode class="h-4 w-4" /> Share login (QR)</span>
          </button>
          <RouterLink to="/admin" class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700">
            {{ settings.syncUser.role === 'owner' ? 'Server admin' : 'Admin & diagnostics' }}
          </RouterLink>
          <button class="rounded-lg px-4 py-2 text-sm text-red-400 hover:bg-red-950" @click="doLogout">Log out</button>
        </div>
      </template>

      <p v-else-if="!isNative" class="text-xs text-slate-500">Logging you out…</p>

      <template v-else>
        <p class="mb-3 text-xs text-slate-500">
          Optional: connect to a ZollTool server so several devices can sell into the same event. The app keeps working fully offline — changes sync whenever there's a connection.
        </p>
        <div class="mb-3 flex rounded-lg bg-slate-800 p-1 text-sm">
          <button class="flex-1 rounded-md px-3 py-1.5" :class="authMode === 'login' ? 'bg-slate-700 font-semibold' : 'text-slate-400'" @click="authMode = 'login'">Log in</button>
          <button class="flex-1 rounded-md px-3 py-1.5" :class="authMode === 'register' ? 'bg-slate-700 font-semibold' : 'text-slate-400'" @click="authMode = 'register'">Create account</button>
        </div>
        <form class="space-y-2" @submit.prevent="submitAuth">
          <input v-model="authUrl" type="url" placeholder="Server URL, e.g. https://sync.example.com" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
          <input v-model="authEmail" type="email" autocomplete="email" placeholder="Email" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
          <input
            v-model="authPassword"
            type="password"
            :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
            placeholder="Password"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <template v-if="authMode === 'login' && authNeeds2fa">
            <input
              v-model="authCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="6-digit code or recovery code"
              class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
            />
            <label class="flex items-center gap-2 px-1 text-xs text-slate-400">
              <input v-model="authRemember" type="checkbox" class="accent-emerald-500" />
              Remember this device (skip 2FA here next time)
            </label>
          </template>
          <template v-if="authMode === 'register'">
            <input v-model="authInvite" type="text" placeholder="Invite code (joins an existing account)" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
            <input v-if="!authInvite" v-model="authAccountName" type="text" placeholder="Account name, e.g. Phuong Ninjin" class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
          </template>
          <p v-if="authError" class="text-xs text-red-400">{{ authError }}</p>
          <button type="submit" class="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" :disabled="authBusy">
            {{ authBusy ? 'Connecting…' : authMode === 'login' ? 'Log in' : 'Create account' }}
          </button>
          <button
            type="button"
            class="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="authBusy"
            @click="scanInput?.click()"
          >
            <span class="flex items-center justify-center gap-1.5"><Camera class="h-4 w-4" /> Scan connect QR from another device</span>
          </button>
          <input ref="scanInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onScanFile" />
        </form>
      </template>
    </section>

    <!-- Two-factor authentication -->
    <section v-if="settings.syncUser" class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Two-factor authentication</h2>
      <p class="mb-3 text-xs text-slate-500">Protect your account login with an authenticator app (Google Authenticator, Authy, 1Password…).</p>
      <p v-if="twofaLoading" class="text-xs text-slate-500">Loading…</p>

      <template v-else-if="twofaRecovery">
        <p class="mb-2 text-xs text-emerald-400">● 2FA enabled. Save these recovery codes — each works once if you lose your device; they won't be shown again.</p>
        <div class="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-800 p-3 font-mono text-xs">
          <span v-for="c in twofaRecovery" :key="c">{{ c }}</span>
        </div>
        <button class="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700" @click="twofaRecovery = null">Done</button>
      </template>

      <template v-else-if="twofaSetup">
        <p class="mb-2 text-xs text-slate-500">Scan with your authenticator app, or enter the key manually:</p>
        <img v-if="twofaQr" :src="twofaQr" alt="2FA QR code" class="mb-2 rounded-lg bg-white p-2" width="180" height="180" />
        <code class="mb-3 block break-all rounded bg-slate-800 px-2 py-1.5 text-xs tracking-wider">{{ twofaSetup.secret }}</code>
        <input v-model="twofaConfirmCode" type="text" inputmode="numeric" placeholder="Enter the 6-digit code to confirm" class="mb-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" />
        <div class="flex gap-2">
          <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40" :disabled="twofaBusy" @click="confirmTwofa">Verify &amp; enable</button>
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700" @click="cancelTwofaSetup">Cancel</button>
        </div>
        <p v-if="twofaMsg" class="mt-2 text-xs text-red-400">{{ twofaMsg }}</p>
      </template>

      <template v-else-if="twofaEnabled">
        <div class="flex items-center gap-3">
          <span class="rounded-lg bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-400">● Enabled</span>
          <button class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950" @click="doDisableTwofa">Disable…</button>
        </div>
      </template>

      <template v-else>
        <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40" :disabled="twofaBusy" @click="startTwofaSetup">Enable 2FA</button>
        <p v-if="twofaMsg" class="mt-2 text-xs text-red-400">{{ twofaMsg }}</p>
      </template>
    </section>

    <!-- Login sessions -->
    <section v-if="settings.syncUser" class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div class="mb-2 flex items-center gap-2">
        <h2 class="text-sm font-semibold text-slate-300">Your login sessions</h2>
        <button class="rounded bg-slate-800 px-2 py-1 text-[0.65rem] text-slate-300 hover:bg-slate-700" @click="loadSessions">Refresh</button>
        <button v-if="sessions.length > 1" class="ml-auto rounded px-2 py-1 text-[0.65rem] text-red-400 hover:bg-red-950" @click="doRevokeOthers">Log out all others</button>
      </div>
      <p class="mb-2 text-xs text-slate-500">
        Devices currently signed in to your account.
        <span v-if="!sessionsGeo">Location is off — showing device + IP.</span>
      </p>
      <p v-if="sessionsLoading" class="text-xs text-slate-500">Loading…</p>
      <p v-else-if="!sessions.length" class="text-xs text-slate-500">No active sessions.</p>
      <ul v-else class="divide-y divide-slate-800">
        <li v-for="s in sessions" :key="s.id" class="flex items-center gap-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">
              {{ s.deviceName || s.device || 'Session' }}
              <span v-if="isMySession(s)" class="ml-1 rounded bg-emerald-950 px-1.5 py-0.5 text-[0.6rem] text-emerald-400">this device</span>
              <span v-if="s.flavor === 'carbon'" class="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[0.6rem] text-slate-400">Carbon</span>
            </p>
            <p class="truncate text-xs text-slate-500">{{ [s.device, s.ip, s.geo].filter(Boolean).join(' · ') }} · active {{ fmtSyncTime(s.lastUsedAt) }}</p>
          </div>
          <button v-if="!isMySession(s)" class="shrink-0 rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950" @click="doRevokeSession(s.id)">Log out</button>
        </li>
      </ul>
    </section>

    <!-- Security: PIN lock -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">PIN lock</h2>
      <p class="mb-3 text-xs text-slate-500">
        Optional PIN for Settings, Catalog, History, Customs and Admin — helpers can still sell in the POS. Locks again when the app restarts.
        <span v-if="hasPin()" class="text-emerald-400">PIN is active.</span>
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label v-if="hasPin()" class="col-span-2 block text-sm">
          <span class="text-slate-400">Current PIN</span>
          <input v-model="pinCurrent" type="password" inputmode="numeric" autocomplete="off" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">{{ hasPin() ? 'New PIN' : 'PIN (4–8 digits)' }}</span>
          <input v-model="pinNew" type="password" inputmode="numeric" autocomplete="off" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Repeat PIN</span>
          <input v-model="pinConfirm" type="password" inputmode="numeric" autocomplete="off" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
      </div>
      <div class="mt-3 flex gap-2">
        <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500" @click="savePinSettings">{{ hasPin() ? 'Change PIN' : 'Set PIN' }}</button>
        <button v-if="hasPin()" class="rounded-lg px-4 py-2 text-sm text-red-400 hover:bg-red-950" @click="removePinSettings">Remove PIN</button>
      </div>
    </section>

    <!-- Quick-connect QR modal -->
    <ModalShell v-if="showShareQr" title="Share login via QR" @close="showShareQr = false">
      <div class="space-y-3">
        <p class="text-xs text-slate-500">
          Another device can scan this code from its Settings → Account & security form to connect instantly. Your password isn't stored on this device, so enter it once to embed it.
          <span class="text-amber-400">The code contains the password in plain text — only show it to devices you trust.</span>
        </p>
        <p class="text-sm text-slate-300">{{ settings.serverUrl }}<br />{{ settings.syncUser?.email }}</p>
        <form class="flex gap-2" @submit.prevent="generateShareQr">
          <input v-model="shareQrPassword" type="password" autocomplete="current-password" placeholder="Account password" class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm" />
          <button type="submit" class="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" :disabled="!shareQrPassword">Generate</button>
        </form>
        <div v-if="shareQrImg" class="flex justify-center rounded-xl bg-white p-3">
          <img :src="shareQrImg" alt="Connect QR code" class="h-64 w-64 [image-rendering:pixelated]" />
        </div>
      </div>
    </ModalShell>
  </SettingsShell>
</template>
