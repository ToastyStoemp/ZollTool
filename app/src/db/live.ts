import { liveQuery } from 'dexie';
import { ref, type Ref } from 'vue';

/**
 * Wrap a Dexie liveQuery in a Vue ref. The subscription lives for the app's
 * lifetime — intended for use inside Pinia stores, not per-component setup.
 */
export function useLive<T>(querier: () => Promise<T> | T, initial: T): Ref<T> {
  const value = ref(initial) as Ref<T>;
  liveQuery(querier).subscribe({
    next: (v) => {
      value.value = v;
    },
    error: (err) => console.error('liveQuery error', err),
  });
  return value;
}
