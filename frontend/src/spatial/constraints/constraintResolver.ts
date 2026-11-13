import type { FurniturePlacement, RoomDimensions, Vector3Tuple } from '../../types/scene';
import { createExpandedOBB, createOBBFromPlacement } from '../core/geometryEngine';
import { computeGroundedY, isProperlyGrounded } from '../core/coordinateSystem';
import { detectCollisions, doOBBsIntersect } from './collisionDetector';
import { validateFloorGrounding, validateRoomBoundaries } from './boundaryValidator';
import { getClearanceRule, validateClearanceDetails } from './clearanceValidator';
import type { ClearanceOptions, PlacementValidation } from '../core/spatialTypes';
import { clampPositionToRoom } from '../../editor3d/validation/sceneValidation';

interface PreparedObstacle {
  placement: FurniturePlacement;
  category: string;
  obb: ReturnType<typeof createOBBFromPlacement>;
}

/**
 * Searches for the nearest collision-free, boundary-valid, and clearance-compliant
 * position near a desired target coordinate.
 *
 * Candidate positions are evaluated against ALL hard constraints:
 * 1. Room boundary containment
 * 2. Physical furniture collisions (OBB SAT)
 * 3. Correct floor grounding (Y = H/2)
 * 4. Mandatory clearance thresholds (e.g. egress, door opening)
 */
export function findNearestValidPosition(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  room: RoomDimensions,
  categoryLookup: Record<string, string> = {},
  maxSearchRadius: number = 2.0,
  stepSize: number = 0.08,
  clearanceOptions: ClearanceOptions = {}
): Vector3Tuple | undefined {
  const otherObjects = allObjects.filter((o) => o.id !== target.id);
  const groundedY = computeGroundedY(target.dimensions[1], target.scale[1]);
  const targetCat = categoryLookup[target.assetId] || 'decor';
  const enforceHardClearance = clearanceOptions.enforceHardClearance !== false;

  // Pre-compute obstacles to eliminate redundant OBB allocations inside concentric search
  const obstacles: PreparedObstacle[] = otherObjects.map((obj) => ({
    placement: obj,
    category: categoryLookup[obj.assetId] || 'decor',
    obb: createOBBFromPlacement(obj),
  }));

  // Helper evaluating a candidate placement against all hard constraints
  const isCandidateValid = (candidate: FurniturePlacement): boolean => {
    // 1. Boundary check
    if (validateRoomBoundaries(candidate, room).length > 0) {
      return false;
    }

    // 2. Grounding check
    if (!isProperlyGrounded(candidate.position[1], candidate.dimensions[1], candidate.scale[1])) {
      return false;
    }

    const candidateOBB = createOBBFromPlacement(candidate);

    // 3. Collision check (OBB SAT)
    for (let i = 0; i < obstacles.length; i++) {
      if (doOBBsIntersect(candidateOBB, obstacles[i].obb)) {
        return false;
      }
    }

    // 4. Mandatory clearance constraint check
    if (enforceHardClearance) {
      for (let i = 0; i < obstacles.length; i++) {
        const obs = obstacles[i];
        const rule = getClearanceRule(targetCat, obs.category, clearanceOptions.categoryRules);
        const expandedHardOBB = createExpandedOBB(candidateOBB, rule.hardMin, 0);
        if (expandedHardOBB.intersectsOBB(obs.obb)) {
          return false;
        }
      }
    }

    return true;
  };

  // Step 1: Check if clamping directly to room boundaries produces a valid placement
  const clamped = clampPositionToRoom(
    target.position,
    target.dimensions,
    room,
    target.scale,
    target.rotationEuler
  );

  const candidateAtClamped: FurniturePlacement = {
    ...target,
    position: [clamped[0], groundedY, clamped[2]],
  };

  if (isCandidateValid(candidateAtClamped)) {
    return [clamped[0], groundedY, clamped[2]];
  }

  // Step 2: Radial concentric search around target
  const steps = Math.ceil(maxSearchRadius / stepSize);
  const angleSteps = 16; // 16 radial directions for uniform isotropic search

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

      if (isCandidateValid(candidatePlacement)) {
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
 * 4. Clearance zones (hard mandatory vs soft ergonomic advisory)
 * 5. Suggested position resolution if invalid
 */
export function validatePlacement(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  room: RoomDimensions,
  categoryLookup: Record<string, string> = {},
  clearanceOptions: ClearanceOptions = {}
): PlacementValidation {
  const collisions = detectCollisions(target, allObjects);
  const boundaryViolations = validateRoomBoundaries(target, room);
  const grounding = validateFloorGrounding(target);
  const clearanceResult = validateClearanceDetails(target, allObjects, categoryLookup, clearanceOptions);
  const warnings: string[] = [];

  if (grounding.warning) {
    warnings.push(grounding.warning);
  }
  for (const softW of clearanceResult.softWarnings) {
    warnings.push(softW);
  }

  // Hard constraints: collisions, boundary breach, floor grounding, and hard clearance violations
  const isValid =
    collisions.length === 0 &&
    boundaryViolations.length === 0 &&
    grounding.isGrounded &&
    clearanceResult.hardViolations.length === 0;

  let suggestedPosition: Vector3Tuple | undefined;
  if (!isValid) {
    suggestedPosition = findNearestValidPosition(
      target,
      allObjects,
      room,
      categoryLookup,
      2.0,
      0.08,
      clearanceOptions
    );
  }

  return {
    valid: isValid,
    collisions,
    boundaryViolations,
    hardClearanceViolations: clearanceResult.hardViolations,
    clearanceViolations: clearanceResult.allViolations,
    clearanceWarnings: clearanceResult.softWarnings,
    warnings,
    suggestedPosition,
  };
}
