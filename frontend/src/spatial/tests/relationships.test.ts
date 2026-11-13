import { describe, it, expect } from 'vitest';
import type { FurniturePlacement } from '../../types/scene';
import { 
  defaultSocketRegistry,
  computeChildTransformFromSocket,
  computeSocketFromWorldTransform,
  type SpatialSocketDefinition
} from '../index';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';

const createPlacementFromCatalog = (
  catalogId: string,
  overrides: Partial<FurniturePlacement> = {}
): FurniturePlacement => {
  const item = SAMPLE_CATALOG.find((i) => i.id === catalogId);
  if (!item) throw new Error(`Catalog item not found: ${catalogId}`);
  return {
    id: `placement-${catalogId}`,
    assetId: item.id,
    name: item.name,
    dimensions: [...item.dimensions],
    position: [0, item.dimensions[1] / 2, 0],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
};

describe('Milestone 3 — Phase 3.1: Semantic Relationships & Spatial Sockets Foundation', () => {
  describe('Socket Registry & Semantic Compatibility', () => {
    it('provides declarative sockets for supported furniture catalog items', () => {
      // 1. Sofa has front coffee table and left/right accent chair sockets
      const sofaSockets = defaultSocketRegistry.getSocketsForAsset('sofa-modern-3seater', 'seating');
      expect(sofaSockets).toHaveLength(3);
      expect(sofaSockets.map((s) => s.id)).toEqual(
        expect.arrayContaining(['sofa-front-table', 'sofa-left-accent', 'sofa-right-accent'])
      );

      // 2. Bed has left and right bedside nightstand sockets
      const bedSockets = defaultSocketRegistry.getSocketsForAsset('bed-queen-platform', 'beds');
      expect(bedSockets).toHaveLength(2);
      expect(bedSockets.map((s) => s.id)).toEqual(
        expect.arrayContaining(['bed-left-nightstand', 'bed-right-nightstand'])
      );

      // 3. Desk has knee-well chair socket
      const deskSockets = defaultSocketRegistry.getSocketsForAsset('desk-workspace-study', 'tables');
      expect(deskSockets).toHaveLength(1);
      expect(deskSockets[0].id).toBe('desk-knee-well-chair');
    });

    it('returns empty array for unsupported furniture assets (no fabricated sockets)', () => {
      // Floor vase planter has no anchor sockets
      const planterSockets = defaultSocketRegistry.getSocketsForAsset('decor-plant-floor-vase', 'decor');
      expect(planterSockets).toHaveLength(0);

      // Bookshelf has no anchor sockets
      const shelfSockets = defaultSocketRegistry.getSocketsForAsset('storage-bookshelf-tall', 'storage');
      expect(shelfSockets).toHaveLength(0);

      // Slatted screen partition has no anchor sockets
      const dividerSockets = defaultSocketRegistry.getSocketsForAsset('decor-divider-architectural', 'decor');
      expect(dividerSockets).toHaveLength(0);
    });

    it('correctly validates semantic category and style tag compatibility', () => {
      const sofaFrontTable = defaultSocketRegistry.getSocketDefinition('sofa-front-table')!;
      expect(sofaFrontTable).toBeDefined();

      // Coffee table is compatible ('tables' + 'living-room')
      expect(
        defaultSocketRegistry.isCompatibleWithSocket(sofaFrontTable, 'tables', ['living-room', 'scandinavian'])
      ).toBe(true);

      // Nightstand is 'tables', but lacks 'living-room' tag -> not compatible
      expect(
        defaultSocketRegistry.isCompatibleWithSocket(sofaFrontTable, 'tables', ['bedroom'])
      ).toBe(false);

      // Bed is completely incompatible ('beds' !== 'tables')
      expect(
        defaultSocketRegistry.isCompatibleWithSocket(sofaFrontTable, 'beds', ['bedroom'])
      ).toBe(false);

      // Bedside nightstand socket accepts bedroom nightstand
      const bedNightstand = defaultSocketRegistry.getSocketDefinition('bed-left-nightstand')!;
      expect(
        defaultSocketRegistry.isCompatibleWithSocket(bedNightstand, 'tables', ['bedroom', 'scandinavian'])
      ).toBe(true);

      // Desk knee-well socket accepts task / armchair
      const deskChair = defaultSocketRegistry.getSocketDefinition('desk-knee-well-chair')!;
      expect(
        defaultSocketRegistry.isCompatibleWithSocket(deskChair, 'seating', ['workspace'])
      ).toBe(true);
    });
  });

  describe('Local-to-World Transform Mathematics', () => {
    it('computes surface contact point and applies gap strictly once (zero double-spacing)', () => {
      // Sofa: width=2.1, height=0.85, depth=0.9
      // Placed at world origin [0, 0.425, 0], yaw=0
      const sofa = createPlacementFromCatalog('sofa-modern-3seater', { position: [0, 0.425, 0] });
      const socket = defaultSocketRegistry.getSocketDefinition('sofa-front-table')!;

      // Coffee Table: width=1.2, height=0.45, depth=0.6
      const tableCatalog = SAMPLE_CATALOG.find((i) => i.id === 'table-oak-coffee')!;
      const desiredGap = 0.45; // 45cm physical gap

      const result = computeChildTransformFromSocket(
        sofa,
        tableCatalog.dimensions,
        [1, 1, 1],
        socket,
        desiredGap
      );

      // 1. Sofa front surface is at Z = depth/2 = 0.9 / 2 = 0.45m
      expect(result.anchorSurfacePoint[2]).toBeCloseTo(0.45, 3);
      expect(result.anchorSurfacePoint[0]).toBeCloseTo(0.0, 3);

      // 2. Child contact point (table back edge) must sit exactly desiredGap (0.45m) in front of sofa
      // Expected contact point Z = 0.45 + 0.45 = 0.90m
      expect(result.childContactPoint[2]).toBeCloseTo(0.90, 3);

      // 3. Child center: halfDepth of table is 0.6 / 2 = 0.30m
      // Center Z = contact point + halfDepth = 0.90 + 0.30 = 1.20m
      expect(result.position[2]).toBeCloseTo(1.20, 3);
      expect(result.position[0]).toBeCloseTo(0.0, 3);

      // 4. Grounding height: table height is 0.45m -> grounded Y = 0.45 / 2 = 0.225m
      expect(result.position[1]).toBeCloseTo(0.225, 3);

      // 5. Measured surface gap is exactly 0.45m
      expect(result.effectiveGap).toBeCloseTo(0.45, 3);
    });

    it('clamps gap to defined socket bounds [minGap, maxGap]', () => {
      const sofa = createPlacementFromCatalog('sofa-modern-3seater');
      const socket = defaultSocketRegistry.getSocketDefinition('sofa-front-table')!;
      const tableDims = SAMPLE_CATALOG.find((i) => i.id === 'table-oak-coffee')!.dimensions;

      // Min gap for sofa-front-table is 0.30m
      const tooClose = computeChildTransformFromSocket(sofa, tableDims, [1, 1, 1], socket, 0.10);
      expect(tooClose.effectiveGap).toBe(0.30);

      // Max gap is 0.70m
      const tooFar = computeChildTransformFromSocket(sofa, tableDims, [1, 1, 1], socket, 1.20);
      expect(tooFar.effectiveGap).toBe(0.70);
    });

    it('computes correct deterministic child rotation for facing modes', () => {
      const sofa = createPlacementFromCatalog('sofa-modern-3seater', {
        rotationEuler: [0, 0, 0], // Yaw = 0 (pointing +Z)
      });

      // 1. 'same-direction': Coffee table faces same direction as sofa
      const tableSocket = defaultSocketRegistry.getSocketDefinition('sofa-front-table')!;
      const tableResult = computeChildTransformFromSocket(
        sofa,
        [1.2, 0.45, 0.6],
        [1, 1, 1],
        tableSocket
      );
      expect(tableResult.rotationEuler[1]).toBeCloseTo(0, 3);

      // 2. 'face-anchor': Chair facing desk
      const desk = createPlacementFromCatalog('desk-workspace-study', { rotationEuler: [0, 0, 0] });
      const deskChairSocket = defaultSocketRegistry.getSocketDefinition('desk-knee-well-chair')!;
      const chairResult = computeChildTransformFromSocket(
        desk,
        [0.6, 0.8, 0.6],
        [1, 1, 1],
        deskChairSocket
      );
      // Front face (+Z) with 'face-anchor' mode turns 180 degrees (Math.PI) to face back at the desk
      expect(chairResult.rotationEuler[1]).toBeCloseTo(Math.PI, 3);

      // 3. Accent chair facing sofa with 45 degree conversation angle
      const leftAccentSocket = defaultSocketRegistry.getSocketDefinition('sofa-left-accent')!;
      const leftChairResult = computeChildTransformFromSocket(
        sofa,
        [0.85, 0.88, 0.85],
        [1, 1, 1],
        leftAccentSocket
      );
      // Left side (-X) faces right (+X = PI/2) with baseRelativeYaw +PI/4 -> 3PI/4 (135 deg / 2.3562 rad)
      expect(leftChairResult.rotationEuler[1]).toBeCloseTo((3 * Math.PI) / 4, 3);

      // 4. 'perpendicular-left' and 'perpendicular-right' modes
      const perpLeftDef: SpatialSocketDefinition = {
        ...tableSocket,
        id: 'test-perp-left',
        facingMode: 'perpendicular-left',
        baseRelativeYaw: 0,
      };
      const perpLeftResult = computeChildTransformFromSocket(sofa, [1, 1, 1], [1, 1, 1], perpLeftDef);
      expect(perpLeftResult.rotationEuler[1]).toBeCloseTo(Math.PI / 2, 3);

      const perpRightDef: SpatialSocketDefinition = {
        ...tableSocket,
        id: 'test-perp-right',
        facingMode: 'perpendicular-right',
        baseRelativeYaw: 0,
      };
      const perpRightResult = computeChildTransformFromSocket(sofa, [1, 1, 1], [1, 1, 1], perpRightDef);
      expect(perpRightResult.rotationEuler[1]).toBeCloseTo(-Math.PI / 2, 3);
    });

    it('correctly rotates child in world space when anchor is rotated (yaw rotation)', () => {
      // Rotate sofa by 90 degrees (Math.PI / 2) around Y
      const rotatedSofa = createPlacementFromCatalog('sofa-modern-3seater', {
        position: [2.0, 0.425, -1.0],
        rotationEuler: [0, Math.PI / 2, 0],
      });
      const socket = defaultSocketRegistry.getSocketDefinition('sofa-front-table')!;
      const tableDims = [1.2, 0.45, 0.6] as [number, number, number];

      const result = computeChildTransformFromSocket(rotatedSofa, tableDims, [1, 1, 1], socket, 0.45);

      // With sofa at 90 deg yaw, front (+Z in local) points toward +X in world!
      // Sofa front edge in local is +0.45m. In world, offset along X is 0.45 + 0.45 + 0.30 = 1.20m!
      // World child center X = 2.0 + 1.20 = 3.20m
      // World child center Z = -1.0
      expect(result.position[0]).toBeCloseTo(3.20, 2);
      expect(result.position[2]).toBeCloseTo(-1.0, 2);
      // Table yaw matches sofa yaw (90 deg)
      expect(result.rotationEuler[1]).toBeCloseTo(Math.PI / 2, 3);
    });

    it('accounts for non-uniform scale on both anchor and child', () => {
      // Bed scaled 1.5x in width: original width 1.65 -> scaled 2.475m (halfX = 1.2375m)
      const scaledBed = createPlacementFromCatalog('bed-queen-platform', {
        scale: [1.5, 1.0, 1.0],
      });
      const leftNightstandSocket = defaultSocketRegistry.getSocketDefinition('bed-left-nightstand')!;
      
      // Nightstand scaled 1.2x: width 0.45 -> 0.54m (halfWidth = 0.27m)
      const nightstandDims = [0.45, 0.5, 0.4] as [number, number, number];
      const nightstandScale = [1.2, 1.0, 1.0] as [number, number, number];
      const gap = 0.08;

      const result = computeChildTransformFromSocket(
        scaledBed,
        nightstandDims,
        nightstandScale,
        leftNightstandSocket,
        gap
      );

      // Anchor surface at left is -halfX = -1.2375m
      expect(result.anchorSurfacePoint[0]).toBeCloseTo(-1.2375, 3);
      // Child center = -1.2375 - (0.08 + 0.27) = -1.5875m
      expect(result.position[0]).toBeCloseTo(-1.5875, 3);
    });
  });

  describe('Transform Invertibility (World-to-Socket Round-Trip)', () => {
    it('accurately recovers gap and relative yaw from world placement coordinates', () => {
      const sofa = createPlacementFromCatalog('sofa-modern-3seater', {
        position: [-1.2, 0.425, 0.8],
        rotationEuler: [0, 0.65, 0], // arbitrary yaw angle ~37.2 deg
      });
      const socket = defaultSocketRegistry.getSocketDefinition('sofa-front-table')!;
      const tableDims = [1.2, 0.45, 0.6] as [number, number, number];

      const inputGap = 0.52;
      const inputRelativeYaw = 0.12;

      // 1. Forward transform: Local socket -> World child transform
      const forwardResult = computeChildTransformFromSocket(
        sofa,
        tableDims,
        [1, 1, 1],
        socket,
        inputGap,
        inputRelativeYaw
      );

      const placedTable: FurniturePlacement = {
        id: 'child-table',
        assetId: 'table-oak-coffee',
        name: 'Coffee Table',
        dimensions: tableDims,
        position: forwardResult.position,
        rotationEuler: forwardResult.rotationEuler,
        scale: [1, 1, 1],
      };

      // 2. Inverse transform: World placements -> Socket gap and relative yaw
      const inverseResult = computeSocketFromWorldTransform(sofa, placedTable, socket);

      expect(inverseResult.measuredGap).toBeCloseTo(inputGap, 3);
      expect(inverseResult.relativeYaw).toBeCloseTo(inputRelativeYaw, 3);
      expect(inverseResult.isWithinTolerance).toBe(true);
    });

    it('performs exact round-trip for side-attached nightstand on bed', () => {
      const bed = createPlacementFromCatalog('bed-queen-platform', {
        position: [1.5, 0.475, -0.5],
        rotationEuler: [0, -Math.PI / 4, 0], // Bed angled at -45 deg
      });
      const socket = defaultSocketRegistry.getSocketDefinition('bed-left-nightstand')!;
      const nightstandDims = [0.45, 0.5, 0.4] as [number, number, number];
      const gap = 0.08;

      const forward = computeChildTransformFromSocket(bed, nightstandDims, [1, 1, 1], socket, gap, 0);

      const nightstand: FurniturePlacement = {
        id: 'child-nightstand',
        assetId: 'table-bedside-nightstand',
        name: 'Nightstand',
        dimensions: nightstandDims,
        position: forward.position,
        rotationEuler: forward.rotationEuler,
        scale: [1, 1, 1],
      };

      const inverse = computeSocketFromWorldTransform(bed, nightstand, socket);
      expect(inverse.measuredGap).toBeCloseTo(gap, 3);
      expect(inverse.relativeYaw).toBeCloseTo(0, 3);
      expect(inverse.isWithinTolerance).toBe(true);
    });

    it('performs exact round-trip for desk chair', () => {
      const desk = createPlacementFromCatalog('desk-workspace-study', {
        position: [-0.5, 0.375, 1.2],
        rotationEuler: [0, Math.PI, 0], // Desk rotated 180 deg
      });
      const socket = defaultSocketRegistry.getSocketDefinition('desk-knee-well-chair')!;
      const chairDims = [0.6, 0.8, 0.6] as [number, number, number];
      const gap = 0.25;

      const forward = computeChildTransformFromSocket(desk, chairDims, [1, 1, 1], socket, gap, 0.05);

      const chair: FurniturePlacement = {
        id: 'child-chair',
        assetId: 'chair-accent-armchair',
        name: 'Desk Chair',
        dimensions: chairDims,
        position: forward.position,
        rotationEuler: forward.rotationEuler,
        scale: [1, 1, 1],
      };

      const inverse = computeSocketFromWorldTransform(desk, chair, socket);
      expect(inverse.measuredGap).toBeCloseTo(gap, 3);
      expect(inverse.relativeYaw).toBeCloseTo(0.05, 3);
      expect(inverse.isWithinTolerance).toBe(true);
    });

    it('identifies when an object is outside valid socket tolerance', () => {
      const bed = createPlacementFromCatalog('bed-queen-platform', { position: [0, 0.475, 0] });
      const socket = defaultSocketRegistry.getSocketDefinition('bed-left-nightstand')!;

      // Nightstand placed 2.5m away (far outside nightstand maxGap of 0.35m)
      const farNightstand: FurniturePlacement = {
        id: 'far-table',
        assetId: 'table-bedside-nightstand',
        name: 'Nightstand',
        dimensions: [0.45, 0.5, 0.4],
        position: [-3.5, 0.25, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };

      const inverseResult = computeSocketFromWorldTransform(bed, farNightstand, socket);
      expect(inverseResult.isWithinTolerance).toBe(false);
      expect(inverseResult.measuredGap).toBeGreaterThan(socket.maxGap);
    });
  });
});
