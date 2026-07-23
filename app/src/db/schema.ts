import Dexie, { type EntityTable } from 'dexie';
import type {
  DiscountRule,
  EventStock,
  Op,
  Product,
  SalesEvent,
  Transaction,
} from '@zolltool/shared';

export interface ImageRec {
  id: string;
  productId: string;
  full: Blob;
  thumb: Blob;
  updatedAt: number;
}

/** Outbox entry: op + local sequencing/sync bookkeeping. */
export interface OutboxOp extends Op {
  seq?: number;
  /** 0 = not yet pushed, 1 = acknowledged by server. */
  synced: 0 | 1;
}

export interface SettingRow {
  key: string;
  value: unknown;
  /** Set only for settings synced across devices (see setSyncedSetting) — LWW conflict resolution. */
  updatedAt?: number;
}

export const db = new Dexie('zolltool_v2') as Dexie & {
  events: EntityTable<SalesEvent, 'id'>;
  products: EntityTable<Product, 'id'>;
  eventStock: Dexie.Table<EventStock, [string, string, string]>;
  transactions: EntityTable<Transaction, 'id'>;
  discounts: EntityTable<DiscountRule, 'id'>;
  images: EntityTable<ImageRec, 'id'>;
  ops: Dexie.Table<OutboxOp, number>;
  settings: Dexie.Table<SettingRow, string>;
};

db.version(1).stores({
  events: 'id, status, updatedAt',
  products: 'id, sku, updatedAt, sortOrder',
  // variantId is '' (not null) inside the compound key — IndexedDB cannot index null
  eventStock: '[eventId+productId+variantId], eventId',
  transactions: 'id, eventId, timestamp, [eventId+timestamp]',
  discounts: 'id, updatedAt',
  images: 'id, productId',
  ops: '++seq, opId, synced',
  settings: 'key',
});
