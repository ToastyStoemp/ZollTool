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
    { path: '/catalog', name: 'catalog', component: () => import('@/views/CatalogView.vue') },
    { path: '/history', name: 'history', component: () => import('@/views/HistoryView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    // Customer display mode: mirrors another register's cart (Settings → This device)
    { path: '/display', name: 'display', component: () => import('@/views/DisplayView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue') },
  ],
});
