import type { FurniturePlacement, RoomDimensions } from '../../types/scene';
import { createOBBFromPlacement, getOBBCorners } from '../core/geometryEngine';
import { computeGroundedY, isProperlyGrounded } from '../core/coordinateSystem';
import type { WallIdentifier } from '../core/spatialTypes';
import { isPointInPolygon, doSegmentsIntersect } from '../parametric/roomGeometry';
import { computeConvexHull2D } from '../occupancy/occupancyRasterizer';

export const BOUNDARY_TOLERANCE = 0.005; // 5mm tolerance for numerical float edge alignment

/**
 * Validates if an object's oriented bounding box is entirely within the room boundaries.
 * Supports both legacy rectangular rooms and arbitrary parametric polygonal footprints.
 * Returns an array of violated boundary identifiers.
 */
export function validateRoomBoundaries(
  placement: FurniturePlacement,
  room: RoomDimensions,
  tolerance: number = BOUNDARY_TOLERANCE
): WallIdentifier[] {
  // Guard against non-finite or non-positive room dimensions
  if (
    !room ||
    !Number.isFinite(room.width) || room.width <= 0 ||
    !Number.isFinite(room.length) || room.length <= 0 ||
    !Number.isFinite(room.height) || room.height <= 0
  ) {
    return ['left-wall', 'right-wall', 'front-wall', 'back-wall', 'ceiling', 'floor'];
  }

  // Guard against non-finite placement coordinates
  if (
    !Array.isArray(placement.position) ||
    !placement.position.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    !Array.isArray(placement.dimensions) ||
    !placement.dimensions.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  ) {
    return ['left-wall', 'right-wall', 'front-wall', 'back-wall'];
  }

  const obb = createOBBFromPlacement(placement);
  const corners = getOBBCorners(obb);
  const halfX = room.width / 2;
  const halfZ = room.length / 2;
  const height = room.height;

  const violations = new Set<WallIdentifier>();

  for (const [x, y, z] of corners) {
    if (x < -halfX - tolerance) violations.add('left-wall');
    if (x > halfX + tolerance) violations.add('right-wall');
    if (z < -halfZ - tolerance) violations.add('front-wall');
    if (z > halfZ + tolerance) violations.add('back-wall');
    if (y < 0 - tolerance) violations.add('floor');
    if (y > height + tolerance) violations.add('ceiling');
  }

  // Polygonal footprint boundary validation for parametric rooms
  if (room.footprint && room.footprint.length >= 3) {
    const footprint = room.footprint;

    // 1. Verify that all 2D floor-projected corners are strictly within the polygon footprint
    for (const [x, , z] of corners) {
      if (!isPointInPolygon([x, z], footprint, tolerance)) {
        if (x < 0) violations.add('left-wall');
        else violations.add('right-wall');
        if (z < 0) violations.add('front-wall');
        else violations.add('back-wall');
      }
    }

    // 2. Verify that horizontal footprint edges do not intersect any polygon boundary walls
    const projectedPoints = corners.map(([x, , z]) => [x, z] as [number, number]);
    const hull = computeConvexHull2D(projectedPoints);
    const numHull = hull.length;
    const numPoly = footprint.length;

    for (let h = 0; h < numHull; h++) {
      const h1 = hull[h];
      const h2 = hull[(h + 1) % numHull];

      for (let p = 0; p < numPoly; p++) {
        const p1 = footprint[p];
        const p2 = footprint[(p + 1) % numPoly];

        if (doSegmentsIntersect(h1, h2, p1, p2)) {
          violations.add('left-wall');
          break;
        }
      }
    }
  }

  return Array.from(violations);
}

/**
 * Validates whether an object is properly grounded on the floor (Y = effectiveHeight / 2).
 */
export function validateFloorGrounding(
  placement: FurniturePlacement,
  tolerance: number = 0.02
): { isGrounded: boolean; expectedY: number; currentY: number; warning?: string } {
  const currentY = placement.position?.[1];
  const height = placement.dimensions?.[1];
  const scaleY = placement.scale?.[1] ?? 1.0;

  if (
    typeof currentY !== 'number' ||
    !Number.isFinite(currentY) ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    const fallbackExpected = computeGroundedY(height, scaleY);
    return {
      isGrounded: false,
      expectedY: fallbackExpected,
      currentY: typeof currentY === 'number' ? currentY : 0,
      warning: `Object "${placement.name}" has invalid height or vertical position.`,
    };
  }

  const expectedY = computeGroundedY(height, scaleY);
  const isGrounded = isProperlyGrounded(currentY, height, scaleY, tolerance);

  let warning: string | undefined;
  if (!isGrounded) {
    if (currentY > expectedY) {
      warning = `Object "${placement.name}" is floating ${(currentY - expectedY).toFixed(2)}m above the floor.`;
    } else {
      warning = `Object "${placement.name}" is sunken ${(expectedY - currentY).toFixed(2)}m into the floor.`;
    }
  }

  return { isGrounded, expectedY, currentY, warning };
}

/**
 * Convenience helper returning true if the placement is strictly within room boundaries.
 */
export function isWithinRoom(
  placement: FurniturePlacement,
  room: RoomDimensions,
  tolerance: number = BOUNDARY_TOLERANCE
): boolean {
  return validateRoomBoundaries(placement, room, tolerance).length === 0;
}
