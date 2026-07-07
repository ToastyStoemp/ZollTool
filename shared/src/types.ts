/** Data model v2 — shared between app and server. Grows in Phase 1/3. */

export type EventStatus = 'planned' | 'active' | 'closed';

export interface Venue {
  street?: string;
  postcode?: string;
  city?: string;
  country?: string;
  tin?: string;
}

export interface SalesEvent {
  id: string;
  name: string;
  dateStart?: string;
  dateEnd?: string;
  venue: Venue;
  currency: string;
  status: EventStatus;
  /** Per-event customs state (edec, form1174) — ported in Phase 6. */
  customs?: Record<string, unknown>;
  updatedAt: number;
  deletedAt?: number;
}

export interface Variant {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  weightG?: number;
  unlisted?: boolean;
}

export interface Product {
  id: string;
  title: string;
  sku?: string;
  type?: string;
  forSale: boolean;
  unlisted: boolean;
  price: number;
  priceNote?: string;
  weightG?: number;
  tariffNo?: string;
  tariffRate?: number;
  vatRate?: number;
  packagingType?: string;
  originCountry?: string;
  /** Customs: overrides the HS-code-derived permit obligation in the e-dec XML. */
  permitOverride?: number;
  variants: Variant[];
  imageId?: string;
  sortOrder: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface EventStock {
  eventId: string;
  productId: string;
  /** Variant id, or '' for the product itself (IndexedDB compound keys cannot hold null). */
  variantId: string;
  broughtQty: number;
  updatedAt: number;
}

export type DiscountType = 'bxgy' | 'nth_pct' | 'tiered';

export interface DiscountTier {
  qty: number;
  total: number;
}

export interface DiscountRule {
  id: string;
  name: string;
  type: DiscountType;
  /** Products the rule applies to (all their variants included). */
  productIds: string[];
  /** Specific variants, as "productId:variantId" keys. */
  variantIds: string[];
  buyQty?: number;
  freeQty?: number;
  nth?: number;
  percent?: number;
  tiers?: DiscountTier[];
  tierContinue?: boolean;
  updatedAt: number;
  deletedAt?: number;
}

export type PaymentMethod = 'cash' | 'card' | 'split';

export interface PaymentLeg {
  kind: 'cash' | 'card';
  amount: number;
  provider?: string;
  txRef?: string;
  cardBrand?: string;
  authCode?: string;
}

export interface TxItem {
  pid: string;
  vid: string | null;
  title: string;
  variantLabel?: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface TxDiscount {
  id?: string;
  name: string;
  amount: number;
  custom?: boolean;
}

export interface Transaction {
  id: string;
  eventId: string;
  deviceId: string;
  timestamp: number;
  method: PaymentMethod;
  payments: PaymentLeg[];
  items: TxItem[];
  discounts: TxDiscount[];
  total: number;
  currency: string;
  /** Op id of the revert that cancelled this transaction, if any. */
  revertedBy?: string;
  revertedAt?: number;
}
