import type { CanonicalScene, RoomDimensions } from '../../types/scene';
import { createExpandedOBB, createOBBFromPlacement, getOBBCorners } from '../core/geometryEngine';
import { computeConvexHull2D, testAABBPolygonIntersection } from './occupancyRasterizer';
import { cellIndex, gridToWorldBounds, worldToGrid } from './gridCoordinates';
import type { OccupancyGrid } from './occupancyTypes';
import type { RoomOpening, WalkabilityConfig, WalkabilityCostGrid } from './walkabilityTypes';

/**
 * Standard default walkability configuration.
 */
export const DEFAULT_WALKABILITY_CONFIG: Readonly<WalkabilityConfig> = {
  resolution: 0.10,
  pedestrianClearance: 0.25,      // 25cm safety buffer around obstacles
  minCorridorWidth: 0.70,         // 70cm comfortable human shoulder passage
  criticalCorridorWidth: 0.50,    // 50cm critical squeeze threshold
  defaultDoorWidth: 0.90,         // 90cm standard door opening
  doorClearanceDepth: 0.90,       // 90cm swing / entry clearance
  restrictedCostMultiplier: 3.5,  // Cost penalty for restricted transit
};

/**
 * Category-based functional clearance depths (in metres).
 * Represents operational clearance (e.g. chair legroom, drawer pull, bed access).
 */
export const CATEGORY_FUNCTIONAL_CLEARANCE: Record<string, { bufferXZ: number }> = {
  seating: { bufferXZ: 0.25 },
  tables: { bufferXZ: 0.25 },
  storage: { bufferXZ: 0.35 },
  beds: { bufferXZ: 0.40 },
  decor: { bufferXZ: 0.10 },
  lighting: { bufferXZ: 0.10 },
  office: { bufferXZ: 0.35 },
};

/**
 * Determines room openings / entrances.
 * Uses explicit openings if defined on scene, otherwise deterministically resolves a standard entrance.
 */
export function resolveRoomOpenings(
  room: RoomDimensions,
  existingOpenings?: RoomOpening[]
): RoomOpening[] {
  if (existingOpenings && existingOpenings.length > 0) {
    return existingOpenings;
  }

  // Standard architectural entrance: Center of South Wall (+Z)
  const doorWidth = 0.90;
  const doorClearanceDepth = 0.90;
  const southZ = room.length / 2;

  const defaultDoor: RoomOpening = {
    id: 'room-main-entrance',
    wall: 'south',
    center: [0, southZ],
    width: doorWidth,
    clearanceDepth: doorClearanceDepth,
    swingDirection: 'inward',
    accessPoint: [0, Math.max(southZ - doorClearanceDepth * 0.5, 0)],
  };

  return [defaultDoor];
}

/**
 * Computes a multi-source Breadth-First Euclidean Distance Field from obstacles and walls.
 * Returns distance in metres from each cell center to nearest blocked cell.
 */
function computeDistanceField(
  dimensions: { numCols: number; numRows: number },
  resolution: number,
  isBlockedOrWall: boolean[]
): Float32Array {
  const total = dimensions.numCols * dimensions.numRows;
  const distances = new Float32Array(total);
  distances.fill(Infinity);

  const queue: number[] = [];

  // Seed queue with all obstacle / wall cells
  for (let i = 0; i < total; i++) {
    if (isBlockedOrWall[i]) {
      distances[i] = 0;
      queue.push(i);
    }
  }

  // 8-neighbour offsets (colOffset, rowOffset, distanceStep)
  const sqrt2 = Math.SQRT2;
  const neighbors = [
    [-1, 0, 1.0],
    [1, 0, 1.0],
    [0, -1, 1.0],
    [0, 1, 1.0],
    [-1, -1, sqrt2],
    [-1, 1, sqrt2],
    [1, -1, sqrt2],
    [1, 1, sqrt2],
  ];

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const col = idx % dimensions.numCols;
    const row = Math.floor(idx / dimensions.numCols);
    const currDist = distances[idx];

    for (const [dc, dr, weight] of neighbors) {
      const nc = col + dc;
      const nr = row + dr;

      if (nc >= 0 && nc < dimensions.numCols && nr >= 0 && nr < dimensions.numRows) {
        const nIdx = nr * dimensions.numCols + nc;
        const stepDist = currDist + weight * resolution;
        if (stepDist < distances[nIdx]) {
          distances[nIdx] = stepDist;
          queue.push(nIdx);
        }
      }
    }
  }

  return distances;
}

/**
 * Builds the comprehensive WalkabilityCostGrid from a CanonicalScene and OccupancyGrid.
 */
export function buildWalkabilityCostGrid(
  scene: CanonicalScene,
  occupancyGrid: OccupancyGrid,
  customConfig?: Partial<WalkabilityConfig>,
  categoryLookup: Record<string, string> = {}
): WalkabilityCostGrid {
  const config: WalkabilityConfig = {
    ...DEFAULT_WALKABILITY_CONFIG,
    ...customConfig,
    resolution: occupancyGrid.config.resolution,
  };

  const { dimensions } = occupancyGrid;
  const totalCells = dimensions.numCols * dimensions.numRows;

  const costs = new Float32Array(totalCells);
  const classifications: WalkabilityCostGrid['classifications'] = new Array(totalCells);
  const cellFurnitureIds: string[][] = Array.from({ length: totalCells }, () => []);
  const blockedIndices: number[] = [];
  const restrictedIndices: number[] = [];
  const isBlockedOrWall = new Array<boolean>(totalCells).fill(false);

  // 1. Initialize from physical occupancy grid
  for (let i = 0; i < totalCells; i++) {
    const cell = occupancyGrid.cells[i];
    cellFurnitureIds[i] = [...cell.occupyingObjectIds];

    if (!cell.isInsideRoom) {
      classifications[i] = 'out_of_bounds';
      costs[i] = Infinity;
      isBlockedOrWall[i] = true;
    } else if (cell.isOccupied) {
      classifications[i] = 'blocked';
      costs[i] = Infinity;
      isBlockedOrWall[i] = true;
      blockedIndices.push(i);
    } else {
      classifications[i] = 'free';
      costs[i] = 1.0; // Base traversal cost
    }
  }

  // 2. Mark perimeter room walls as obstacles in distance field
  for (let c = 0; c < dimensions.numCols; c++) {
    isBlockedOrWall[c] = true; // North wall
    isBlockedOrWall[(dimensions.numRows - 1) * dimensions.numCols + c] = true; // South wall
  }
  for (let r = 0; r < dimensions.numRows; r++) {
    isBlockedOrWall[r * dimensions.numCols] = true; // West wall
    isBlockedOrWall[r * dimensions.numCols + (dimensions.numCols - 1)] = true; // East wall
  }

  // 3. Compute Euclidean Distance Transform from obstacles and walls
  const obstacleDistances = computeDistanceField(
    dimensions,
    config.resolution,
    isBlockedOrWall
  );

  // 4. Apply pedestrian safety margin around hard obstacles
  const pedClearance = config.pedestrianClearance;
  for (let i = 0; i < totalCells; i++) {
    if (classifications[i] !== 'free') continue;

    const dist = obstacleDistances[i];
    if (dist < pedClearance) {
      classifications[i] = 'restricted';
      restrictedIndices.push(i);
      // Continuous cost penalty as you approach an obstacle
      const proximityFactor = Math.max(0, (pedClearance - dist) / pedClearance);
      costs[i] = 1.0 + proximityFactor * config.restrictedCostMultiplier * 2.5;
    }
  }

  // 5. Rasterize functional furniture clearances (drawers, seating legroom, bed egress)
  for (const obj of scene.objects) {
    const cat = categoryLookup[obj.assetId] || 'decor';
    const clearanceDef = CATEGORY_FUNCTIONAL_CLEARANCE[cat] || { bufferXZ: 0.15 };

    const baseOBB = createOBBFromPlacement(obj);
    const expandedOBB = createExpandedOBB(baseOBB, clearanceDef.bufferXZ, 0);
    const corners = getOBBCorners(expandedOBB);
    const hull2D = computeConvexHull2D(corners.map((v) => [v[0], v[2]] as [number, number]));

    // Compute bounding cells for this expanded footprint
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of hull2D) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }

    const minCoord = worldToGrid(minX, minZ, dimensions);
    const maxCoord = worldToGrid(maxX, maxZ, dimensions);

    if (minCoord && maxCoord) {
      for (let r = minCoord.row; r <= maxCoord.row; r++) {
        for (let c = minCoord.col; c <= maxCoord.col; c++) {
          const idx = cellIndex(c, r, dimensions.numCols);
          if (idx < 0 || idx >= totalCells) continue;

          // Don't overwrite physical blocks or out_of_bounds
          if (classifications[idx] === 'blocked' || classifications[idx] === 'out_of_bounds') {
            continue;
          }

          const bounds = gridToWorldBounds(c, r, dimensions);

          if (testAABBPolygonIntersection(bounds, hull2D)) {
            if (!cellFurnitureIds[idx].includes(obj.id)) {
              cellFurnitureIds[idx].push(obj.id);
            }
            if (classifications[idx] === 'free') {
              classifications[idx] = 'restricted';
              restrictedIndices.push(idx);
            }
            // Soft penalty: comfortably traversable if necessary, but penalized
            costs[idx] = Math.max(costs[idx], 1.0 + config.restrictedCostMultiplier);
          }
        }
      }
    }
  }

  // 6. Protect Doorway / Entrance landing access point
  const openings = resolveRoomOpenings(scene.room);
  for (const door of openings) {
    const accessCoord = worldToGrid(door.accessPoint[0], door.accessPoint[1], dimensions);
    if (!accessCoord) continue;

    const landingRadiusCells = Math.ceil(0.35 / config.resolution);

    for (let dr = -landingRadiusCells; dr <= landingRadiusCells; dr++) {
      for (let dc = -landingRadiusCells; dc <= landingRadiusCells; dc++) {
        const c = accessCoord.col + dc;
        const r = accessCoord.row + dr;
        if (c < 0 || c >= dimensions.numCols || r < 0 || r >= dimensions.numRows) continue;
        const idx = cellIndex(c, r, dimensions.numCols);

        // If not physically blocked by furniture, guarantee the entrance landing is accessible
        if (classifications[idx] !== 'blocked' && classifications[idx] !== 'out_of_bounds') {
          costs[idx] = Math.min(costs[idx], 1.2); // Near base cost
        }
      }
    }
  }

  return {
    dimensions,
    config,
    costs,
    classifications,
    obstacleDistances,
    cellFurnitureIds,
    blockedIndices,
    restrictedIndices,
  };
}
