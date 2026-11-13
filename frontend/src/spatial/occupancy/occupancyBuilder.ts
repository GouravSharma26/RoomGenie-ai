import type { CanonicalScene } from '../../types/scene';
import type { 
  GridCell, 
  GridConfig, 
  OccupancyBuildResult, 
  OccupancyGrid 
} from './occupancyTypes';
import { validateGridConfig, validateOccupancyRoom } from './gridConfig';
import { 
  cellIndex, 
  computeGridDimensions, 
  gridToWorldBounds, 
  gridToWorldCenter 
} from './gridCoordinates';
import { rasterizePlacements } from './occupancyRasterizer';
import { getCanonicalRoomGeometry, isPointInPolygon } from '../parametric/roomGeometry';

/**
 * Builds an immutable 2D Occupancy Grid representation of a canonical scene.
 * 
 * Converts the continuous room floor and transformed 3D furniture into
 * discrete 2D grid cells with exact footprint coverage and obstacle tracking.
 * Supports both legacy rectangular rooms and arbitrary polygonal footprints.
 * 
 * Deterministic and side-effect free. Does not mutate the input scene.
 * 
 * @param scene Canonical RoomGenie AI scene containing room and furniture placements
 * @param config Optional grid configuration (resolution, defaults to 0.10m / 10cm)
 * @returns OccupancyBuildResult containing the generated grid and performance diagnostics
 */
export function buildOccupancyGrid(
  scene: CanonicalScene,
  config?: Partial<GridConfig>
): OccupancyBuildResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. Validate scene presence
  if (!scene || typeof scene !== 'object') {
    return {
      success: false,
      error: 'Canonical scene must be provided.',
    };
  }

  // 2. Validate room dimensions
  const roomValidation = validateOccupancyRoom(scene.room);
  if (!roomValidation.valid || !roomValidation.dimensions) {
    return {
      success: false,
      error: roomValidation.error || 'Invalid room dimensions.',
    };
  }

  // 3. Validate and resolve grid config
  const configValidation = validateGridConfig(config);
  if (!configValidation.valid) {
    return {
      success: false,
      error: configValidation.error || 'Invalid grid configuration.',
    };
  }
  const resolvedConfig = configValidation.config;

  // 4. Compute grid dimensions & resolve authoritative parametric room footprint
  const canonicalRoom = getCanonicalRoomGeometry(scene.room);
  const footprint = canonicalRoom.footprint;
  const dimensions = computeGridDimensions(scene.room, resolvedConfig);

  // 5. Initialize cell array with exact point-in-polygon classification
  const cells: GridCell[] = new Array(dimensions.totalCells);
  for (let r = 0; r < dimensions.numRows; r++) {
    for (let c = 0; c < dimensions.numCols; c++) {
      const idx = cellIndex(c, r, dimensions.numCols);
      const bounds = gridToWorldBounds(c, r, dimensions);
      const center = gridToWorldCenter(c, r, dimensions);
      const isInside = isPointInPolygon(center, footprint);

      cells[idx] = {
        col: c,
        row: r,
        index: idx,
        center,
        bounds: {
          minX: bounds.minX,
          maxX: bounds.maxX,
          minZ: bounds.minZ,
          maxZ: bounds.maxZ,
        },
        isInsideRoom: isInside,
        isOccupied: false,
        occupyingObjectIds: [],
        isPartialEdge: bounds.isPartialEdge,
      };
    }
  }

  // 6. Rasterize furniture placements
  const placements = Array.isArray(scene.objects) ? scene.objects : [];
  const { objectOccupancyMap, ignoredObjects } = rasterizePlacements(
    placements,
    cells,
    dimensions
  );

  // 7. Calculate occupied and free cell counts
  let totalOccupiedCells = 0;
  let totalFreeCells = 0;
  for (const cell of cells) {
    if (cell.isOccupied) {
      totalOccupiedCells++;
    } else if (cell.isInsideRoom) {
      totalFreeCells++;
    }
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const buildDurationMs = Number((endTime - startTime).toFixed(3));

  const grid: OccupancyGrid = {
    dimensions,
    config: resolvedConfig,
    cells,
    occupiedCount: totalOccupiedCells,
    freeCount: totalFreeCells,
    objectOccupancyMap,
  };

  return {
    success: true,
    grid,
    diagnostics: {
      ignoredObjects,
      buildDurationMs,
      totalObjectsRasterized: placements.length - ignoredObjects.length,
    },
  };
}

