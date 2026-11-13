import { describe, it, expect, beforeEach } from 'vitest';
import type { CanonicalScene, FurniturePlacement, RoomDimensions } from '../../types/scene';
import { isWithinRoom, validateRoomBoundaries } from '../constraints/boundaryValidator';
import { resolveRoomOpenings } from '../occupancy/clearanceMapper';
import { analyzeWalkability } from '../occupancy/walkabilityManager';
import { 
  createRectangularFootprint, 
  createRectangularWalls, 
  computePolygonArea,
  deriveWallProperties 
} from '../parametric/roomGeometry';
import { buildFloorGeometry } from '../parametric/geometry/floorGeometryBuilder';
import { buildCornerJunctions } from '../parametric/geometry/cornerJunctionBuilder';
import { useEditorStore } from '../../editor3d/store/editorStore';

describe('Phase 5.5: Parametric Spatial Intelligence Hardening & Validation', () => {
  beforeEach(() => {
    useEditorStore.getState().clearScene();
    useEditorStore.getState().setRoomDimensions({
      width: 5,
      length: 5,
      height: 2.8,
    });
    useEditorStore.setState({ history: [], future: [] });
  });

  // =========================================================================
  // STAGE 2: BIDIRECTIONAL CONTAINMENT & POLYGON-FURNITURE INTERSECTION
  // =========================================================================
  describe('Stage 2: Bidirectional Containment & Polygon-Furniture Intersection', () => {
    // L-shaped room: 6x6 with a 3x3 cutout at South-East
    // Footprint: (-3, 3) NW -> (0, 3) N -> (0, 0) Reflex -> (3, 0) E -> (3, -3) SE -> (-3, -3) SW
    // Note: reflex corner is at (0, 0).
    const lShapedRoom: RoomDimensions = {
      width: 6,
      length: 6,
      height: 2.8,
      isParametric: true,
      footprint: [
        [-3, 3],
        [0, 3],
        [0, 0],   // Interior reflex vertex
        [3, 0],
        [3, -3],
        [-3, -3],
      ],
      walls: [
        { id: 'w-north', startPoint: [-3, 3], endPoint: [0, 3], height: 2.8, thickness: 0.15 },
        { id: 'w-cut-v', startPoint: [0, 3], endPoint: [0, 0], height: 2.8, thickness: 0.15 },
        { id: 'w-cut-h', startPoint: [0, 0], endPoint: [3, 0], height: 2.8, thickness: 0.15 },
        { id: 'w-east', startPoint: [3, 0], endPoint: [3, -3], height: 2.8, thickness: 0.15 },
        { id: 'w-south', startPoint: [3, -3], endPoint: [-3, -3], height: 2.8, thickness: 0.15 },
        { id: 'w-west', startPoint: [-3, -3], endPoint: [-3, 3], height: 2.8, thickness: 0.15 },
      ],
    };

    it('detects boundary violation when furniture encloses an interior reflex corner vertex', () => {
      // Large table centered directly on the reflex corner (0, 0), dimensions 1.6m x 1.6m
      // Corners are at (-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8)
      // The reflex corner (0, 0) is strictly inside this furniture footprint!
      const tableOverCorner: FurniturePlacement = {
        id: 'table-over-corner',
        assetId: 'dining-table-large',
        name: 'Dining Table',
        position: [0, 0.375, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: [1.6, 0.75, 1.6],
      };

      const violations = validateRoomBoundaries(tableOverCorner, lShapedRoom);
      expect(violations.length).toBeGreaterThan(0);
      expect(isWithinRoom(tableOverCorner, lShapedRoom)).toBe(false);
    });

    it('allows valid furniture placement inside the room without enclosing any boundary vertex', () => {
      const sofaInLivingArea: FurniturePlacement = {
        id: 'sofa-valid',
        assetId: 'sofa-three-seater',
        name: 'Living Room Sofa',
        position: [-1.8, 0.425, -1.5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: [2.0, 0.85, 0.9],
      };

      const violations = validateRoomBoundaries(sofaInLivingArea, lShapedRoom);
      expect(violations.length).toBe(0);
      expect(isWithinRoom(sofaInLivingArea, lShapedRoom)).toBe(true);
    });

    it('detects boundary violation for rotated furniture intersecting a non-orthogonal wall segment', () => {
      // 5-sided pentagonal room (like in user architectural drawing)
      const pentagonFootprint: [number, number][] = [
        [-1.75, 2.5],   // South wall start
        [1.75, 2.5],    // South wall end (width 3.5m)
        [2.3, -1.6],    // East wall end (slanted)
        [0, -2.8],      // Apex
        [-2.3, -1.6],   // West wall end (slanted)
      ];

      const pentagonRoom: RoomDimensions = {
        width: 4.6,
        length: 5.3,
        height: 2.8,
        isParametric: true,
        footprint: pentagonFootprint,
      };

      // Item rotated 45 degrees placed close to the slanted west wall so its corner crosses the wall
      const rotatedConsole: FurniturePlacement = {
        id: 'rotated-console',
        assetId: 'storage-credenza',
        name: 'Console Table',
        position: [-1.9, 0.4, -0.5],
        rotationEuler: [0, Math.PI / 4, 0],
        scale: [1, 1, 1],
        dimensions: [1.8, 0.8, 0.5],
      };

      const violations = validateRoomBoundaries(rotatedConsole, pentagonRoom);
      expect(violations.length).toBeGreaterThan(0);
      expect(isWithinRoom(rotatedConsole, pentagonRoom)).toBe(false);
    });

    it('correctly validates non-uniform scale in acute corner placements', () => {
      const acuteRoom: RoomDimensions = {
        width: 5,
        length: 5,
        height: 2.8,
        isParametric: true,
        footprint: [
          [-2.5, 2.5],
          [2.5, 2.5],
          [0, -2.5], // Acute 53-degree corner at top
        ],
      };

      // Narrow bookshelf with non-uniform scale (depth scaled down to 0.4x)
      const narrowShelf: FurniturePlacement = {
        id: 'narrow-shelf',
        assetId: 'bookshelf-tall',
        name: 'Bookshelf',
        position: [0, 0.9, -1.5], // tucked towards acute corner
        rotationEuler: [0, 0, 0],
        scale: [0.8, 1.0, 0.4],
        dimensions: [1.0, 1.8, 0.5],
      };

      expect(isWithinRoom(narrowShelf, acuteRoom)).toBe(true);

      // Over-scaled item exceeds corner bounds
      const overscaledShelf: FurniturePlacement = {
        ...narrowShelf,
        scale: [2.5, 1.0, 1.5],
      };
      expect(isWithinRoom(overscaledShelf, acuteRoom)).toBe(false);
    });
  });

  // =========================================================================
  // STAGE 3: WALL THICKNESS & ANALYTICAL GEOMETRY CONSISTENCY
  // =========================================================================
  describe('Stage 3: Wall Thickness & Analytical Geometry Consistency', () => {
    it('produces identical analytical Shoelace area and triangulated Earcut mesh area', () => {
      // Chamfered L-shaped room (matching user attachment #4)
      const chamferedFootprint: [number, number][] = [
        [-3.0, 3.0],
        [0.0, 3.0],
        [0.0, 0.0],
        [3.0, 0.0],
        [3.0, -2.0],
        [1.5, -3.0], // Chamfered corner
        [-3.0, -3.0],
      ];

      const analyticalArea = computePolygonArea(chamferedFootprint);
      const floorResult = buildFloorGeometry(chamferedFootprint, 2.8);

      expect(floorResult.diagnostics).toHaveLength(0);
      expect(floorResult.triangleCount).toBeGreaterThan(3);
      expect(Math.abs(floorResult.area - analyticalArea)).toBeLessThan(0.001);
    });

    it('generates watertight corner junctions across acute, orthogonal, and obtuse corners', () => {
      // 5-sided pentagon room with obtuse (133°), acute, and orthogonal wall junctions
      const pentagonFootprint: [number, number][] = [
        [-1.75, 2.0],
        [1.75, 2.0],
        [2.2, -1.5],
        [0.0, -2.5],
        [-2.2, -1.5],
      ];

      const walls = pentagonFootprint.map((p1, idx) => {
        const p2 = pentagonFootprint[(idx + 1) % pentagonFootprint.length];
        return {
          id: `wall-${idx}`,
          startPoint: p1,
          endPoint: p2,
          height: 2.8,
          thickness: 0.15,
        };
      });

      const derivedWalls = walls.map((w) => deriveWallProperties(w, 2.8, 0.15));
      const junctions = buildCornerJunctions(derivedWalls, 2.8, 1.5);

      expect(junctions.cornerCount).toBe(5);
      expect(junctions.vertexCount).toBeGreaterThan(0);
      expect(junctions.triangleCount).toBeGreaterThan(0);
      expect(junctions.junctionGeometry.getAttribute('position')).toBeDefined();
      expect(junctions.junctionGeometry.getAttribute('normal')).toBeDefined();
    });
  });

  // =========================================================================
  // STAGE 4: ARCHITECTURAL OPENINGS & DOOR PORTAL LIFECYCLE
  // =========================================================================
  describe('Stage 4: Architectural Opening & Door Portal Lifecycle', () => {
    it('strictly resolves doors as pedestrian portals and excludes windows', () => {
      const roomWithDoorsAndWindows: RoomDimensions = {
        width: 6,
        length: 6,
        height: 2.8,
        isParametric: true,
        footprint: createRectangularFootprint(6, 6),
        walls: createRectangularWalls(6, 6),
        openings: [
          {
            id: 'window-1',
            wallId: 'wall-north',
            type: 'window',
            distanceAlongWall: 1.5,
            width: 1.2,
            height: 1.2,
            sillHeight: 0.9,
          },
          {
            id: 'door-south',
            wallId: 'wall-south',
            type: 'door',
            distanceAlongWall: 2.0,
            width: 0.9,
            height: 2.1,
            swing: 'inward-left',
          },
          {
            id: 'window-2',
            wallId: 'wall-east',
            type: 'window',
            distanceAlongWall: 2.0,
            width: 1.5,
            height: 1.2,
            sillHeight: 0.9,
          },
        ],
      };

      const resolved = resolveRoomOpenings(roomWithDoorsAndWindows);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe('door-south');
      expect(resolved[0].isFallback).toBe(false);
      // Access point stepped 0.60m inward into the room
      expect(resolved[0].accessPoint[1]).toBeLessThan(3.0);
    });

    it('falls back to deterministic south-wall entrance when room has only windows', () => {
      const windowOnlyRoom: RoomDimensions = {
        width: 6,
        length: 6,
        height: 2.8,
        isParametric: true,
        footprint: createRectangularFootprint(6, 6),
        walls: createRectangularWalls(6, 6),
        openings: [
          {
            id: 'window-north',
            wallId: 'wall-north',
            type: 'window',
            distanceAlongWall: 2.0,
            width: 1.5,
            height: 1.2,
            sillHeight: 0.9,
          },
        ],
      };

      const resolved = resolveRoomOpenings(windowOnlyRoom);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe('room-main-entrance');
      expect(resolved[0].isFallback).toBe(true);
      expect(resolved[0].wall).toBe('south');
    });
  });

  // =========================================================================
  // STAGE 5: MULTIPLE ENTRANCE CIRCULATION & REACHABILITY
  // =========================================================================
  describe('Stage 5: Multiple Entrance Circulation & Reachability', () => {
    // 8m x 6m room with two architectural doors:
    // Door 1: South wall at distanceAlongWall = 2.0m
    // Door 2: West wall at distanceAlongWall = 2.0m
    const twoDoorRoom: RoomDimensions = {
      width: 8,
      length: 6,
      height: 2.8,
      isParametric: true,
      footprint: createRectangularFootprint(8, 6),
      walls: createRectangularWalls(8, 6),
      openings: [
        {
          id: 'door-south',
          wallId: 'wall-south',
          type: 'door',
          distanceAlongWall: 2.0,
          width: 0.9,
          height: 2.1,
          swing: 'inward',
        },
        {
          id: 'door-west',
          wallId: 'wall-west',
          type: 'door',
          distanceAlongWall: 2.0,
          width: 0.9,
          height: 2.1,
          swing: 'inward',
        },
      ],
    };

    it('computes reachable routes from either entrance without double-counting', () => {
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: twoDoorRoom,
        objects: [
          {
            id: 'sofa-center',
            assetId: 'sofa-three-seater',
            name: 'Living Room Sofa',
            position: [0, 0.425, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [2.0, 0.85, 0.9],
          },
          {
            id: 'bookshelf-north',
            assetId: 'bookshelf-tall',
            name: 'Study Bookshelf',
            position: [2.0, 0.9, -2.5],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.2, 1.8, 0.4],
          },
        ],
      };

      const result = analyzeWalkability(scene);
      expect(result.openings).toHaveLength(2);
      expect(result.circulation.accessibleFurnitureCount).toBe(2);
      expect(result.circulation.totalFurnitureCount).toBe(2);
      expect(result.circulation.accessibleRatio).toBe(1.0);
      expect(result.circulation.isRoomPassable).toBe(true);

      // Verify shortest routes are recorded for both items
      expect(result.circulation.routes['sofa-center'].found).toBe(true);
      expect(result.circulation.routes['bookshelf-north'].found).toBe(true);
    });

    it('correctly diagnoses Door 1 blockage while preserving reachability through Door 2', () => {
      const resolvedOpenings = resolveRoomOpenings(twoDoorRoom);
      const southDoor = resolvedOpenings.find((o) => o.id === 'door-south')!;

      // Place a heavy wardrobe right in front of southDoor swing corridor
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: twoDoorRoom,
        objects: [
          {
            id: 'wardrobe-blocking-south',
            assetId: 'storage-wardrobe',
            name: 'Blocking Wardrobe',
            position: [southDoor.center[0], 1.0, southDoor.center[1] - 0.3],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.2, 2.0, 0.6],
          },
          {
            id: 'desk-accessible-via-west',
            assetId: 'desk-office',
            name: 'Office Desk',
            position: [-2.0, 0.375, 0], // Near the west door
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.4, 0.75, 0.7],
          },
        ],
      };

      const result = analyzeWalkability(scene);
      // South door must have a door_blocked issue
      const doorBlockedIssue = result.circulation.issues.find(
        (iss) => iss.type === 'door_blocked' && iss.id.includes('door-south')
      );
      expect(doorBlockedIssue).toBeDefined();

      // Desk is reachable via clear west door, so it must NOT be marked as unreachable!
      const unreachableIssue = result.circulation.issues.find(
        (iss) => iss.type === 'furniture_unreachable' && iss.affectedFurnitureIds.includes('desk-accessible-via-west')
      );
      expect(unreachableIssue).toBeUndefined();
      expect(result.circulation.routes['desk-accessible-via-west'].found).toBe(true);
    });

    it('reports failure when ALL room entrances are blocked', () => {
      const resolvedOpenings = resolveRoomOpenings(twoDoorRoom);
      const southDoor = resolvedOpenings.find((o) => o.id === 'door-south')!;
      const westDoor = resolvedOpenings.find((o) => o.id === 'door-west')!;

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: twoDoorRoom,
        objects: [
          {
            id: 'blocker-south',
            assetId: 'storage-wardrobe',
            name: 'South Wardrobe',
            position: [southDoor.center[0], 1.0, southDoor.center[1] - 0.3],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.2, 2.0, 0.6],
          },
          {
            id: 'blocker-west',
            assetId: 'storage-wardrobe',
            name: 'West Wardrobe',
            position: [westDoor.center[0] + 0.3, 1.0, westDoor.center[1]],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [0.6, 2.0, 1.2],
          },
        ],
      };

      const result = analyzeWalkability(scene);
      expect(result.circulation.isRoomPassable).toBe(false);
      const blockedDoorIssues = result.circulation.issues.filter((iss) => iss.type === 'door_blocked');
      expect(blockedDoorIssues.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // STAGE 6: CANONICAL SCENE IMMUTABILITY & UNDO/REDO INVARIANCE
  // =========================================================================
  describe('Stage 6: Canonical Scene Immutability & Undo/Redo Invariance', () => {
    it('guarantees analyzeWalkability does not mutate canonical scene objects', () => {
      const canonicalScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: {
          width: 5,
          length: 5,
          height: 2.8,
          isParametric: true,
          footprint: createRectangularFootprint(5, 5),
          walls: createRectangularWalls(5, 5),
        },
        objects: [
          {
            id: 'armchair-1',
            assetId: 'seating-armchair',
            name: 'Armchair',
            position: [0, 0.45, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [0.9, 0.9, 0.85],
          },
        ],
      };

      const sceneSnapshot = JSON.stringify(canonicalScene);
      analyzeWalkability(canonicalScene);
      expect(JSON.stringify(canonicalScene)).toBe(sceneSnapshot);
    });

    it('synchronizes opening lifecycle with undo/redo in Zustand editor store', () => {
      const store = useEditorStore.getState();
      const initialOpeningCount = store.scene.room.openings?.length || 0;

      // 1. Add an architectural door
      const addResult = store.addWallOpening('wall-south', 'door', {
        distanceAlongWall: 1.5,
        width: 0.9,
        height: 2.1,
        swing: 'inward-left',
      });

      expect(addResult.success).toBe(true);
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(initialOpeningCount + 1);
      expect(useEditorStore.getState().canUndo()).toBe(true);

      // 2. Update door swing direction
      const updateResult = store.updateWallOpening(addResult.openingId!, {
        swing: 'outward-right',
      });
      expect(updateResult.success).toBe(true);
      const updatedOp = useEditorStore.getState().scene.room.openings?.find((o) => o.id === addResult.openingId);
      expect(updatedOp?.swing).toBe('outward-right');

      // 3. Undo swing change
      store.undo();
      const afterUndoOp = useEditorStore.getState().scene.room.openings?.find((o) => o.id === addResult.openingId);
      expect(afterUndoOp?.swing).toBe('inward-left');

      // 4. Undo door creation
      store.undo();
      expect(useEditorStore.getState().scene.room.openings?.length || 0).toBe(initialOpeningCount);

      // 5. Redo door creation
      store.redo();
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(initialOpeningCount + 1);
    });
  });

  // =========================================================================
  // STAGE 7: PERFORMANCE & REGRESSION BENCHMARKING
  // =========================================================================
  describe('Stage 7: Performance & Regression Benchmarking', () => {
    it('executes full spatial pipeline for a realistic multi-door pentagon room under 100ms', () => {
      const pentagonRoom: RoomDimensions = {
        width: 5,
        length: 5,
        height: 2.8,
        isParametric: true,
        footprint: [
          [-2.0, 2.0],
          [2.0, 2.0],
          [2.5, -1.5],
          [0.0, -2.5],
          [-2.5, -1.5],
        ],
        walls: [
          { id: 'w-0', startPoint: [-2.0, 2.0], endPoint: [2.0, 2.0], height: 2.8, thickness: 0.15 },
          { id: 'w-1', startPoint: [2.0, 2.0], endPoint: [2.5, -1.5], height: 2.8, thickness: 0.15 },
          { id: 'w-2', startPoint: [2.5, -1.5], endPoint: [0.0, -2.5], height: 2.8, thickness: 0.15 },
          { id: 'w-3', startPoint: [0.0, -2.5], endPoint: [-2.5, -1.5], height: 2.8, thickness: 0.15 },
          { id: 'w-4', startPoint: [-2.5, -1.5], endPoint: [-2.0, 2.0], height: 2.8, thickness: 0.15 },
        ],
        openings: [
          {
            id: 'door-front',
            wallId: 'w-0',
            type: 'door',
            distanceAlongWall: 1.5,
            width: 0.9,
            height: 2.1,
            swing: 'inward',
          },
        ],
      };

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: pentagonRoom,
        objects: [
          {
            id: 'sofa',
            assetId: 'sofa-three-seater',
            name: 'Sofa',
            position: [0, 0.425, 0.5],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [2.0, 0.85, 0.9],
          },
          {
            id: 'coffee-table',
            assetId: 'table-coffee',
            name: 'Coffee Table',
            position: [0, 0.225, -0.3],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.1, 0.45, 0.6],
          },
          {
            id: 'tv-console',
            assetId: 'storage-credenza',
            name: 'TV Console',
            position: [0, 0.35, -1.8],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.6, 0.5, 0.45],
          },
        ],
      };

      // Warm up JIT
      analyzeWalkability(scene);

      const start = performance.now();
      const result = analyzeWalkability(scene);
      const elapsed = performance.now() - start;

      expect(result.circulation.isRoomPassable).toBe(true);
      expect(result.circulation.accessibleFurnitureCount).toBe(3);
      expect(elapsed).toBeLessThan(100);
    });
  });
});
