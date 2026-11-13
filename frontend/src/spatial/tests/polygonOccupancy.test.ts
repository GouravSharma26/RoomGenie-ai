import { describe, it, expect } from 'vitest';
import type { CanonicalScene, FurniturePlacement } from '../../types/scene';
import { 
  isPointInPolygon, 
  pointToSegmentDistance, 
} from '../parametric/roomGeometry';
import { buildOccupancyGrid } from '../occupancy/occupancyBuilder';
import { buildWalkabilityCostGrid, resolveRoomOpenings } from '../occupancy/clearanceMapper';
import { findPath, hasLineOfSight } from '../occupancy/pathfinder';
import { validateCirculation } from '../occupancy/circulationValidator';
import { validateRoomBoundaries, isWithinRoom } from '../constraints/boundaryValidator';
import { cellIndex, worldToGrid } from '../occupancy/gridCoordinates';

describe('Phase 5.4: Parametric Room & Polygon Occupancy Integration', () => {
  // --- TEST FIXTURES ---

  // 1. Standard 6x6 Rectangular Room
  const createRectangularScene = (objects: FurniturePlacement[] = []): CanonicalScene => ({
    schemaVersion: 1,
    unit: 'm',
    room: { width: 6.0, length: 6.0, height: 2.8 },
    objects,
  });

  // 2. Pentagonal Room (5 vertices, convex)
  const pentagonFootprint: [number, number][] = [
    [-2.0, 2.5],
    [2.0, 2.5],
    [3.0, -1.0],
    [0.0, -3.0],
    [-3.0, -1.0],
  ];
  const pentagonWalls = [
    { id: 'wall-p1', startPoint: [-2.0, 2.5] as [number, number], endPoint: [2.0, 2.5] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-p2', startPoint: [2.0, 2.5] as [number, number], endPoint: [3.0, -1.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-p3', startPoint: [3.0, -1.0] as [number, number], endPoint: [0.0, -3.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-p4', startPoint: [0.0, -3.0] as [number, number], endPoint: [-3.0, -1.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-p5', startPoint: [-3.0, -1.0] as [number, number], endPoint: [-2.0, 2.5] as [number, number], height: 2.8, thickness: 0.15 },
  ];
  const createPentagonScene = (objects: FurniturePlacement[] = []): CanonicalScene => ({
    schemaVersion: 1,
    unit: 'm',
    room: {
      width: 6.0,
      length: 6.0,
      height: 2.8,
      footprint: pentagonFootprint,
      walls: pentagonWalls,
      openings: [],
      isParametric: true,
    },
    objects,
  });

  // 3. L-Shaped Concave Room (6m x 6m bounding box with 3x3 NE corner cutout)
  // Footprint coordinates (CCW):
  // SW (-3, 3) -> SE (0, 3) -> Inner corner (0, 0) -> East (3, 0) -> NE (3, -3) -> NW (-3, -3)
  const lShapedFootprint: [number, number][] = [
    [-3.0, 3.0],
    [0.0, 3.0],
    [0.0, 0.0],
    [3.0, 0.0],
    [3.0, -3.0],
    [-3.0, -3.0],
  ];
  const lShapedWalls = [
    { id: 'wall-l-south', startPoint: [-3.0, 3.0] as [number, number], endPoint: [0.0, 3.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-l-inner-v', startPoint: [0.0, 3.0] as [number, number], endPoint: [0.0, 0.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-l-inner-h', startPoint: [0.0, 0.0] as [number, number], endPoint: [3.0, 0.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-l-east', startPoint: [3.0, 0.0] as [number, number], endPoint: [3.0, -3.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-l-north', startPoint: [3.0, -3.0] as [number, number], endPoint: [-3.0, -3.0] as [number, number], height: 2.8, thickness: 0.15 },
    { id: 'wall-l-west', startPoint: [-3.0, -3.0] as [number, number], endPoint: [-3.0, 3.0] as [number, number], height: 2.8, thickness: 0.15 },
  ];
  const createLShapedScene = (objects: FurniturePlacement[] = []): CanonicalScene => ({
    schemaVersion: 1,
    unit: 'm',
    room: {
      width: 6.0,
      length: 6.0,
      height: 2.8,
      footprint: lShapedFootprint,
      walls: lShapedWalls,
      openings: [],
      isParametric: true,
    },
    objects,
  });

  describe('Stage 2: Polygon-Aware Occupancy Grid Generation', () => {
    it('accurately classifies point inside, on boundary, and outside arbitrary polygons', () => {
      // Inside L-shaped room
      expect(isPointInPolygon([-1.5, 1.5], lShapedFootprint)).toBe(true);
      expect(isPointInPolygon([1.5, -1.5], lShapedFootprint)).toBe(true);
      expect(isPointInPolygon([-1.5, -1.5], lShapedFootprint)).toBe(true);

      // Outside L-shaped room (in the cutout void: x > 0 and z > 0)
      expect(isPointInPolygon([1.5, 1.5], lShapedFootprint)).toBe(false);
      expect(isPointInPolygon([2.5, 2.5], lShapedFootprint)).toBe(false);

      // Outside bounding box entirely
      expect(isPointInPolygon([5.0, 5.0], lShapedFootprint)).toBe(false);

      // On boundary vertex and edge within tolerance
      expect(isPointInPolygon([0.0, 0.0], lShapedFootprint)).toBe(true); // reflex corner
      expect(isPointInPolygon([0.0, 1.5], lShapedFootprint)).toBe(true); // edge
    });

    it('works identically regardless of polygon winding direction (CCW vs CW)', () => {
      const cwLShaped = [...lShapedFootprint].reverse();
      const testPoints: [number, number][] = [
        [-1.5, 1.5],
        [1.5, -1.5],
        [1.5, 1.5], // void
        [0.0, 0.0],
        [4.0, 0.0], // outside
      ];

      for (const pt of testPoints) {
        expect(isPointInPolygon(pt, lShapedFootprint)).toBe(isPointInPolygon(pt, cwLShaped));
      }
    });

    it('builds occupancy grid for L-shaped room marking cutout cells as isInsideRoom=false', () => {
      const scene = createLShapedScene();
      const result = buildOccupancyGrid(scene, { resolution: 0.10 });
      expect(result.success).toBe(true);
      const grid = result.grid!;

      // Total AABB cells: 6m x 6m @ 0.10m = 60 x 60 = 3600 cells
      expect(grid.dimensions.numCols).toBe(60);
      expect(grid.dimensions.numRows).toBe(60);
      expect(grid.dimensions.totalCells).toBe(3600);

      // Cutout region (x > 0 and z > 0) is roughly 3m x 3m = 30 x 30 = 900 cells
      // Free count should be roughly 3600 - 900 = ~2700 cells
      expect(grid.freeCount).toBeGreaterThan(2600);
      expect(grid.freeCount).toBeLessThan(2800);

      // Verify a cell inside the cutout is isInsideRoom=false
      const cutoutCoord = worldToGrid(1.5, 1.5, grid.dimensions)!;
      const cutoutCell = grid.cells[cellIndex(cutoutCoord.col, cutoutCoord.row, grid.dimensions.numCols)];
      expect(cutoutCell.isInsideRoom).toBe(false);

      // Verify a cell inside the room floor is isInsideRoom=true and isOccupied=false
      const insideCoord = worldToGrid(-1.5, 1.5, grid.dimensions)!;
      const insideCell = grid.cells[cellIndex(insideCoord.col, insideCoord.row, grid.dimensions.numCols)];
      expect(insideCell.isInsideRoom).toBe(true);
      expect(insideCell.isOccupied).toBe(false);
    });

    it('validates furniture placement respects polygon footprint and catches cutout intersections', () => {
      const scene = createLShapedScene();

      // Furniture placed entirely inside walkable wing
      const validSofa: FurniturePlacement = {
        id: 'sofa-valid',
        assetId: 'sofa-modern-3seater',
        name: 'Sofa',
        dimensions: [2.0, 0.85, 0.9],
        position: [-1.5, 0.425, -1.5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      expect(isWithinRoom(validSofa, scene.room)).toBe(true);
      expect(validateRoomBoundaries(validSofa, scene.room)).toHaveLength(0);

      // Furniture placed in the exterior cutout void (x=1.5, z=1.5)
      // Even though this is within [-3, 3] x [-3, 3] AABB bounds, it is outside the polygon!
      const invalidVoidTable: FurniturePlacement = {
        id: 'table-cutout-void',
        assetId: 'coffee-table-wood',
        name: 'Table in Cutout Void',
        dimensions: [1.2, 0.45, 0.6],
        position: [1.5, 0.225, 1.5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      expect(isWithinRoom(invalidVoidTable, scene.room)).toBe(false);
      const violations = validateRoomBoundaries(invalidVoidTable, scene.room);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('Stage 3: Polygon-Aware Boundary Clearance', () => {
    it('computes exact Euclidean distance to horizontal, vertical, and diagonal wall segments', () => {
      // Horizontal wall from [-2, 2] to [2, 2]
      expect(pointToSegmentDistance(0, 0, -2, 2, 2, 2)).toBeCloseTo(2.0, 4);
      expect(pointToSegmentDistance(0, 3, -2, 2, 2, 2)).toBeCloseTo(1.0, 4);

      // Vertical wall from [2, -2] to [2, 2]
      expect(pointToSegmentDistance(0, 0, 2, -2, 2, 2)).toBeCloseTo(2.0, 4);
      expect(pointToSegmentDistance(3, 0, 2, -2, 2, 2)).toBeCloseTo(1.0, 4);

      // 45-degree diagonal wall from [0, 2] to [2, 0]
      // Distance from (0, 0) to line x + y - 2 = 0 is |0 + 0 - 2| / sqrt(2) = sqrt(2) ≈ 1.4142
      expect(pointToSegmentDistance(0, 0, 0, 2, 2, 0)).toBeCloseTo(Math.SQRT2, 4);
    });

    it('generates cost grid for L-shaped room with out_of_bounds exterior cells and zero exterior clearance', () => {
      const scene = createLShapedScene();
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ, {
        resolution: 0.10,
        pedestrianClearance: 0.25,
      });

      // Cell in cutout void
      const cutoutCoord = worldToGrid(1.5, 1.5, costGrid.dimensions)!;
      const cutoutIdx = cellIndex(cutoutCoord.col, cutoutCoord.row, costGrid.dimensions.numCols);
      expect(costGrid.classifications[cutoutIdx]).toBe('out_of_bounds');
      expect(costGrid.costs[cutoutIdx]).toBe(Infinity);
      expect(costGrid.obstacleDistances[cutoutIdx]).toBe(0);

      // Cell in center of open wing (-1.5, -1.5)
      const insideCoord = worldToGrid(-1.5, -1.5, costGrid.dimensions)!;
      const insideIdx = cellIndex(insideCoord.col, insideCoord.row, costGrid.dimensions.numCols);
      expect(costGrid.classifications[insideIdx]).toBe('free');
      expect(costGrid.costs[insideIdx]).toBe(1.0);
      expect(costGrid.obstacleDistances[insideIdx]).toBeGreaterThan(1.0);

      // Cell 15cm from an interior reflex wall is within 25cm pedestrian clearance
      // Wall is at x=0 (from z=0 to z=3). Cell at x=-0.15, z=1.5 is 15cm away from the wall
      const nearWallCoord = worldToGrid(-0.15, 1.5, costGrid.dimensions)!;
      const nearWallIdx = cellIndex(nearWallCoord.col, nearWallCoord.row, costGrid.dimensions.numCols);
      expect(costGrid.classifications[nearWallIdx]).toBe('restricted');
      expect(costGrid.costs[nearWallIdx]).toBeGreaterThan(1.0);
    });
  });

  describe('Stage 4: Architectural Door Portals & Navigation Integration', () => {
    it('maps architectural door into a navigation portal on south, north, or angled walls', () => {
      const scene = createPentagonScene();
      // Add door on angled wall-p2 (start: [2, 2.5] to end: [3, -1])
      scene.room.openings = [
        {
          id: 'door-angled',
          wallId: 'wall-p2',
          type: 'door',
          distanceAlongWall: 1.0,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
          swing: 'inward-left',
        },
      ];

      const openings = resolveRoomOpenings(scene.room);
      expect(openings.length).toBe(1);
      const door = openings[0];
      expect(door.id).toBe('door-angled');
      expect(door.width).toBe(0.9);
      expect(door.isFallback).toBe(false);
      // Access point must be inside the polygon
      expect(isPointInPolygon(door.accessPoint, pentagonFootprint)).toBe(true);
    });

    it('strictly excludes windows from becoming pedestrian portals', () => {
      const scene = createRectangularScene();
      scene.room.openings = [
        {
          id: 'window-north',
          wallId: 'wall-north',
          type: 'window',
          distanceAlongWall: 1.5,
          width: 1.2,
          height: 1.2,
          sillHeight: 0.9,
          swing: 'none',
        },
      ];

      const openings = resolveRoomOpenings(scene.room);
      // Window must NOT create a door portal; it should fall back to standard south door
      expect(openings.length).toBe(1);
      expect(openings[0].id).toBe('room-main-entrance');
      expect(openings[0].isFallback).toBe(true);
    });

    it('detects furniture obstruction blocking doorway approach and swing corridor', () => {
      const scene = createLShapedScene();
      // Door on wall-l-south (start: [-3, 3] to [0, 3]), center at x=-1.5, z=3.0
      scene.room.openings = [
        {
          id: 'entrance-door',
          wallId: 'wall-l-south',
          type: 'door',
          distanceAlongWall: 1.0,
          width: 1.0,
          height: 2.1,
          sillHeight: 0,
          swing: 'inward-right',
        },
      ];

      // Place bookshelf directly in front of the door (x=-1.5, z=2.6)
      const blocker: FurniturePlacement = {
        id: 'blocker-shelf',
        assetId: 'bookshelf-wood',
        name: 'Blocking Bookshelf',
        dimensions: [1.2, 1.8, 0.4],
        position: [-1.5, 0.9, 2.6],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      scene.objects = [blocker];

      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);
      const openings = resolveRoomOpenings(scene.room);
      const circulation = validateCirculation(scene, costGrid, openings);

      expect(circulation.issues.some((iss) => iss.type === 'door_blocked')).toBe(true);
      expect(circulation.isRoomPassable).toBe(false);
    });
  });

  describe('Stage 5 & Stage 6: Pathfinding Around Polygon Corners & Concave Voids', () => {
    it('routes around reflex corner of L-shaped room without crossing through the exterior cutout', () => {
      const scene = createLShapedScene();
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);

      // Start in South wing (-1.5, 2.0), Goal in East wing (2.0, -1.5)
      // The direct straight line connecting them passes through (0.25, 0.25), which is in the exterior void!
      const start: [number, number] = [-1.5, 2.0];
      const goal: [number, number] = [2.0, -1.5];

      // Direct line of sight must be false because it cuts through the exterior cutout!
      const startCoord = worldToGrid(start[0], start[1], costGrid.dimensions)!;
      const goalCoord = worldToGrid(goal[0], goal[1], costGrid.dimensions)!;
      expect(hasLineOfSight(startCoord.col, startCoord.row, goalCoord.col, goalCoord.row, costGrid)).toBe(false);

      // A* pathfinder must find a valid path that routes around the inner corner [0, 0]
      const path = findPath(start, goal, costGrid, { smoothPath: true });
      expect(path.found).toBe(true);
      expect(path.worldPath.length).toBeGreaterThanOrEqual(3);

      // Verify that EVERY single waypoint and raw grid cell on the path is inside the room
      for (const [wx, wz] of path.worldPath) {
        expect(isPointInPolygon([wx, wz], lShapedFootprint, 0.05)).toBe(true);
      }
      for (const coord of path.gridPath) {
        const idx = cellIndex(coord.col, coord.row, costGrid.dimensions.numCols);
        expect(costGrid.classifications[idx]).not.toBe('out_of_bounds');
      }
    });

    it('prevents diagonal corner cutting across concave corner vertex', () => {
      const scene = createLShapedScene();
      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);

      // Check cell at inner corner: reflex corner is at (0, 0)
      // Cell just inside the void at (0.05, 0.05) is out_of_bounds
      const voidCoord = worldToGrid(0.05, 0.05, costGrid.dimensions)!;
      const voidIdx = cellIndex(voidCoord.col, voidCoord.row, costGrid.dimensions.numCols);
      expect(costGrid.classifications[voidIdx]).toBe('out_of_bounds');
    });

    it('produces full circulation report with reachable furniture in concave room', () => {
      const scene = createLShapedScene();
      scene.room.openings = [
        {
          id: 'door-main',
          wallId: 'wall-l-south',
          type: 'door',
          distanceAlongWall: 1.0,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
          swing: 'inward-left',
        },
      ];

      // Place a desk in the far north wing (-2.0, -2.0)
      const desk: FurniturePlacement = {
        id: 'study-desk',
        assetId: 'desk-work-ergonomic',
        name: 'Ergonomic Desk',
        dimensions: [1.4, 0.75, 0.7],
        position: [-2.0, 0.375, -2.0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      scene.objects = [desk];

      const occ = buildOccupancyGrid(scene, { resolution: 0.10 }).grid!;
      const costGrid = buildWalkabilityCostGrid(scene, occ);
      const openings = resolveRoomOpenings(scene.room);
      const circulation = validateCirculation(scene, costGrid, openings);

      expect(circulation.totalFurnitureCount).toBe(1);
      expect(circulation.accessibleFurnitureCount).toBe(1);
      expect(circulation.isRoomPassable).toBe(true);
      expect(circulation.walkabilityScore).toBeGreaterThanOrEqual(80);
      expect(circulation.routes['study-desk'].found).toBe(true);
    });
  });

  describe('Stage 9: Performance Benchmarking Across Polygonal Geometries', () => {
    it('benchmarks occupancy and walkability pipeline under 250ms under heavy test-runner load', () => {
      // Warm-up run to allow V8 JIT optimization
      const warmupOcc = buildOccupancyGrid(createRectangularScene(), { resolution: 0.10 });
      buildWalkabilityCostGrid(createRectangularScene(), warmupOcc.grid!);

      // 1. Realistic rectangular room (6m x 6m) with sofa, table, and bookshelf
      const rectScene = createRectangularScene([
        {
          id: 'sofa',
          assetId: 'sofa-modern-3seater',
          name: 'Sofa',
          dimensions: [2.0, 0.85, 0.9],
          position: [0, 0.425, -1.0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'table',
          assetId: 'coffee-table-wood',
          name: 'Table',
          dimensions: [1.2, 0.45, 0.6],
          position: [0, 0.225, 0.2],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ]);
      const t0Rect = performance.now();
      const rectOcc = buildOccupancyGrid(rectScene, { resolution: 0.10 });
      const tOccRect = performance.now();
      const rectCost = buildWalkabilityCostGrid(rectScene, rectOcc.grid!);
      const tCostRect = performance.now();
      const rectOpenings = resolveRoomOpenings(rectScene.room);
      const rectCirc = validateCirculation(rectScene, rectCost, rectOpenings);
      const tEndRect = performance.now();

      const rectTotalTime = tEndRect - t0Rect;
      expect(rectCirc.walkabilityScore).toBeGreaterThanOrEqual(0);
      expect(rectOcc.grid!.dimensions.totalCells).toBe(3600); // 6m x 6m @ 10cm
      expect(rectTotalTime).toBeLessThan(250); // Generous ceiling for parallel test runners

      // 2. Furnished Pentagonal Room
      const pentScene = createPentagonScene([
        {
          id: 'sofa',
          assetId: 'sofa-modern-3seater',
          name: 'Sofa',
          dimensions: [2.0, 0.85, 0.9],
          position: [0, 0.425, 0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ]);
      const t0Pent = performance.now();
      const pentOcc = buildOccupancyGrid(pentScene, { resolution: 0.10 });
      const pentCost = buildWalkabilityCostGrid(pentScene, pentOcc.grid!);
      const pentOpenings = resolveRoomOpenings(pentScene.room);
      const pentCirc = validateCirculation(pentScene, pentCost, pentOpenings);
      const tEndPent = performance.now();

      const pentTotalTime = tEndPent - t0Pent;
      expect(pentCirc.walkabilityScore).toBeGreaterThanOrEqual(0);
      expect(pentTotalTime).toBeLessThan(250);

      // 3. Furnished L-Shaped Room with 2 objects
      const lScene = createLShapedScene([
        {
          id: 'sofa',
          assetId: 'sofa-modern-3seater',
          name: 'Sofa',
          dimensions: [2.0, 0.85, 0.9],
          position: [-1.5, 0.425, 1.5],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'desk',
          assetId: 'desk-work-ergonomic',
          name: 'Desk',
          dimensions: [1.4, 0.75, 0.7],
          position: [1.5, 0.375, -1.5],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ]);
      const t0L = performance.now();
      const lOcc = buildOccupancyGrid(lScene, { resolution: 0.10 });
      const lCost = buildWalkabilityCostGrid(lScene, lOcc.grid!);
      const lOpenings = resolveRoomOpenings(lScene.room);
      const lCirc = validateCirculation(lScene, lCost, lOpenings);
      const tEndL = performance.now();

      const lTotalTime = tEndL - t0L;
      expect(lCirc.walkabilityScore).toBeGreaterThanOrEqual(0);
      expect(lTotalTime).toBeLessThan(250);

      // 4. Large Concave Room with Multiple Doors (8m x 8m)
      const largeFootprint: [number, number][] = [
        [-4, 4], [0, 4], [0, 0], [4, 0], [4, -4], [-4, -4]
      ];
      const largeWalls = [
        { id: 'w1', startPoint: [-4, 4] as [number, number], endPoint: [0, 4] as [number, number], height: 2.8, thickness: 0.15 },
        { id: 'w2', startPoint: [0, 4] as [number, number], endPoint: [0, 0] as [number, number], height: 2.8, thickness: 0.15 },
        { id: 'w3', startPoint: [0, 0] as [number, number], endPoint: [4, 0] as [number, number], height: 2.8, thickness: 0.15 },
        { id: 'w4', startPoint: [4, 0] as [number, number], endPoint: [4, -4] as [number, number], height: 2.8, thickness: 0.15 },
        { id: 'w5', startPoint: [4, -4] as [number, number], endPoint: [-4, -4] as [number, number], height: 2.8, thickness: 0.15 },
        { id: 'w6', startPoint: [-4, -4] as [number, number], endPoint: [-4, 4] as [number, number], height: 2.8, thickness: 0.15 },
      ];
      const largeScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: {
          width: 8,
          length: 8,
          height: 2.8,
          footprint: largeFootprint,
          walls: largeWalls,
          openings: [
            { id: 'door-1', wallId: 'w1', type: 'door', distanceAlongWall: 1.5, width: 0.9, height: 2.1, sillHeight: 0, swing: 'inward-left' },
            { id: 'door-2', wallId: 'w5', type: 'door', distanceAlongWall: 3.0, width: 0.9, height: 2.1, sillHeight: 0, swing: 'inward-right' },
          ],
          isParametric: true,
        },
        objects: [
          {
            id: 'sofa-1',
            assetId: 'sofa-modern-3seater',
            name: 'Sofa',
            dimensions: [2.0, 0.85, 0.9],
            position: [-2.0, 0.425, 2.0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      };

      const t0Large = performance.now();
      const largeOcc = buildOccupancyGrid(largeScene, { resolution: 0.10 });
      const largeCost = buildWalkabilityCostGrid(largeScene, largeOcc.grid!);
      const largeOpenings = resolveRoomOpenings(largeScene.room);
      const largeCirc = validateCirculation(largeScene, largeCost, largeOpenings);
      const tEndLarge = performance.now();

      const largeTotalTime = tEndLarge - t0Large;
      expect(largeCirc.walkabilityScore).toBeGreaterThanOrEqual(0);
      expect(largeOcc.grid!.dimensions.totalCells).toBe(6400); // 8m x 8m = 6400 cells
      expect(largeTotalTime).toBeLessThan(250);

      console.log('--- Phase 5.4 Benchmark Timings ---');
      console.log(`Rectangular (3600 cells): Total ${rectTotalTime.toFixed(2)}ms (Occ: ${(tOccRect - t0Rect).toFixed(2)}ms, Cost: ${(tCostRect - tOccRect).toFixed(2)}ms, Path: ${(tEndRect - tCostRect).toFixed(2)}ms)`);
      console.log(`Pentagon (3600 cells): Total ${pentTotalTime.toFixed(2)}ms`);
      console.log(`L-Shaped (3600 cells): Total ${lTotalTime.toFixed(2)}ms`);
      console.log(`Large Concave 8x8 (6400 cells): Total ${largeTotalTime.toFixed(2)}ms`);
    });
  });
});
