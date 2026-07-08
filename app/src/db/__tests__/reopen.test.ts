import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import type { SalesEvent } from '@zolltool/shared';
import { db } from '@/db/schema';
import { closeEvent, upsertEvent } from '@/db/repo';

describe('event reopen flow', () => {
  it('close then reopen through a reactive proxy (template path)', async () => {
    const event: SalesEvent = {
      id: 'ev-1',
      name: 'Test Con',
      venue: { city: 'Basel' },
      currency: 'CHF',
      status: 'active',
      updatedAt: Date.now() - 1000,
    };
    await upsertEvent(event);
    await closeEvent('ev-1');
    expect((await db.events.get('ev-1'))?.status).toBe('closed');

    // Simulate what EventsView does: the event object comes out of a Pinia
    // store (deep reactive proxy) and is spread into upsertEvent.
    const fromStore = reactive((await db.events.get('ev-1'))!);
    await upsertEvent({ ...fromStore, status: 'active', updatedAt: Date.now() });

    expect((await db.events.get('ev-1'))?.status).toBe('active');
  });
});
