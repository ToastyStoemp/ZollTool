import type { Product } from '@zolltool/shared';

export interface SearchMatch {
  productId: string;
  variantId: string | null;
  label: string;
}

export type SearchResult = SearchMatch | { ambiguous: true; count: number } | null;

function norm(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

function searchText(p: Product, v?: Product['variants'][number]): string {
  return [p.title, p.sku, p.type, v?.name, v?.sku].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Port of pos.html findPosSearchMatch(): exact SKU/title/variant matches win,
 * otherwise a unique partial match; multiple partials report ambiguity.
 */
export function findSearchMatch(products: Product[], query: string): SearchResult {
  const needle = norm(query);
  if (!needle) return null;
  const partial: SearchMatch[] = [];

  for (const p of products) {
    if (p.forSale === false) continue;
    const productLabel = p.title || '(untitled)';
    const productTitle = norm(p.title);
    const productSku = norm(p.sku);

    if (productSku && productSku === needle) return { productId: p.id, variantId: null, label: productLabel };
    if (productTitle && productTitle === needle) return { productId: p.id, variantId: null, label: productLabel };

    for (const v of p.variants) {
      const variantLabel = `${productLabel} - ${v.name || v.sku || 'variant'}`;
      const variantName = norm(v.name);
      const variantSku = norm(v.sku);
      const combinedName = norm(`${p.title || ''} ${v.name || ''}`);

      if (variantSku && variantSku === needle) return { productId: p.id, variantId: v.id, label: variantLabel };
      if (variantName && variantName === needle) return { productId: p.id, variantId: v.id, label: variantLabel };
      if (combinedName && combinedName === needle) return { productId: p.id, variantId: v.id, label: variantLabel };

      if (searchText(p, v).includes(needle)) {
        partial.push({ productId: p.id, variantId: v.id, label: variantLabel });
      }
    }

    if (searchText(p).includes(needle)) {
      partial.push({ productId: p.id, variantId: null, label: productLabel });
    }
  }

  const unique: SearchMatch[] = [];
  const seen = new Set<string>();
  for (const match of partial) {
    const key = `${match.productId}:${match.variantId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }

  if (unique.length === 1) return unique[0]!;
  if (unique.length > 1) return { ambiguous: true, count: unique.length };
  return null;
}

/** Stable accent color per product type. */
export function typeColor(type: string | undefined): string {
  if (!type) return '#34d399';
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 65% 55%)`;
}
