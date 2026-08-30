<script setup lang="ts">
import { ChevronRight, ShieldCheck, Smartphone, CreditCard, Receipt, Download } from 'lucide-vue-next';

// Ordered by workflow: identity/security first, then this device's setup, then
// business-facing config, then app maintenance last.
const pages = [
  { to: '/settings/account', label: 'Account & security', desc: 'Server sync, 2FA, sessions, PIN lock', icon: ShieldCheck },
  { to: '/settings/device', label: 'Device', desc: 'Name, currency, rounding, customer display', icon: Smartphone },
  { to: '/settings/payments', label: 'Payments', desc: 'Card terminal & extra payment methods', icon: CreditCard },
  { to: '/settings/receipts', label: 'Artist & receipts', desc: 'Business details, logo, printer', icon: Receipt },
  { to: '/settings/app', label: 'App & data', desc: 'Updates, backup, legacy app', icon: Download },
];
</script>

<template>
  <div class="zui-settings-page">
    <div class="zui-settings-head">
      <h1 class="zui-title">Settings</h1>
    </div>
    <div class="zui-settings-list">
      <RouterLink v-for="p in pages" :key="p.to" :to="p.to" class="zui-settings-card">
        <component :is="p.icon" class="zui-settings-card-icon" />
        <div class="zui-settings-card-body">
          <span class="zui-settings-card-title">{{ p.label }}</span>
          <span class="zui-settings-card-desc">{{ p.desc }}</span>
        </div>
        <ChevronRight class="zui-settings-card-chevron" />
      </RouterLink>
    </div>
  </div>
</template>
