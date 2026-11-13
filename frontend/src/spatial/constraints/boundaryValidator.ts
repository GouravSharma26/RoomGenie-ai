import type { FurniturePlacement, RoomDimensions } from '../../types/scene';
import { createOBBFromPlacement, getOBBCorners } from '../core/geometryEngine';
import { computeGroundedY, isProperlyGrounded } from '../core/coordinateSystem';
import type { WallIdentifier } from '../core/spatialTypes';

export const BOUNDARY_TOLERANCE = 0.005; // 5mm tolerance for numerical float edge alignment

/**
 * Validates if an object's oriented bounding box is entirely within the room boundaries.
 * Returns an array of violated boundary identifiers.
 */
export function validateRoomBoundaries(
  placement: FurniturePlacement,
  room: RoomDimensions,
  tolerance: number = BOUNDARY_TOLERANCE
): WallIdentifier[] {
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

  return Array.from(violations);
}

/**
 * Validates whether an object is properly grounded on the floor (Y = height / 2).
 */
export function validateFloorGrounding(
  placement: FurniturePlacement,
  tolerance: number = 0.02
): { isGrounded: boolean; expectedY: number; currentY: number; warning?: string } {
  const currentY = placement.position[1];
  const expectedY = computeGroundedY(placement.dimensions[1], placement.scale[1]);
  const isGrounded = isProperlyGrounded(currentY, placement.dimensions[1], placement.scale[1], tolerance);

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
