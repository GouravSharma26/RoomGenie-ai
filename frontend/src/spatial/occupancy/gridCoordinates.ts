import type { RoomDimensions } from '../../types/scene';
import type { 
  CellBounds, 
  CellCoordinate, 
  GridConfig, 
  GridDimensions 
} from './occupancyTypes';

/**
 * Computes grid dimensions and bounds for a room using the specified grid configuration.
 * Handles non-divisible room dimensions cleanly without expanding room bounds.
 */
export function computeGridDimensions(
  room: RoomDimensions,
  config: GridConfig
): GridDimensions {
  const resolution = config.resolution;
  const roomWidth = room.width;
  const roomLength = room.length;

  const minX = -roomWidth / 2;
  const maxX = roomWidth / 2;
  const minZ = -roomLength / 2;
  const maxZ = roomLength / 2;

  const numCols = Math.max(1, Math.ceil(roomWidth / resolution));
  const numRows = Math.max(1, Math.ceil(roomLength / resolution));

  return {
    numCols,
    numRows,
    totalCells: numCols * numRows,
    resolution,
    roomWidth,
    roomLength,
    minX: Number(minX.toFixed(4)),
    maxX: Number(maxX.toFixed(4)),
    minZ: Number(minZ.toFixed(4)),
    maxZ: Number(maxZ.toFixed(4)),
  };
}

/**
 * Converts world X/Z coordinates into a discrete grid cell coordinate [col, row].
 * Returns null if the coordinate lies outside the room boundaries.
 */
export function worldToGrid(
  worldX: number,
  worldZ: number,
  dimensions: GridDimensions
): CellCoordinate | null {
  if (
    worldX < dimensions.minX ||
    worldX > dimensions.maxX ||
    worldZ < dimensions.minZ ||
    worldZ > dimensions.maxZ
  ) {
    return null;
  }

  // Calculate raw floating-point column and row
  const rawCol = (worldX - dimensions.minX) / dimensions.resolution;
  const rawRow = (worldZ - dimensions.minZ) / dimensions.resolution;

  // Clamp right/top boundary values (e.g. worldX === maxX) into the last valid cell
  const col = Math.min(Math.floor(rawCol), dimensions.numCols - 1);
  const row = Math.min(Math.floor(rawRow), dimensions.numRows - 1);

  return {
    col: Math.max(0, col),
    row: Math.max(0, row),
  };
}

/**
 * Computes the world-space bounding box for a grid cell.
 * Edge cells are strictly clipped to actual room boundaries.
 */
export function gridToWorldBounds(
  col: number,
  row: number,
  dimensions: GridDimensions
): CellBounds & { isPartialEdge: boolean } {
  const cMinX = dimensions.minX + col * dimensions.resolution;
  const nominalMaxX = dimensions.minX + (col + 1) * dimensions.resolution;
  const cMaxX = Math.min(nominalMaxX, dimensions.maxX);

  const cMinZ = dimensions.minZ + row * dimensions.resolution;
  const nominalMaxZ = dimensions.minZ + (row + 1) * dimensions.resolution;
  const cMaxZ = Math.min(nominalMaxZ, dimensions.maxZ);

  const isPartialX = col === dimensions.numCols - 1 && Math.abs(nominalMaxX - dimensions.maxX) > 1e-4;
  const isPartialZ = row === dimensions.numRows - 1 && Math.abs(nominalMaxZ - dimensions.maxZ) > 1e-4;

  return {
    minX: Number(cMinX.toFixed(4)),
    maxX: Number(cMaxX.toFixed(4)),
    minZ: Number(cMinZ.toFixed(4)),
    maxZ: Number(cMaxZ.toFixed(4)),
    isPartialEdge: isPartialX || isPartialZ,
  };
}

/**
 * Computes the world-space center point [x, z] of a grid cell.
 */
export function gridToWorldCenter(
  col: number,
  row: number,
  dimensions: GridDimensions
): [number, number] {
  const bounds = gridToWorldBounds(col, row, dimensions);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  return [Number(cx.toFixed(4)), Number(cz.toFixed(4))];
}

/**
 * Converts 2D cell coordinates to a 1D flat array index.
 */
export function cellIndex(
  col: number,
  row: number,
  numCols: number
): number {
  return row * numCols + col;
}

/**
 * Converts a 1D flat array index back to a 2D cell coordinate.
 */
export function indexToCellCoordinate(
  index: number,
  numCols: number
): CellCoordinate {
  const row = Math.floor(index / numCols);
  const col = index % numCols;
  return { col, row };
}

/**
 * Checks whether a given (col, row) pair is within grid dimension bounds.
 */
export function isValidCell(
  col: number,
  row: number,
  dimensions: GridDimensions
): boolean {
  return col >= 0 && col < dimensions.numCols && row >= 0 && row < dimensions.numRows;
}

