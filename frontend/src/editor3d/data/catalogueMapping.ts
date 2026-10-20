import { SAMPLE_CATALOG } from './catalog';

/**
 * Authoritative catalogue mapping between backend FurnitureAsset IDs,
 * vision model suggestions/aliases, and frontend SAMPLE_CATALOG IDs.
 */
export const AUTHORITATIVE_CATALOGUE_IDS = [
  'sofa-modern-3seater',
  'table-oak-coffee',
  'desk-workspace-study',
  'chair-accent-armchair',
  'storage-bookshelf-tall',
  'bed-queen-platform',
  'storage-wardrobe-compact',
  'table-bedside-nightstand',
  'decor-plant-floor-vase',
  'decor-divider-architectural',
] as const;

export type AuthoritativeCatalogueId = typeof AUTHORITATIVE_CATALOGUE_IDS[number];

/**
 * Known vision model alias and legacy slug mappings to canonical SAMPLE_CATALOG IDs.
 */
export const CATALOGUE_ID_ALIASES: Record<string, AuthoritativeCatalogueId> = {
  // Sofas
  'sofa-modern-3seater': 'sofa-modern-3seater',
  'sofa-3seater-fabric': 'sofa-modern-3seater',
  'sofa-3seater': 'sofa-modern-3seater',
  'sofa-fabric': 'sofa-modern-3seater',

  // Tables & Desks
  'table-oak-coffee': 'table-oak-coffee',
  'table-coffee-round': 'table-oak-coffee',
  'table-coffee': 'table-oak-coffee',
  'desk-workspace-study': 'desk-workspace-study',
  'table-desk-minimal': 'desk-workspace-study',
  'table-dining-rect': 'desk-workspace-study',
  'table-bedside-nightstand': 'table-bedside-nightstand',
  'table-nightstand-minimal': 'table-bedside-nightstand',

  // Seating
  'chair-accent-armchair': 'chair-accent-armchair',
  'armchair-accent-nordic': 'chair-accent-armchair',
  'armchair-modern': 'chair-accent-armchair',

  // Storage
  'storage-bookshelf-tall': 'storage-bookshelf-tall',
  'bookshelf-4tier-metal': 'storage-bookshelf-tall',
  'storage-wardrobe-compact': 'storage-wardrobe-compact',
  'wardrobe-compact': 'storage-wardrobe-compact',

  // Beds
  'bed-queen-platform': 'bed-queen-platform',
  'bed-queen-wood': 'bed-queen-platform',
  'bed-platform-wood': 'bed-queen-platform',
  'bed-queen-nordic-wood': 'bed-queen-platform',

  // Decor
  'decor-plant-floor-vase': 'decor-plant-floor-vase',
  'decor-divider-architectural': 'decor-divider-architectural',
};

/**
 * Resolves any raw suggestion ID or alias to a valid SAMPLE_CATALOG ID.
 * Returns null if the ID cannot be mapped to an active 3D model.
 */
export function resolveCatalogueAssetId(rawId: string | null | undefined): string | null {
  if (!rawId) return null;
  const trimmed = rawId.trim();

  // 1. Direct alias match
  if (CATALOGUE_ID_ALIASES[trimmed]) {
    return CATALOGUE_ID_ALIASES[trimmed];
  }

  // 2. Direct match in SAMPLE_CATALOG
  const directMatch = SAMPLE_CATALOG.find((cat) => cat.id === trimmed);
  if (directMatch) {
    return directMatch.id;
  }

  return null;
}

/**
 * Checks whether an asset ID maps to a valid 3D model in SAMPLE_CATALOG.
 */
export function isCatalogueAssetMapped(rawId: string | null | undefined): boolean {
  return resolveCatalogueAssetId(rawId) !== null;
}
