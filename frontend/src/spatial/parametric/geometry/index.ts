import type { RoomDimensions } from '../../../types/scene';
import type { ParametricRoom } from '../parametricTypes';
import { getCanonicalRoomGeometry } from '../roomGeometry';
import { buildFloorGeometry } from './floorGeometryBuilder';
import { buildAllWallsGeometry } from './wallGeometryBuilder';
import type { ProceduralRoomGeometries, WallGeometryResult, FloorGeometryResult } from './geometryTypes';

export * from './geometryTypes';
export * from './wallSectionBuilder';
export * from './wallGeometryBuilder';
export * from './floorGeometryBuilder';

/**
 * Builds the complete suite of procedural 3D geometries (floor, walls, openings)
 * for a canonical or legacy room model.
 */
export function buildProceduralRoomGeometries(
  room: RoomDimensions | ParametricRoom
): ProceduralRoomGeometries {
  // Convert or extract canonical parametric representation
  const canonical = 'footprint' in room && Array.isArray(room.footprint) && room.footprint.length >= 3 && 'walls' in room && Array.isArray(room.walls) && room.walls.length >= 3
    ? (room as ParametricRoom)
    : getCanonicalRoomGeometry(room as RoomDimensions);

  const floorResult: FloorGeometryResult = buildFloorGeometry(
    canonical.footprint,
    canonical.height
  );

  const wallResults: WallGeometryResult[] = buildAllWallsGeometry(
    canonical.walls,
    canonical.openings || [],
    canonical.height,
    canonical.defaultThickness ?? 0.15
  );

  const allDiagnostics = [
    ...floorResult.diagnostics,
    ...wallResults.flatMap((w) => w.diagnostics),
  ];

  return {
    floor: floorResult,
    walls: wallResults,
    diagnostics: allDiagnostics,
  };
}

