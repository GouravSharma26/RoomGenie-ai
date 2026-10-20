import { describe, it, expect } from 'vitest';
import { 
  AUTHORITATIVE_CATALOGUE_IDS, 
  CATALOGUE_ID_ALIASES, 
  resolveCatalogueAssetId,
  isCatalogueAssetMapped 
} from './catalogueMapping';
import { SAMPLE_CATALOG } from './catalog';

describe('Authoritative Catalogue ID Mappings', () => {
  it('ensures every authoritative catalogue ID exists in SAMPLE_CATALOG', () => {
    const catalogIds = new Set(SAMPLE_CATALOG.map((item) => item.id));
    for (const authId of AUTHORITATIVE_CATALOGUE_IDS) {
      expect(catalogIds.has(authId)).toBe(true);
      expect(resolveCatalogueAssetId(authId)).toBe(authId);
      expect(isCatalogueAssetMapped(authId)).toBe(true);
    }
  });

  it('ensures every alias in CATALOGUE_ID_ALIASES maps to a valid SAMPLE_CATALOG entry', () => {
    const catalogIds = new Set(SAMPLE_CATALOG.map((item) => item.id));
    for (const [alias, canonicalId] of Object.entries(CATALOGUE_ID_ALIASES)) {
      expect(catalogIds.has(canonicalId)).toBe(true);
      const resolved = resolveCatalogueAssetId(alias);
      expect(resolved).toBe(canonicalId);
      expect(isCatalogueAssetMapped(alias)).toBe(true);
    }
  });

  it('correctly maps specific backend and vision aliases', () => {
    expect(resolveCatalogueAssetId('sofa-3seater-fabric')).toBe('sofa-modern-3seater');
    expect(resolveCatalogueAssetId('table-coffee-round')).toBe('table-oak-coffee');
    expect(resolveCatalogueAssetId('bed-queen-wood')).toBe('bed-queen-platform');
    expect(resolveCatalogueAssetId('table-nightstand-minimal')).toBe('table-bedside-nightstand');
    expect(resolveCatalogueAssetId('table-desk-minimal')).toBe('desk-workspace-study');
    expect(resolveCatalogueAssetId('armchair-accent-nordic')).toBe('chair-accent-armchair');
    expect(resolveCatalogueAssetId('bookshelf-4tier-metal')).toBe('storage-bookshelf-tall');
  });

  it('returns null and false for unmapped or non-existent catalogue IDs', () => {
    expect(resolveCatalogueAssetId(null)).toBeNull();
    expect(resolveCatalogueAssetId(undefined)).toBeNull();
    expect(resolveCatalogueAssetId('')).toBeNull();
    expect(resolveCatalogueAssetId('   ')).toBeNull();
    expect(resolveCatalogueAssetId('fictional-futuristic-sofa-999')).toBeNull();
    expect(isCatalogueAssetMapped('fictional-futuristic-sofa-999')).toBe(false);
  });

  it('rejects inherited Object prototype properties and prevents prototype poisoning', () => {
    const dangerousKeys = [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      '__proto__',
    ];
    for (const key of dangerousKeys) {
      expect(resolveCatalogueAssetId(key)).toBeNull();
      expect(isCatalogueAssetMapped(key)).toBe(false);
    }
  });

  it('ensures distinct furniture types like table-dining-rect remain unmapped rather than mapped to study desk', () => {
    expect(resolveCatalogueAssetId('table-dining-rect')).toBeNull();
    expect(isCatalogueAssetMapped('table-dining-rect')).toBe(false);
  });
});
