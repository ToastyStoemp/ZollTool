<script setup lang="ts">
import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { TwoFactorRequired } from '@/sync/api';

/**
 * Blocks the whole app until logged in — web/browser access only (see
 * App.vue: `!isNative`). The Android app stays fully offline-capable; this
 * gate exists because the web build is served publicly from the sync
 * server's own domain, so anyone who finds the URL could otherwise use the
 * full offline-capable POS with no account at all.
 *
 * The server URL is never asked for — visiting this page at all means "this
 * server", so it's just the page's own origin.
 */

const settings = useSettingsStore();

const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const invite = ref('');
const accountName = ref('');
const code = ref('');
const needs2fa = ref(false);
const remember = ref(true);
const busy = ref(false);
const error = ref('');

async function submit(): Promise<void> {
  if (!email.value.trim() || !password.value) {
    error.value = 'Email and password are required';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const url = window.location.origin;
    if (mode.value === 'login') {
      await settings.loginToServer(url, email.value.trim(), password.value, {
        code: code.value.trim() || undefined,
        rememberDevice: remember.value,
      });
    } else {
      await settings.registerOnServer(url, {
        email: email.value.trim(),
        password: password.value,
        inviteCode: invite.value.trim() || undefined,
        accountName: accountName.value.trim() || undefined,
      });
    }
  } catch (err) {
    if (err instanceof TwoFactorRequired) {
      needs2fa.value = true;
      error.value = err.invalidCode ? 'That code is not valid — try again.' : '';
    } else {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-slate-950 p-6">
    <span class="text-2xl font-bold tracking-tight text-emerald-400">ZollTool</span>

    <div class="w-full max-w-sm rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div class="mb-3 flex rounded-lg bg-slate-800 p-1 text-sm">
        <button
          class="flex-1 rounded-md px-3 py-1.5"
          :class="mode === 'login' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="mode = 'login'"
        >
          Log in
        </button>
        <button
          class="flex-1 rounded-md px-3 py-1.5"
          :class="mode === 'register' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="mode = 'register'"
        >
          Create account
        </button>
      </div>
      <form class="space-y-2" @submit.prevent="submit">
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="Email"
          class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
        />
        <input
          v-model="password"
          type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="Password"
          class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
        />
        <template v-if="mode === 'login' && needs2fa">
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="6-digit code or recovery code"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <label class="flex items-center gap-2 px-1 text-xs text-slate-400">
            <input v-model="remember" type="checkbox" class="accent-emerald-500" />
            Remember this device (skip 2FA here next time)
          </label>
        </template>
        <template v-if="mode === 'register'">
          <input
            v-model="invite"
            type="text"
            placeholder="Invite code (joins an existing account)"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            v-if="!invite"
            v-model="accountName"
            type="text"
            placeholder="Account name, e.g. Phuong Ninjin"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
        </template>
        <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
        <button
          type="submit"
          class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-40"
          :disabled="busy"
        >
          {{ busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account' }}
        </button>
      </form>
    </div>
  </div>
</template>
