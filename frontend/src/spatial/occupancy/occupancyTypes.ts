/**
 * Core type definitions for the RoomGenie AI Occupancy Grid Engine.
 * 
 * Coordinate Standards:
 * - Metric units (metres).
 * - X/Z 2D horizontal floor plane representation.
 * - Room origin (0, 0) is at the geometric center of the room.
 * - Columns (col) increase along the +X axis (west to east).
 * - Rows (row) increase along the +Z axis (north to south).
 */

export type OccupancyStatus = 'free' | 'occupied' | 'out_of_bounds';

/**
 * User-configurable grid parameters.
 */
export interface GridConfig {
  /**
   * Grid cell resolution in metres (nominal cell width and length).
   * Default: 0.10m (10cm).
   */
  resolution: number;
}

/**
 * Geometric and structural dimensions of the 2D occupancy grid.
 */
export interface GridDimensions {
  /** Number of grid columns along the X axis. */
  numCols: number;
  /** Number of grid rows along the Z axis. */
  numRows: number;
  /** Total number of cells (numCols * numRows). */
  totalCells: number;
  /** Nominal cell size in metres. */
  resolution: number;
  /** Actual room width along X in metres. */
  roomWidth: number;
  /** Actual room length along Z in metres. */
  roomLength: number;
  /** World X coordinate of minimum room boundary (-roomWidth / 2). */
  minX: number;
  /** World X coordinate of maximum room boundary (+roomWidth / 2). */
  maxX: number;
  /** World Z coordinate of minimum room boundary (-roomLength / 2). */
  minZ: number;
  /** World Z coordinate of maximum room boundary (+roomLength / 2). */
  maxZ: number;
}

/**
 * 2D discrete cell coordinate.
 */
export interface CellCoordinate {
  /** Column index: 0 <= col < numCols (along +X). */
  col: number;
  /** Row index: 0 <= row < numRows (along +Z). */
  row: number;
}

/**
 * Bounding rectangle of a cell in 2D world floor space.
 */
export interface CellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Representation of an individual grid cell on the room floor.
 */
export interface GridCell {
  /** Column index (0-based along +X). */
  col: number;
  /** Row index (0-based along +Z). */
  row: number;
  /** 1D flat index: row * numCols + col. */
  index: number;
  /** Center point [x, z] in world metres. */
  center: [number, number];
  /** Bounding box in world metres. */
  bounds: CellBounds;
  /** Whether this cell is inside the room boundaries. */
  isInsideRoom: boolean;
  /** Whether any furniture footprint intersects this cell. */
  isOccupied: boolean;
  /** IDs of all furniture placements overlapping this cell. */
  occupyingObjectIds: string[];
  /** True if this edge cell was clipped because room dimension is not an exact multiple of resolution. */
  isPartialEdge: boolean;
}

/**
 * Immutable 2D Occupancy Grid derived from a canonical scene.
 */
export interface OccupancyGrid {
  /** Grid dimensions and spatial parameters. */
  dimensions: GridDimensions;
  /** Applied grid configuration. */
  config: GridConfig;
  /** 1D array of cells indexed by (row * numCols + col). */
  cells: GridCell[];
  /** Total count of cells occupied by furniture. */
  occupiedCount: number;
  /** Total count of traversable cells inside the room. */
  freeCount: number;
  /** Lookup mapping furniture object ID -> array of occupied cell coordinates. */
  objectOccupancyMap: Record<string, CellCoordinate[]>;
}

/**
 * Diagnostic information about objects skipped or issues encountered during build.
 */
export interface IgnoredObjectDiagnostic {
  id: string;
  name: string;
  reason: string;
}

/**
 * Result returned by the occupancy builder.
 */
export interface OccupancyBuildResult {
  success: boolean;
  grid?: OccupancyGrid;
  error?: string;
  diagnostics?: {
    ignoredObjects: IgnoredObjectDiagnostic[];
    buildDurationMs: number;
    totalObjectsRasterized: number;
  };
}

