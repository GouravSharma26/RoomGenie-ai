import { describe, it, expect } from 'vitest';
import type { CanonicalScene, FurniturePlacement } from '../../types/scene';
import { 
  attachSocket, 
  detachSocket, 
  updateRelationshipGap, 
  findCompatibleSockets, 
  transformGroup, 
  purgeInvalidRelationships,
  getDirectChildren,
  getParentRelationship,
  isDescendantOf
} from '../relationships/relationshipManager';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';

const createPlacementFromCatalog = (
  id: string,
  catalogId: string,
  position: [number, number, number] = [0, 0, 0],
  rotationEuler: [number, number, number] = [0, 0, 0]
): FurniturePlacement => {
  const item = SAMPLE_CATALOG.find((i) => i.id === catalogId);
  if (!item) throw new Error(`Catalog item not found: ${catalogId}`);
  return {
    id,
    assetId: item.id,
    name: item.name,
    dimensions: [...item.dimensions],
    position: [position[0], item.dimensions[1] / 2, position[2]],
    rotationEuler: [...rotationEuler],
    scale: [1, 1, 1],
  };
};

const createBaseScene = (objects: FurniturePlacement[] = []): CanonicalScene => ({
  schemaVersion: 1,
  unit: 'm',
  room: { width: 8.0, length: 8.0, height: 2.8 },
  objects,
  relationships: [],
});

const CATEGORY_LOOKUP: Record<string, string> = {
  'sofa-modern-3seater': 'seating',
  'chair-accent-armchair': 'seating',
  'table-oak-coffee': 'tables',
  'bed-queen-platform': 'beds',
  'table-bedside-nightstand': 'tables',
  'desk-workspace-study': 'tables',
  'storage-wardrobe-compact': 'storage',
};

describe('RelationshipManager (Phase 3.2)', () => {
  it('successfully attaches coffee table to sofa front socket at recommended gap', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater', [0, 0, 0]);
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee', [2, 0, 2]);
    const scene = createBaseScene([sofa, table]);

    const result = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });

    expect(result.success).toBe(true);
    expect(result.relationship).toBeDefined();
    expect(result.relationship?.anchorObjectId).toBe('sofa-1');
    expect(result.relationship?.childObjectId).toBe('table-1');
    expect(result.relationship?.socketId).toBe('sofa-front-table');
    expect(result.relationship?.gap).toBe(0.45); // recommended gap

    // Check updated child position
    const updatedTable = result.updatedScene.objects.find((f) => f.id === 'table-1')!;
    // Sofa facing default [0, 0, 0], front normal is +Z. Table should be placed in front of sofa (+Z)
    expect(updatedTable.position[0]).toBeCloseTo(0, 2);
    expect(updatedTable.position[2]).toBeGreaterThan(sofa.dimensions[2] / 2);
    expect(result.updatedScene.relationships?.length).toBe(1);
  });

  it('clamps user-requested gap within socket bounds [minGap, maxGap]', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table]);

    // Request gap of 0.10m, but sofa-front-table minGap is 0.30m
    const resultTooSmall = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      gap: 0.10,
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(resultTooSmall.success).toBe(true);
    expect(resultTooSmall.relationship?.gap).toBe(0.30);

    // Request gap of 2.0m, but sofa-front-table maxGap is 0.70m
    const resultTooLarge = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      gap: 2.0,
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(resultTooLarge.success).toBe(true);
    expect(resultTooLarge.relationship?.gap).toBe(0.70);
  });

  it('attaches nightstand beside bed with lateral headboard alignment', () => {
    const bed = createPlacementFromCatalog('bed-1', 'bed-queen-platform', [0, 0, 0]);
    const nightstand = createPlacementFromCatalog('ns-left', 'table-bedside-nightstand', [3, 0, 3]);
    const scene = createBaseScene([bed, nightstand]);

    const result = attachSocket(scene, 'bed-1', 'bed-left-nightstand', 'ns-left', {
      gap: 0.08,
      categoryLookup: CATEGORY_LOOKUP,
    });

    expect(result.success).toBe(true);
    const updatedNs = result.updatedScene.objects.find((f) => f.id === 'ns-left')!;
    // Left socket has normal [-1, 0, 0] (negative X)
    expect(updatedNs.position[0]).toBeLessThan(0);
    // Bed depth is 2.1m, headboard is at -Z face; nightstand lateralRatio is aligned with headboard
    expect(updatedNs.position[2]).toBeLessThan(0);
  });

  it('rejects self-attachment', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const scene = createBaseScene([sofa]);

    const result = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'sofa-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot attach to itself');
  });

  it('rejects cycle attachment when target child is already an ancestor of the anchor', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table]);

    // Attach table to sofa
    const attached = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(attached.success).toBe(true);

    // Attempt to attach sofa to table (cycle)
    const cycleResult = attachSocket(attached.updatedScene, 'table-1', 'sofa-front-table', 'sofa-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(cycleResult.success).toBe(false);
    expect(cycleResult.error).toContain('Cycle detected');
  });

  it('rejects incompatible items for a socket', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const wardrobe = createPlacementFromCatalog('wardrobe-1', 'storage-wardrobe-compact');
    const scene = createBaseScene([sofa, wardrobe]);

    const result = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'wardrobe-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not compatible');
  });

  it('rejects attachment if socket is already occupied by another child', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table1 = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const table2 = createPlacementFromCatalog('table-2', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table1, table2]);

    const res1 = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(res1.success).toBe(true);

    const res2 = attachSocket(res1.updatedScene, 'sofa-1', 'sofa-front-table', 'table-2', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('already occupied');
  });

  it('rejects attachment when resulting position breaches room boundaries', () => {
    // Place sofa right at the front boundary +Z = 3.6m in an 8x8 room (boundary is +4.0m)
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater', [0, 0, 3.6]);
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee', [0, 0, 0]);
    const scene = createBaseScene([sofa, table]);

    // Attaching front table would push table past +Z = 4.0m boundary
    const result = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      gap: 0.60,
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(result.success).toBe(false);
    expect(result.violations?.length).toBeGreaterThan(0);
    expect(result.violations?.[0]).toContain('room boundaries');
  });

  it('rejects attachment when resulting position collides with an existing obstacle', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater', [0, 0, 0]);
    // Obstacle wardrobe right in front of sofa where coffee table would be placed
    const obstacle = createPlacementFromCatalog('obstacle-1', 'storage-wardrobe-compact', [0, 0, 1.2]);
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee', [3, 0, 3]);
    const scene = createBaseScene([sofa, obstacle, table]);

    const result = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(result.success).toBe(false);
    expect(result.violations?.some((v) => v.includes('Collides with other furniture'))).toBe(true);
  });

  it('detaches child preserving child world transform', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table]);

    const attached = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(attached.success).toBe(true);

    const posBefore = attached.childPlacement!.position;
    const detachedScene = detachSocket(attached.updatedScene, 'table-1');

    expect(detachedScene.relationships?.length).toBe(0);
    const tableAfter = detachedScene.objects.find((f) => f.id === 'table-1')!;
    expect(tableAfter.position).toEqual(posBefore);
  });

  it('updates relationship gap dynamically and repositions child', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table]);

    const attached = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      gap: 0.40,
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(attached.success).toBe(true);

    const pos1Z = attached.childPlacement!.position[2];

    const updated = updateRelationshipGap(attached.updatedScene, 'table-1', 0.65, {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(updated.success).toBe(true);
    expect(updated.newGap).toBe(0.65);
    expect(updated.childPlacement!.position[2]).toBeGreaterThan(pos1Z);

    const rel = getParentRelationship(updated.updatedScene, 'table-1');
    expect(rel?.gap).toBe(0.65);
  });

  it('finds compatible sockets within search radius and sorts by distance', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater', [0, 0, 0]);
    // Place table 0.9m in front of sofa
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee', [0, 0, 1.2]);
    const scene = createBaseScene([sofa, table]);

    const candidates = findCompatibleSockets(scene, table, {
      searchRadius: 2.0,
      categoryLookup: CATEGORY_LOOKUP,
    });

    expect(candidates.length).toBeGreaterThan(0);
    const topCandidate = candidates[0];
    expect(topCandidate.socket.id).toBe('sofa-front-table');
    expect(topCandidate.anchorPlacement.id).toBe('sofa-1');
    expect(topCandidate.valid).toBe(true);
  });

  it('atomically moves group of anchor + attached children and rejects if any member violates bounds', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater', [0, 0, 0]);
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee', [0, 0, 1]);
    const scene = createBaseScene([sofa, table]);

    const attached = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(attached.success).toBe(true);

    // Move sofa to [1, 0, -1] with rotation [0, Math.PI / 2, 0]
    const groupMove = transformGroup(
      attached.updatedScene,
      'sofa-1',
      [1, sofa.position[1], -1],
      [0, Math.PI / 2, 0],
      { categoryLookup: CATEGORY_LOOKUP }
    );

    expect(groupMove.success).toBe(true);
    expect(groupMove.movedObjectIds).toContain('sofa-1');
    expect(groupMove.movedObjectIds).toContain('table-1');

    const movedSofa = groupMove.updatedScene.objects.find((f) => f.id === 'sofa-1')!;
    const movedTable = groupMove.updatedScene.objects.find((f) => f.id === 'table-1')!;

    expect(movedSofa.position[0]).toBe(1);
    expect(movedSofa.position[2]).toBe(-1);
    expect(movedTable.rotationEuler[1]).toBeCloseTo(Math.PI / 2, 2);

    // Try moving sofa so close to wall that child table would be outside
    const invalidGroupMove = transformGroup(
      attached.updatedScene,
      'sofa-1',
      [0, sofa.position[1], 3.7],
      [0, 0, 0],
      { categoryLookup: CATEGORY_LOOKUP }
    );
    expect(invalidGroupMove.success).toBe(false);
    expect(invalidGroupMove.violations.length).toBeGreaterThan(0);
  });

  it('purges invalid relationships when anchor or child is deleted', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table]);

    const attached = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });
    expect(attached.updatedScene.relationships?.length).toBe(1);

    // Simulate deleting table from scene.objects
    const sceneWithoutTable: CanonicalScene = {
      ...attached.updatedScene,
      objects: [sofa],
    };

    const purged = purgeInvalidRelationships(sceneWithoutTable);
    expect(purged.purgedCount).toBe(1);
    expect(purged.scene.relationships?.length).toBe(0);
  });

  it('correctly reports helper hierarchy functions', () => {
    const sofa = createPlacementFromCatalog('sofa-1', 'sofa-modern-3seater');
    const table = createPlacementFromCatalog('table-1', 'table-oak-coffee');
    const scene = createBaseScene([sofa, table]);

    const attached = attachSocket(scene, 'sofa-1', 'sofa-front-table', 'table-1', {
      categoryLookup: CATEGORY_LOOKUP,
    });

    expect(getDirectChildren(attached.updatedScene, 'sofa-1').length).toBe(1);
    expect(getParentRelationship(attached.updatedScene, 'table-1')?.anchorObjectId).toBe('sofa-1');
    expect(isDescendantOf(attached.updatedScene, 'table-1', 'sofa-1')).toBe(true);
    expect(isDescendantOf(attached.updatedScene, 'sofa-1', 'table-1')).toBe(false);
  });
});
