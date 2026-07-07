import { reactive } from 'vue';

export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

let nextId = 1;
export const toasts = reactive<Toast[]>([]);

export function showToast(message: string, kind: Toast['kind'] = 'info'): void {
  const toast: Toast = { id: nextId++, message, kind };
  toasts.push(toast);
  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === toast.id);
    if (idx !== -1) toasts.splice(idx, 1);
  }, 3000);
}
