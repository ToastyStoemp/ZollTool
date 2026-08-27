import { createRouter, createWebHashHistory } from 'vue-router';

// Hash history: works identically on file://-like Capacitor WebViews,
// GitHub Pages subpaths, and the dev server — no server rewrites needed.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/events' },
    { path: '/events', name: 'events', component: () => import('@/views/EventsView.vue') },
    // Selling and customs are opened from an event, not from the main nav
    { path: '/pos', name: 'pos', component: () => import('@/views/PosView.vue') },
    { path: '/customs/:eventId?', name: 'customs', component: () => import('@/views/CustomsView.vue') },
    { path: '/prices/:eventId?', name: 'prices', component: () => import('@/views/PriceCompareView.vue') },
    { path: '/catalog', name: 'catalog', component: () => import('@/views/CatalogView.vue') },
    { path: '/history', name: 'history', component: () => import('@/views/HistoryView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/settings/SettingsIndex.vue') },
    { path: '/settings/device', name: 'settings-device', component: () => import('@/views/settings/SettingsDevice.vue') },
    { path: '/settings/payments', name: 'settings-payments', component: () => import('@/views/settings/SettingsPayments.vue') },
    { path: '/settings/receipts', name: 'settings-receipts', component: () => import('@/views/settings/SettingsReceipts.vue') },
    { path: '/settings/account', name: 'settings-account', component: () => import('@/views/settings/SettingsAccount.vue') },
    { path: '/settings/app', name: 'settings-app', component: () => import('@/views/settings/SettingsAppData.vue') },
    // Customer display mode: mirrors another register's cart (Settings → This device)
    { path: '/display', name: 'display', component: () => import('@/views/DisplayView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue') },
  ],
});
