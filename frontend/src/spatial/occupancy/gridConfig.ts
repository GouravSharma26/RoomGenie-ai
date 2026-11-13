import type { RoomDimensions } from '../../types/scene';
import type { GridConfig } from './occupancyTypes';

/**
 * Default grid configuration (10cm nominal cells).
 */
export const DEFAULT_GRID_CONFIG: Readonly<GridConfig> = {
  resolution: 0.10,
};

export const MIN_GRID_RESOLUTION = 0.02; // 2cm minimum cell size
export const MAX_GRID_RESOLUTION = 2.0;  // 2m maximum cell size

export const MIN_ROOM_DIMENSION = 1.0;   // 1m minimum room dimension
export const MAX_ROOM_DIMENSION = 50.0;  // 50m maximum room dimension

/**
 * Validates and sanitizes a grid configuration.
 */
export function validateGridConfig(
  config?: unknown
): { valid: boolean; config: GridConfig; error?: string } {
  if (config === undefined || config === null) {
    return { valid: true, config: { ...DEFAULT_GRID_CONFIG } };
  }

  if (typeof config !== 'object') {
    return {
      valid: false,
      config: { ...DEFAULT_GRID_CONFIG },
      error: 'Grid configuration must be an object.',
    };
  }

  const raw = config as Partial<GridConfig>;
  const res = raw.resolution ?? DEFAULT_GRID_CONFIG.resolution;

  if (typeof res !== 'number' || !Number.isFinite(res)) {
    return {
      valid: false,
      config: { ...DEFAULT_GRID_CONFIG },
      error: `Resolution must be a finite number, received: ${String(res)}.`,
    };
  }

  if (res < MIN_GRID_RESOLUTION) {
    return {
      valid: false,
      config: { ...DEFAULT_GRID_CONFIG },
      error: `Resolution (${res}m) is below minimum allowed (${MIN_GRID_RESOLUTION}m).`,
    };
  }

  if (res > MAX_GRID_RESOLUTION) {
    return {
      valid: false,
      config: { ...DEFAULT_GRID_CONFIG },
      error: `Resolution (${res}m) exceeds maximum allowed (${MAX_GRID_RESOLUTION}m).`,
    };
  }

  return {
    valid: true,
    config: {
      resolution: Number(res.toFixed(4)),
    },
  };
}

/**
 * Validates room dimensions for occupancy grid construction.
 */
export function validateOccupancyRoom(
  room?: unknown
): { valid: boolean; error?: string; dimensions?: RoomDimensions } {
  if (!room || typeof room !== 'object') {
    return { valid: false, error: 'Room dimensions must be provided as an object.' };
  }

  const r = room as Partial<RoomDimensions>;
  const { width, length, height } = r;

  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return { valid: false, error: `Invalid room width: ${String(width)}. Must be a finite positive number.` };
  }
  if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) {
    return { valid: false, error: `Invalid room length: ${String(length)}. Must be a finite positive number.` };
  }

  const safeHeight = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 2.8;

  if (width < MIN_ROOM_DIMENSION || width > MAX_ROOM_DIMENSION) {
    return {
      valid: false,
      error: `Room width (${width}m) must be between ${MIN_ROOM_DIMENSION}m and ${MAX_ROOM_DIMENSION}m.`,
    };
  }
  if (length < MIN_ROOM_DIMENSION || length > MAX_ROOM_DIMENSION) {
    return {
      valid: false,
      error: `Room length (${length}m) must be between ${MIN_ROOM_DIMENSION}m and ${MAX_ROOM_DIMENSION}m.`,
    };
  }

  return {
    valid: true,
    dimensions: {
      width: Number(width.toFixed(4)),
      length: Number(length.toFixed(4)),
      height: Number(safeHeight.toFixed(4)),
    },
  };
}

