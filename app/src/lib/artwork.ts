/**
 * Art prints are detected by their catalog Type ("Art Print"). They carry an
 * extra "year produced" field, and customs documents list them by title + year
 * (art prints have no SKU) instead of a SKU. Matches "Art Print" / "art prints"
 * / "ArtPrint", case-insensitively.
 */
export const isArtwork = (type?: string | null): boolean => /^art\s*prints?$/i.test((type ?? '').trim());
