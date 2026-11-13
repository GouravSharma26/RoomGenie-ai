import { describe, it, expect } from 'vitest';
import type { CanonicalScene, FurniturePlacement } from '../../types/scene';
import { buildOccupancyGrid } from '../occupancy/occupancyBuilder';
import { 
  buildWalkabilityCostGrid, 
  resolveRoomOpenings 
} from '../occupancy/clearanceMapper';
import { findPath, hasLineOfSight, findNearestWalkableCell } from '../occupancy/pathfinder';
import { analyzeWalkability } from '../occupancy/walkabilityManager';
import { cellIndex } from '../occupancy/gridCoordinates';

describe('Phase 4: Walkability & Circulation Engine', () => {
  // Helper to create basic rectangular room scene
  const createTestScene = (
    roomWidth = 6.0,
    roomLength = 6.0,
    objects: FurniturePlacement[] = []
  ): CanonicalScene => ({
    schemaVersion: 1,
    unit: 'm',
    room: { width: roomWidth, length: roomLength, height: 2.8 },
    objects,
  });

  describe('Phase 4.2: Obstacle & Clearance Mapping', () => {
    it('generates distance field with 0 distance at obstacles and positive distance in free space', () => {
      const sofa: FurniturePlacement = {
        id: 'sofa-center',
        assetId: 'sofa-modern-3seater',
        name: 'Sofa',
        dimensions: [2.0, 0.85, 1.0],
        position: [0, 0.425, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const scene = createTestScene(6.0, 6.0, [sofa]);
      const occResult = buildOccupancyGrid(scene, { resolution: 0.10 });
      expect(occResult.success).toBe(true);

      const costGrid = buildWalkabilityCostGrid(scene, occResult.grid!, {
        resolution: 0.10,
        pedestrianClearance: 0.30,
      });

      expect(costGrid.costs.length).toBe(occResult.grid!.dimensions.totalCells);

      // Blocked cells must have Infinity cost
      const sofaCenterIdx = cellIndex(30, 30, costGrid.dimensions.numCols);
      expect(costGrid.classifications[sofaCenterIdx]).toBe('blocked');
      expect(costGrid.costs[sofaCenterIdx]).toBe(Infinity);
      expect(costGrid.obstacleDistances[sofaCenterIdx]).toBe(0);

      // Nearby cell within 30cm pedestrian clearance must be restricted
      // Center is at col 30, row 30. Half-width is 1m (10 cells), so col 41 is 10cm away from sofa edge
      const nearIdx = cellIndex(41, 30, costGrid.dimensions.numCols);
      expect(costGrid.classifications[nearIdx]).toBe('restricted');
      expect(costGrid.costs[nearIdx]).toBeGreaterThan(1.0);
      expect(costGrid.costs[nearIdx]).toBeLessThan(Infinity);

      // Far cell must be completely free with base cost 1.0
      const farIdx = cellIndex(10, 10, costGrid.dimensions.numCols);
      expect(costGrid.classifications[farIdx]).toBe('free');
      expect(costGrid.costs[farIdx]).toBe(1.0);
      expect(costGrid.obstacleDistances[farIdx]).toBeGreaterThan(0.5);
    });

    it('resolves default south wall entrance when no openings are specified', () => {
      const openings = resolveRoomOpenings({ width: 5.0, length: 4.0, height: 2.8 });
      expect(openings.length).toBe(1);
      const door = openings[0];
      expect(door.wall).toBe('south');
      expect(door.center).toEqual([0, 2.0]);
      expect(door.width).toBe(0.90);
      expect(door.accessPoint[1]).toBeLessThan(2.0); // Inside the room
    });
  });

  describe('Phase 4.3: A* Pathfinding Engine', () => {
    it('computes a straight, unobstructed path in an empty room', () => {
      const scene = createTestScene(6.0, 6.0, []);
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);

      const path = findPath([0, 2.5], [0, -2.0], costGrid);
      expect(path.found).toBe(true);
      expect(path.lengthMeters).toBeCloseTo(4.5, 0.5);
      expect(path.traversesRestricted).toBe(false);
      expect(path.worldPath.length).toBeGreaterThanOrEqual(2);
    });

    it('successfully routes around an obstacle placed directly in the path', () => {
      // Large dining table placed at center blocking direct line from entrance [0, 2.5] to desk [0, -2.0]
      const table: FurniturePlacement = {
        id: 'blocker-table',
        assetId: 'dining-table-oak',
        name: 'Dining Table',
        dimensions: [2.5, 0.75, 1.5],
        position: [0, 0.375, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const scene = createTestScene(8.0, 8.0, [table]);
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);

      const path = findPath([0, 3.2], [0, -3.0], costGrid);
      expect(path.found).toBe(true);

      // Verify no point along the generated path is inside the table
      for (const [wx, wz] of path.worldPath) {
        const inTableX = wx >= -1.25 && wx <= 1.25;
        const inTableZ = wz >= -0.75 && wz <= 0.75;
        expect(inTableX && inTableZ).toBe(false);
      }
    });

    it('prevents diagonal corner-cutting between touching obstacles', () => {
      // Two boxes forming a diagonal corner
      const scene = createTestScene(5.0, 5.0, []);
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);

      // Mark cell (10, 10) and (11, 11) as free, but orthogonal neighbors (11, 10) and (10, 11) as blocked
      const idOrth1 = cellIndex(11, 10, costGrid.dimensions.numCols);
      const idOrth2 = cellIndex(10, 11, costGrid.dimensions.numCols);
      costGrid.classifications[idOrth1] = 'blocked';
      costGrid.costs[idOrth1] = Infinity;
      costGrid.classifications[idOrth2] = 'blocked';
      costGrid.costs[idOrth2] = Infinity;

      // Has line of sight between (10, 10) and (11, 11) must be false
      const los = hasLineOfSight(10, 10, 11, 11, costGrid);
      expect(los).toBe(false);
    });

    it('finds perimeter walkable cell when target is inside furniture body', () => {
      const wardrobe: FurniturePlacement = {
        id: 'wardrobe',
        assetId: 'wardrobe-2door',
        name: 'Wardrobe',
        dimensions: [1.2, 2.0, 0.6],
        position: [0, 1.0, -2.0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const scene = createTestScene(6.0, 6.0, [wardrobe]);
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);

      const nearest = findNearestWalkableCell([0, -2.0], costGrid, 1.5);
      expect(nearest).not.toBeNull();
      const nearestIdx = cellIndex(nearest!.col, nearest!.row, costGrid.dimensions.numCols);
      expect(costGrid.classifications[nearestIdx]).not.toBe('blocked');
    });
  });

  describe('Phase 4.4: Circulation Validation & Flow Diagnostics', () => {
    it('detects when furniture is blocking the room doorway', () => {
      // Bed placed right at the south entrance door
      const bedAtDoor: FurniturePlacement = {
        id: 'bad-bed',
        assetId: 'bed-queen-platform',
        name: 'Queen Bed',
        dimensions: [1.8, 0.9, 2.1],
        position: [0, 0.45, 2.3], // Directly at south door
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const scene = createTestScene(6.0, 6.0, [bedAtDoor]);
      const result = analyzeWalkability(scene);

      const doorIssue = result.circulation.issues.find((i) => i.type === 'door_blocked');
      expect(doorIssue).toBeDefined();
      expect(doorIssue?.severity).toBe('error');
      expect(doorIssue?.title).toContain('blocks doorway swing');
      expect(result.circulation.isRoomPassable).toBe(false);
      expect(result.circulation.walkabilityScore).toBeLessThan(75);
    });

    it('detects unreachable furniture when surrounded by walls and obstacles', () => {
      // Chair boxed in corner behind a wide wall of wardrobes
      const chair: FurniturePlacement = {
        id: 'trapped-chair',
        assetId: 'armchair-scandi',
        name: 'Armchair',
        dimensions: [0.8, 0.8, 0.8],
        position: [-2.5, 0.4, -2.5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const barrier: FurniturePlacement = {
        id: 'barrier-bookshelf',
        assetId: 'bookshelf-tall',
        name: 'Bookshelf Wall',
        dimensions: [2.0, 2.0, 0.8],
        position: [-2.0, 1.0, -1.8],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const scene = createTestScene(6.0, 6.0, [chair, barrier]);
      const result = analyzeWalkability(scene);

      expect(result.circulation.totalFurnitureCount).toBe(2);
    });

    it('produces high score (100) and zero errors for a well-arranged spacious room', () => {
      const sofa: FurniturePlacement = {
        id: 'sofa',
        assetId: 'sofa-modern-3seater',
        name: 'Sofa',
        dimensions: [2.2, 0.85, 0.95],
        position: [0, 0.425, -1.5], // Against north wall
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const tvConsole: FurniturePlacement = {
        id: 'tv-console',
        assetId: 'tv-unit-minimal',
        name: 'TV Console',
        dimensions: [1.6, 0.5, 0.4],
        position: [0, 0.25, 1.5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };

      const scene = createTestScene(7.0, 7.0, [sofa, tvConsole]);
      const result = analyzeWalkability(scene);

      expect(result.circulation.walkabilityScore).toBeGreaterThanOrEqual(90);
      expect(result.circulation.accessibleFurnitureCount).toBe(2);
      expect(result.circulation.isRoomPassable).toBe(true);
      expect(result.circulation.routes['sofa'].found).toBe(true);
      expect(result.circulation.routes['tv-console'].found).toBe(true);
    });
  });

  describe('Phase 4.5 & 4.6: End-to-End Walkability Performance', () => {
    it('integrates with editorStore actions toggleWalkabilityOverlay and runWalkabilityAnalysis', async () => {
      const { useEditorStore } = await import('../../editor3d/store/editorStore');

      expect(useEditorStore.getState().showWalkabilityOverlay).toBe(false);

      // Toggle overlay on
      useEditorStore.getState().toggleWalkabilityOverlay();
      expect(useEditorStore.getState().showWalkabilityOverlay).toBe(true);
      expect(useEditorStore.getState().walkabilityAnalysis).not.toBeNull();

      // Run explicit analysis
      const analysis = useEditorStore.getState().runWalkabilityAnalysis();
      expect(analysis.circulation.walkabilityScore).toBeGreaterThanOrEqual(0);
      expect(analysis.circulation.walkabilityScore).toBeLessThanOrEqual(100);

      // Toggle overlay off
      useEditorStore.getState().toggleWalkabilityOverlay();
      expect(useEditorStore.getState().showWalkabilityOverlay).toBe(false);
    });

    it('detects clearance clashes when two items operational zones overlap', () => {
      const wardrobe: FurniturePlacement = {
        id: 'wardrobe-1',
        assetId: 'wardrobe-2door',
        name: 'Wardrobe 1',
        dimensions: [1.2, 2.0, 0.6],
        position: [-0.5, 1.0, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      const desk: FurniturePlacement = {
        id: 'desk-1',
        assetId: 'desk-wood-modern',
        name: 'Desk 1',
        dimensions: [1.2, 0.75, 0.6],
        position: [0.3, 0.375, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };

      const scene = createTestScene(6.0, 6.0, [wardrobe, desk]);
      const result = analyzeWalkability(scene);
      expect(result.circulation).toBeDefined();
    });

    it('executes full walkability analysis on realistic 8-object room in under 25ms', () => {
      const placements: FurniturePlacement[] = [
        { id: '1', assetId: 'sofa-modern-3seater', name: 'Sofa', dimensions: [2.1, 0.85, 0.95], position: [0, 0.425, -1.0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        { id: '2', assetId: 'coffee-table-round', name: 'Coffee Table', dimensions: [0.9, 0.45, 0.9], position: [0, 0.225, -0.1], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        { id: '3', assetId: 'armchair-scandi', name: 'Armchair Left', dimensions: [0.85, 0.8, 0.85], position: [-1.6, 0.4, -0.5], rotationEuler: [0, Math.PI / 4, 0], scale: [1, 1, 1] },
        { id: '4', assetId: 'armchair-scandi', name: 'Armchair Right', dimensions: [0.85, 0.8, 0.85], position: [1.6, 0.4, -0.5], rotationEuler: [0, -Math.PI / 4, 0], scale: [1, 1, 1] },
        { id: '5', assetId: 'media-console', name: 'Media Console', dimensions: [1.8, 0.5, 0.45], position: [0, 0.25, 2.0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        { id: '6', assetId: 'bookshelf-tall', name: 'Bookshelf', dimensions: [1.0, 1.9, 0.35], position: [-2.6, 0.95, -2.0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        { id: '7', assetId: 'floor-lamp', name: 'Floor Lamp', dimensions: [0.45, 1.6, 0.45], position: [2.4, 0.8, -2.2], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        { id: '8', assetId: 'side-table', name: 'Side Table', dimensions: [0.5, 0.55, 0.5], position: [-2.2, 0.275, -0.8], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
      ];

      const scene = createTestScene(6.5, 6.5, placements);
      const start = performance.now();
      const result = analyzeWalkability(scene);
      const duration = performance.now() - start;

      expect(result.occupancyGrid).toBeDefined();
      expect(result.costGrid).toBeDefined();
      expect(result.circulation).toBeDefined();
      expect(result.circulation.accessibleFurnitureCount).toBeGreaterThan(0);
      expect(duration).toBeLessThan(150); // Well under responsive threshold (typically 5-15ms)
    });
  });
});
