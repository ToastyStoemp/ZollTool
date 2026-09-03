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

// Stale-deploy recovery. Route components are lazy-loaded from hashed chunk
// files, so after the server ships a new web build a page still running the old
// index.html requests chunk files that no longer exist. The dynamic import
// rejects and navigation silently dies — the current view (and non-navigating
// buttons like Edit/Close) keep working, but every nav button/link looks dead
// until a manual refresh. Detect that failure and reload once to pull the fresh
// index + chunks, landing on the intended route. A short cooldown avoids a
// reload loop if the assets are genuinely broken rather than just stale.
router.onError((err, to) => {
  const msg = String((err as { message?: string } | undefined)?.message ?? err);
  const staleChunk =
    /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(msg);
  if (!staleChunk || typeof window === 'undefined') return;
  let last = 0;
  try { last = Number(sessionStorage.getItem('zt:chunkReload') ?? '0'); } catch { /* private mode */ }
  if (Date.now() - last < 10_000) return; // already reloaded very recently — don't loop
  try { sessionStorage.setItem('zt:chunkReload', String(Date.now())); } catch { /* ignore */ }
  if (to?.fullPath) window.location.hash = to.fullPath;
  window.location.reload();
});
