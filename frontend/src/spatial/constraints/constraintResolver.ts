import type { FurniturePlacement, RoomDimensions, Vector3Tuple } from '../../types/scene';
import { createOBBFromPlacement } from '../core/geometryEngine';
import { computeGroundedY } from '../core/coordinateSystem';
import { detectCollisions, doOBBsIntersect } from './collisionDetector';
import { validateFloorGrounding, validateRoomBoundaries } from './boundaryValidator';
import { validateClearances } from './clearanceValidator';
import type { PlacementValidation } from '../core/spatialTypes';
import { clampPositionToRoom } from '../../editor3d/validation/sceneValidation';

/**
 * Searches for the nearest collision-free and boundary-valid position
 * near a desired target coordinate.
 */
export function findNearestValidPosition(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  room: RoomDimensions,
  maxSearchRadius: number = 2.0,
  stepSize: number = 0.08
): Vector3Tuple | undefined {
  const otherObjects = allObjects.filter((o) => o.id !== target.id);
  const groundedY = computeGroundedY(target.dimensions[1], target.scale[1]);

  // First check if clamping directly to room boundaries eliminates the violation
  const clamped = clampPositionToRoom(
    target.position,
    target.dimensions,
    room,
    target.scale,
    target.rotationEuler
  );

  const candidateAtClamped: FurniturePlacement = {
    ...target,
    position: clamped,
  };

  const clampedOBB = createOBBFromPlacement(candidateAtClamped);
  const hasBoundaryViolations = validateRoomBoundaries(candidateAtClamped, room).length > 0;
  const hasCollisions = otherObjects.some((obj) =>
    doOBBsIntersect(clampedOBB, createOBBFromPlacement(obj))
  );

  if (!hasBoundaryViolations && !hasCollisions) {
    return clamped;
  }

  // Radial concentric search around target
  const steps = Math.ceil(maxSearchRadius / stepSize);
  // Test 8 angles per ring
  const angleSteps = 12;

  for (let r = 1; r <= steps; r++) {
    const radius = r * stepSize;
    for (let a = 0; a < angleSteps; a++) {
      const angle = (a * 2 * Math.PI) / angleSteps;
      const testX = clamped[0] + radius * Math.cos(angle);
      const testZ = clamped[2] + radius * Math.sin(angle);

      const candidatePlacement: FurniturePlacement = {
        ...target,
        position: [testX, groundedY, testZ],
      };

      if (validateRoomBoundaries(candidatePlacement, room).length > 0) {
        continue;
      }

      const candidateOBB = createOBBFromPlacement(candidatePlacement);
      const collides = otherObjects.some((obj) =>
        doOBBsIntersect(candidateOBB, createOBBFromPlacement(obj))
      );

      if (!collides) {
        return [
          Number(testX.toFixed(3)),
          groundedY,
          Number(testZ.toFixed(3)),
        ];
      }
    }
  }

  return undefined;
}

/**
 * Validates a furniture placement against all spatial constraints:
 * 1. Physical collisions (OBB SAT)
 * 2. Room boundaries (walls, floor, ceiling)
 * 3. Floor grounding (Y position)
 * 4. Clearance zones (ergonomic buffer)
 * 5. Suggested position resolution if invalid
 */
export function validatePlacement(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  room: RoomDimensions,
  categoryLookup: Record<string, string> = {}
): PlacementValidation {
  const collisions = detectCollisions(target, allObjects);
  const boundaryViolations = validateRoomBoundaries(target, room);
  const grounding = validateFloorGrounding(target);
  const clearanceViolations = validateClearances(target, allObjects, categoryLookup);
  const warnings: string[] = [];

  if (grounding.warning) {
    warnings.push(grounding.warning);
  }

  const isValid =
    collisions.length === 0 &&
    boundaryViolations.length === 0 &&
    grounding.isGrounded;

  let suggestedPosition: Vector3Tuple | undefined;
  if (!isValid) {
    suggestedPosition = findNearestValidPosition(target, allObjects, room);
  }

  return {
    valid: isValid,
    collisions,
    boundaryViolations,
    clearanceViolations,
    warnings,
    suggestedPosition,
  };
}
