import { describe, it, expect } from 'vitest';
import type { CanonicalScene, FurniturePlacement, RoomDimensions } from '../../types/scene';
import {
  DEFAULT_GRID_CONFIG,
  computeGridDimensions,
  worldToGrid,
  gridToWorldBounds,
  gridToWorldCenter,
  cellIndex,
  indexToCellCoordinate,
  isValidCell,
  getFurnitureFootprint2D,
  testAABBPolygonIntersection,
  buildOccupancyGrid,
} from '../occupancy';

describe('Phase 4.1: Occupancy Grid Foundation', () => {
  const standardRoom: RoomDimensions = { width: 6.0, length: 6.0, height: 2.8 };

  const createFurniture = (
    id: string,
    dimensions: [number, number, number],
    position: [number, number, number],
    rotationEuler: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1]
  ): FurniturePlacement => ({
    id,
    assetId: `asset-${id}`,
    name: `Item ${id}`,
    dimensions,
    position,
    rotationEuler,
    scale,
  });

  describe('1. Grid Coordinate Conversion & Boundary Math', () => {
    it('computes symmetric grid dimensions for standard room', () => {
      const dims = computeGridDimensions(standardRoom, DEFAULT_GRID_CONFIG);
      expect(dims.numCols).toBe(60); // 6.0m / 0.1m = 60 columns
      expect(dims.numRows).toBe(60); // 6.0m / 0.1m = 60 rows
      expect(dims.totalCells).toBe(3600);
      expect(dims.minX).toBe(-3.0);
      expect(dims.maxX).toBe(3.0);
      expect(dims.minZ).toBe(-3.0);
      expect(dims.maxZ).toBe(3.0);
    });

    it('maps world origin (0, 0) to center grid cell', () => {
      const dims = computeGridDimensions(standardRoom, DEFAULT_GRID_CONFIG);
      const coord = worldToGrid(0, 0, dims);
      expect(coord).not.toBeNull();
      // In 60x60 grid with origin at center:
      // minX = -3.0. (0 - (-3)) / 0.1 = 30. col = 30, row = 30.
      expect(coord?.col).toBe(30);
      expect(coord?.row).toBe(30);

      const center = gridToWorldCenter(coord!.col, coord!.row, dims);
      // Cell 30 spans [0.0, 0.1], so center is [0.05, 0.05]
      expect(center[0]).toBeCloseTo(0.05, 2);
      expect(center[1]).toBeCloseTo(0.05, 2);
    });

    it('correctly maps negative and positive extremes', () => {
      const dims = computeGridDimensions(standardRoom, DEFAULT_GRID_CONFIG);

      // Northwest corner (-3, -3) -> col 0, row 0
      const nw = worldToGrid(-2.95, -2.95, dims);
      expect(nw).toEqual({ col: 0, row: 0 });

      // Southeast corner (+3, +3) -> clamped into last cell (59, 59)
      const se = worldToGrid(2.95, 2.95, dims);
      expect(se).toEqual({ col: 59, row: 59 });

      // Exact upper bound (+3.0, +3.0) clamps to cell (59, 59)
      const exactBound = worldToGrid(3.0, 3.0, dims);
      expect(exactBound).toEqual({ col: 59, row: 59 });
    });

    it('returns null for coordinates strictly outside room boundaries', () => {
      const dims = computeGridDimensions(standardRoom, DEFAULT_GRID_CONFIG);
      expect(worldToGrid(-3.05, 0, dims)).toBeNull(); // Beyond minX
      expect(worldToGrid(3.05, 0, dims)).toBeNull();  // Beyond maxX
      expect(worldToGrid(0, -3.1, dims)).toBeNull();  // Beyond minZ
      expect(worldToGrid(0, 3.5, dims)).toBeNull();   // Beyond maxZ
    });

    it('handles non-divisible room dimensions and clips partial edge cells', () => {
      // Room 4.35m x 5.25m with 0.10m cells
      const oddRoom: RoomDimensions = { width: 4.35, length: 5.25, height: 2.8 };
      const dims = computeGridDimensions(oddRoom, DEFAULT_GRID_CONFIG);

      expect(dims.numCols).toBe(44); // ceil(4.35 / 0.1) = 44
      expect(dims.numRows).toBe(53); // ceil(5.25 / 0.1) = 53
      expect(dims.minX).toBeCloseTo(-2.175, 3);
      expect(dims.maxX).toBeCloseTo(2.175, 3);
      expect(dims.minZ).toBeCloseTo(-2.625, 3);
      expect(dims.maxZ).toBeCloseTo(2.625, 3);

      // Verify the final column is clipped to maxX
      const lastColBounds = gridToWorldBounds(43, 0, dims);
      expect(lastColBounds.maxX).toBeCloseTo(2.175, 3);
      expect(lastColBounds.isPartialEdge).toBe(true);

      // Verify inner cell has nominal resolution and is not partial edge
      const innerCellBounds = gridToWorldBounds(10, 10, dims);
      expect(innerCellBounds.maxX - innerCellBounds.minX).toBeCloseTo(0.10, 3);
      expect(innerCellBounds.isPartialEdge).toBe(false);
    });

    it('supports custom configurable resolutions (e.g. 5cm and 25cm)', () => {
      const fineConfig = { resolution: 0.05 };
      const fineDims = computeGridDimensions(standardRoom, fineConfig);
      expect(fineDims.numCols).toBe(120); // 6.0 / 0.05 = 120
      expect(fineDims.totalCells).toBe(14400);

      const coarseConfig = { resolution: 0.25 };
      const coarseDims = computeGridDimensions(standardRoom, coarseConfig);
      expect(coarseDims.numCols).toBe(24); // 6.0 / 0.25 = 24
      expect(coarseDims.totalCells).toBe(576);
    });

    it('validates 1D index and 2D coordinate roundtrip conversions', () => {
      const numCols = 60;
      const originalCol = 27;
      const originalRow = 43;

      const idx = cellIndex(originalCol, originalRow, numCols);
      expect(idx).toBe(43 * 60 + 27);

      const coord = indexToCellCoordinate(idx, numCols);
      expect(coord.col).toBe(originalCol);
      expect(coord.row).toBe(originalRow);

      const dims = computeGridDimensions(standardRoom, DEFAULT_GRID_CONFIG);
      expect(isValidCell(originalCol, originalRow, dims)).toBe(true);
      expect(isValidCell(60, 10, dims)).toBe(false);
      expect(isValidCell(10, 60, dims)).toBe(false);
      expect(isValidCell(-1, 0, dims)).toBe(false);
    });
  });

  describe('2. Transformed Footprint & 2D Rasterization', () => {
    it('rasterizes an unrotated rectangular sofa onto expected cells', () => {
      // 2.0m wide (X) x 1.0m deep (Z) sofa centered at origin [0, 0.45, 0]
      const sofa = createFurniture('sofa-1', [2.0, 0.9, 1.0], [0, 0.45, 0]);
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [sofa],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);
      expect(result.grid).toBeDefined();

      const grid = result.grid!;
      const occupiedCoords = grid.objectOccupancyMap['sofa-1'];
      expect(occupiedCoords).toBeDefined();
      expect(occupiedCoords.length).toBeGreaterThan(0);

      // Footprint spans X: [-1.0, 1.0] (21 cells incl. touching borders: cols 20..40),
      // and Z: [-0.5, 0.5] (11 cells incl. touching borders: rows 25..35).
      // Exact intersection count: 21 * 11 = 231 cells
      expect(occupiedCoords.length).toBe(231);

      // Verify cell metadata
      const sampleCoord = occupiedCoords[0];
      const cellIdx = cellIndex(sampleCoord.col, sampleCoord.row, grid.dimensions.numCols);
      const cell = grid.cells[cellIdx];
      expect(cell.isOccupied).toBe(true);
      expect(cell.occupyingObjectIds).toContain('sofa-1');
    });

    it('accurately rasterizes rotated furniture footprint', () => {
      // 2.0m x 0.8m sofa rotated 45 degrees
      const unrotatedSofa = createFurniture('sofa-straight', [2.0, 0.9, 0.8], [0, 0.45, 0], [0, 0, 0]);
      const rotatedSofa = createFurniture('sofa-rotated', [2.0, 0.9, 0.8], [0, 0.45, 0], [0, Math.PI / 4, 0]);

      const polyStraight = getFurnitureFootprint2D(unrotatedSofa);
      const polyRotated = getFurnitureFootprint2D(rotatedSofa);

      expect(polyStraight.length).toBe(4);
      expect(polyRotated.length).toBe(4);

      // 45 degree rotation of a 2x0.8 rectangle produces larger bounding extents:
      // X span: 2.0*cos(45) + 0.8*sin(45) ≈ 1.414 + 0.565 = 1.98m on each side
      let rotMinX = Infinity, rotMaxX = -Infinity;
      for (const [x] of polyRotated) {
        if (x < rotMinX) rotMinX = x;
        if (x > rotMaxX) rotMaxX = x;
      }
      expect(rotMaxX - rotMinX).toBeGreaterThan(1.9);

      // Rasterize rotated sofa
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [rotatedSofa],
      };
      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);

      const grid = result.grid!;
      const occupiedCoords = grid.objectOccupancyMap['sofa-rotated'];
      expect(occupiedCoords.length).toBeGreaterThan(0);

      // A corner cell outside the 45-degree diamond should NOT be marked occupied
      // e.g. point (rotMaxX - 0.05, rotMaxZ - 0.05) is in the AABB corner but outside the diamond
      const cellAtAabbCorner = worldToGrid(rotMaxX - 0.05, rotMaxX - 0.05, grid.dimensions);
      if (cellAtAabbCorner) {
        const idx = cellIndex(cellAtAabbCorner.col, cellAtAabbCorner.row, grid.dimensions.numCols);
        expect(grid.cells[idx].isOccupied).toBe(false);
      }
    });

    it('respects non-uniform scaling during footprint rasterization', () => {
      // 1.0m x 1.0m base dimensions scaled non-uniformly [2.0, 1.0, 0.5] -> 2.0m x 0.5m
      const scaledItem = createFurniture(
        'scaled-item',
        [1.0, 0.8, 1.0],
        [0, 0.4, 0],
        [0, 0, 0],
        [2.0, 1.0, 0.5]
      );

      const footprint = getFurnitureFootprint2D(scaledItem);
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of footprint) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }

      // X dimension should be 2.0m (halfSize 1.0m)
      expect(maxX - minX).toBeCloseTo(2.0, 2);
      // Z dimension should be 0.5m (halfSize 0.25m)
      expect(maxZ - minZ).toBeCloseTo(0.5, 2);
    });

    it('accurately evaluates AABB and polygon intersection with SAT', () => {
      const cellBounds = { minX: 0.0, maxX: 0.1, minZ: 0.0, maxZ: 0.1 };

      // Overlapping polygon
      const overlappingPoly: Array<[number, number]> = [
        [0.05, 0.05],
        [0.20, 0.05],
        [0.20, 0.20],
        [0.05, 0.20],
      ];
      expect(testAABBPolygonIntersection(cellBounds, overlappingPoly)).toBe(true);

      // Disjoint polygon
      const disjointPoly: Array<[number, number]> = [
        [0.50, 0.50],
        [0.70, 0.50],
        [0.70, 0.70],
        [0.50, 0.70],
      ];
      expect(testAABBPolygonIntersection(cellBounds, disjointPoly)).toBe(false);
    });

    it('detects a small furniture item occupying only part of a cell without missing it', () => {
      // Small 0.05m x 0.05m decor item (smaller than nominal 0.10m cell)
      const smallItem = createFurniture('small-vase', [0.05, 0.1, 0.05], [0.25, 0.05, 0.25]);
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [smallItem],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);

      const occupied = result.grid!.objectOccupancyMap['small-vase'];
      expect(occupied.length).toBeGreaterThanOrEqual(1);

      const targetCoord = worldToGrid(0.25, 0.25, result.grid!.dimensions)!;
      const idx = cellIndex(targetCoord.col, targetCoord.row, result.grid!.dimensions.numCols);
      expect(result.grid!.cells[idx].isOccupied).toBe(true);
      expect(result.grid!.cells[idx].occupyingObjectIds).toContain('small-vase');
    });

    it('preserves all object IDs when multiple furniture objects overlap the same cell', () => {
      // Two overlapping items at center
      const rug = createFurniture('rug-1', [2.0, 0.02, 2.0], [0, 0.01, 0]);
      const table = createFurniture('table-1', [1.0, 0.4, 1.0], [0, 0.2, 0]);

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [rug, table],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);

      const centerCoord = worldToGrid(0, 0, result.grid!.dimensions)!;
      const cell = result.grid!.cells[cellIndex(centerCoord.col, centerCoord.row, result.grid!.dimensions.numCols)];

      expect(cell.isOccupied).toBe(true);
      expect(cell.occupyingObjectIds).toContain('rug-1');
      expect(cell.occupyingObjectIds).toContain('table-1');
      expect(cell.occupyingObjectIds.length).toBe(2);
    });

    it('clips furniture overlapping the room edge to valid room cells only', () => {
      // Item positioned at the eastern room wall [3.0, 0.4, 0.0] with 1.0m width
      // Half of it extends outside room [2.5 to 3.5]
      const wallItem = createFurniture('wall-item', [1.0, 0.8, 1.0], [3.0, 0.4, 0.0]);
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [wallItem],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);

      const coords = result.grid!.objectOccupancyMap['wall-item'];
      // Every occupied cell must have valid column index within [0, numCols - 1]
      for (const coord of coords) {
        expect(coord.col).toBeLessThan(result.grid!.dimensions.numCols);
        expect(coord.col).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles furniture completely outside the room without invalid indices', () => {
      const outsideItem = createFurniture('outside-item', [1.0, 1.0, 1.0], [10.0, 0.5, 10.0]);
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [outsideItem],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);
      expect(result.grid!.objectOccupancyMap['outside-item']).toEqual([]);
      expect(result.grid!.occupiedCount).toBe(0);
    });
  });

  describe('3. Scene Integration & Fault Tolerance', () => {
    it('generates completely free grid for an empty room', () => {
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);
      expect(result.grid!.occupiedCount).toBe(0);
      expect(result.grid!.freeCount).toBe(3600);
      expect(result.grid!.cells.every((c) => !c.isOccupied)).toBe(true);
    });

    it('gracefully handles malformed geometry without crashing and logs diagnostics', () => {
      const validSofa = createFurniture('valid-sofa', [2.0, 0.9, 0.9], [0, 0.45, 0]);
      const nanItem = createFurniture('nan-item', [1.0, 1.0, 1.0], [NaN, 0, 0] as any);
      const zeroDimItem = createFurniture('zero-dim', [0, 1.0, 1.0] as any, [1, 0.5, 1]);

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [validSofa, nanItem, zeroDimItem],
      };

      const result = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      expect(result.success).toBe(true);
      expect(result.diagnostics?.ignoredObjects.length).toBe(2);
      expect(result.diagnostics?.ignoredObjects.map((d) => d.id)).toContain('nan-item');
      expect(result.diagnostics?.ignoredObjects.map((d) => d.id)).toContain('zero-dim');

      // Valid sofa was still rasterized cleanly
      expect(result.grid!.objectOccupancyMap['valid-sofa'].length).toBeGreaterThan(0);
    });

    it('rejects invalid room dimensions with clear error', () => {
      const invalidScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: -5.0, length: 4.0, height: 2.8 },
        objects: [],
      } as any;

      const result = buildOccupancyGrid(invalidScene);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid room width/i);
    });

    it('maintains compatibility with legacy scenes (no relationships or zones)', () => {
      const legacyScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [createFurniture('table-1', [1.0, 0.5, 1.0], [0, 0.25, 0])],
      };

      const result = buildOccupancyGrid(legacyScene);
      expect(result.success).toBe(true);
      expect(result.grid!.occupiedCount).toBeGreaterThan(0);
    });

    it('attached furniture relationships rasterize using actual world coordinates', () => {
      const sofa = createFurniture('sofa-1', [2.1, 0.85, 0.9], [0, 0.425, 0]);
      const table = createFurniture('table-1', [1.2, 0.45, 0.6], [0, 0.225, 1.2]);

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [sofa, table],
        relationships: [
          {
            id: 'rel-1',
            anchorObjectId: 'sofa-1',
            childObjectId: 'table-1',
            socketId: 'sofa-front-table',
            gap: 0.45,
            relativeYaw: 0,
          },
        ],
      };

      const result = buildOccupancyGrid(scene);
      expect(result.success).toBe(true);

      const sofaCoords = result.grid!.objectOccupancyMap['sofa-1'];
      const tableCoords = result.grid!.objectOccupancyMap['table-1'];

      expect(sofaCoords.length).toBeGreaterThan(0);
      expect(tableCoords.length).toBeGreaterThan(0);

      // Verify table is located around +Z = 1.2m
      const avgTableZ = tableCoords.reduce((acc, c) => acc + c.row, 0) / tableCoords.length;
      const centerRow = 30; // Row 30 corresponds to Z=0 in 60x60 grid
      expect(avgTableZ).toBeGreaterThan(centerRow);
    });

    it('does NOT mutate the input canonical scene', () => {
      const originalScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { ...standardRoom },
        objects: [createFurniture('sofa-1', [2.0, 0.9, 1.0], [0, 0.45, 0])],
      };

      const deepCopySnapshot = JSON.stringify(originalScene);
      buildOccupancyGrid(originalScene);

      expect(JSON.stringify(originalScene)).toBe(deepCopySnapshot);
    });
  });

  describe('4. Determinism & Benchmark Performance', () => {
    it('is strictly deterministic across multiple builds', () => {
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: standardRoom,
        objects: [
          createFurniture('sofa-1', [2.1, 0.85, 0.9], [0, 0.425, 0], [0, Math.PI / 6, 0]),
          createFurniture('table-1', [1.2, 0.45, 0.6], [1.0, 0.225, 1.0]),
        ],
      };

      const buildA = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);
      const buildB = buildOccupancyGrid(scene, DEFAULT_GRID_CONFIG);

      expect(buildA.success).toBe(true);
      expect(buildB.success).toBe(true);

      expect(buildA.grid!.occupiedCount).toBe(buildB.grid!.occupiedCount);
      expect(buildA.grid!.freeCount).toBe(buildB.grid!.freeCount);
      expect(buildA.grid!.objectOccupancyMap).toEqual(buildB.grid!.objectOccupancyMap);

      // Verify all cell flags match
      for (let i = 0; i < buildA.grid!.cells.length; i++) {
        expect(buildA.grid!.cells[i].isOccupied).toBe(buildB.grid!.cells[i].isOccupied);
        expect(buildA.grid!.cells[i].occupyingObjectIds).toEqual(buildB.grid!.cells[i].occupyingObjectIds);
      }
    });

    it('benchmarks a realistic furnished room layout with 8 objects', () => {
      const furnishedRoom: RoomDimensions = { width: 7.0, length: 7.0, height: 2.8 };
      const objects: FurniturePlacement[] = [
        createFurniture('sofa-3seat', [2.2, 0.85, 0.95], [0, 0.425, -1.5], [0, 0, 0]),
        createFurniture('coffee-table', [1.2, 0.45, 0.6], [0, 0.225, -0.4], [0, 0, 0]),
        createFurniture('armchair-left', [0.85, 0.85, 0.85], [-1.6, 0.425, -0.5], [0, Math.PI / 4, 0]),
        createFurniture('armchair-right', [0.85, 0.85, 0.85], [1.6, 0.425, -0.5], [0, -Math.PI / 4, 0]),
        createFurniture('media-console', [2.0, 0.5, 0.45], [0, 0.25, 2.5], [0, Math.PI, 0]),
        createFurniture('bookshelf', [1.0, 1.8, 0.35], [-3.0, 0.9, 0], [0, Math.PI / 2, 0]),
        createFurniture('floor-lamp', [0.4, 1.5, 0.4], [-2.3, 0.75, -1.8], [0, 0, 0]),
        createFurniture('dining-table', [1.6, 0.75, 0.9], [1.8, 0.375, 1.5], [0, 0, 0]),
      ];

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: furnishedRoom,
        objects,
      };

      const result = buildOccupancyGrid(scene, { resolution: 0.10 });
      expect(result.success).toBe(true);

      const grid = result.grid!;
      expect(grid.dimensions.totalCells).toBe(70 * 70); // 4900 cells
      expect(grid.occupiedCount).toBeGreaterThan(400); // Realistic occupied coverage
      expect(grid.freeCount).toBeGreaterThan(3000);   // Plentiful open circulation area
      expect(result.diagnostics?.totalObjectsRasterized).toBe(8);

      // Verify benchmark speed (must build in < 50ms)
      expect(result.diagnostics?.buildDurationMs).toBeLessThan(50);
    });
  });
});
