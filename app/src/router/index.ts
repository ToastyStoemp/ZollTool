import { createRouter, createWebHashHistory } from 'vue-router';

// Hash history: works identically on file://-like Capacitor WebViews,
// GitHub Pages subpaths, and the dev server — no server rewrites needed.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/pos' },
    { path: '/pos', name: 'pos', component: () => import('@/views/PosView.vue') },
    { path: '/events', name: 'events', component: () => import('@/views/EventsView.vue') },
    { path: '/catalog', name: 'catalog', component: () => import('@/views/CatalogView.vue') },
    { path: '/history', name: 'history', component: () => import('@/views/HistoryView.vue') },
    { path: '/customs', name: 'customs', component: () => import('@/views/CustomsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue') },
  ],
});
