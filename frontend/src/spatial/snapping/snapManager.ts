import type { FurniturePlacement, RoomDimensions, Vector3Tuple } from '../../types/scene';
import { validateRoomBoundaries } from '../constraints/boundaryValidator';
import { detectCollisions } from '../constraints/collisionDetector';
import { validateClearanceDetails } from '../constraints/clearanceValidator';
import type { ClearanceOptions } from '../core/spatialTypes';
import { calculateGridSnap } from './gridSnapper';
import { calculateWallSnap } from './wallSnapper';
import { calculateAlignmentSnap } from './alignmentSnapper';
import type { 
  SnapCandidate, 
  SnapConfig, 
  SnapGuide, 
  SnapResult, 
  SnapStateTracker, 
  SnapType 
} from './snappingTypes';

/**
 * Evaluates candidate positions from all active snappers (Wall, Alignment, Grid),
 * applies priority resolution with hysteresis, and strictly verifies that snapped
 * results do not violate hard spatial constraints:
 * 1. Room boundary containment (walls, floor, ceiling)
 * 2. Physical furniture collisions (OBB SAT)
 * 3. Mandatory hard clearance rules (e.g. egress, door opening)
 *
 * Candidate Selection Strategy:
 * Candidates are grouped by axis (X, Z) and sorted by `priority` descending,
 * then by `delta` (displacement) ascending.
 * Consequently, the selected candidate is the HIGHEST-PRIORITY valid candidate
 * (e.g. Wall Snapping [30] > Alignment Snapping [25..21] > Floor Grid Snapping [10]),
 * rather than the globally nearest candidate across priority tiers.
 */
export function calculateSnap(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  room: RoomDimensions,
  config: SnapConfig,
  stateTracker?: SnapStateTracker,
  categoryLookup: Record<string, string> = {},
  clearanceOptions: ClearanceOptions = {}
): SnapResult {
  const originalPos = target.position;

  if (!config.enabled) {
    if (stateTracker) {
      delete stateTracker.activeXSnap;
      delete stateTracker.activeZSnap;
    }
    return {
      position: originalPos,
      guides: [],
      snappedX: false,
      snappedZ: false,
      appliedTypes: [],
    };
  }

  // Gather candidates from all active snappers
  const allCandidates: SnapCandidate[] = [
    ...calculateWallSnap(target, room, config, stateTracker),
    ...calculateAlignmentSnap(target, allObjects, config, stateTracker),
    ...calculateGridSnap(target, config),
  ];

  // Group and sort candidates by axis (priority descending, then delta ascending)
  const xCandidates = allCandidates
    .filter((c) => c.axis === 'x')
    .sort((a, b) => b.priority - a.priority || a.delta - b.delta);

  const zCandidates = allCandidates
    .filter((c) => c.axis === 'z')
    .sort((a, b) => b.priority - a.priority || a.delta - b.delta);

  // Helper verifying candidate against all hard constraints (boundaries, collisions, hard clearances)
  const isPlacementValid = (testPos: Vector3Tuple): boolean => {
    const candidatePlacement: FurniturePlacement = {
      ...target,
      position: testPos,
    };

    // 1. Hard room boundary check
    const boundaryViolations = validateRoomBoundaries(candidatePlacement, room);
    if (boundaryViolations.length > 0) {
      return false;
    }

    // 2. Hard physical collision check (SAT OBB)
    const collisions = detectCollisions(candidatePlacement, allObjects);
    if (collisions.length > 0) {
      return false;
    }

    // 3. Hard clearance constraint check (mandatory minimums)
    if (clearanceOptions.enforceHardClearance !== false) {
      const clearanceResult = validateClearanceDetails(
        candidatePlacement,
        allObjects,
        categoryLookup,
        clearanceOptions
      );
      if (clearanceResult.hardViolations.length > 0) {
        return false;
      }
    }

    return true;
  };

  let bestX: number = originalPos[0];
  let bestZ: number = originalPos[2];
  let activeGuideX: SnapGuide | undefined;
  let activeGuideZ: SnapGuide | undefined;
  let activeTypeX: SnapType | undefined;
  let activeTypeZ: SnapType | undefined;

  // Step 1: Attempt to find a valid pair (candidate X, candidate Z)
  let foundPair = false;
  for (const candX of xCandidates) {
    for (const candZ of zCandidates) {
      const testPos: Vector3Tuple = [candX.snappedValue, originalPos[1], candZ.snappedValue];
      if (isPlacementValid(testPos)) {
        bestX = candX.snappedValue;
        bestZ = candZ.snappedValue;
        activeGuideX = candX.guide;
        activeGuideZ = candZ.guide;
        activeTypeX = candX.type;
        activeTypeZ = candZ.type;
        foundPair = true;
        break;
      }
    }
    if (foundPair) break;
  }

  // Step 2: If dual-axis snap failed, try snapping X-only with raw Z
  if (!foundPair) {
    for (const candX of xCandidates) {
      const testPos: Vector3Tuple = [candX.snappedValue, originalPos[1], originalPos[2]];
      if (isPlacementValid(testPos)) {
        bestX = candX.snappedValue;
        activeGuideX = candX.guide;
        activeTypeX = candX.type;
        break;
      }
    }

    // Step 3: Try snapping Z-only with raw X (or bestX if X was valid)
    for (const candZ of zCandidates) {
      const testPos: Vector3Tuple = [bestX, originalPos[1], candZ.snappedValue];
      if (isPlacementValid(testPos)) {
        bestZ = candZ.snappedValue;
        activeGuideZ = candZ.guide;
        activeTypeZ = candZ.type;
        break;
      }
    }
  }

  const snappedX = activeGuideX !== undefined && bestX !== originalPos[0];
  const snappedZ = activeGuideZ !== undefined && bestZ !== originalPos[2];

  // Update state tracker for hysteresis stability on subsequent frames
  if (stateTracker) {
    if (snappedX && activeTypeX) {
      stateTracker.activeXSnap = { type: activeTypeX, targetValue: bestX };
    } else {
      delete stateTracker.activeXSnap;
    }

    if (snappedZ && activeTypeZ) {
      stateTracker.activeZSnap = { type: activeTypeZ, targetValue: bestZ };
    } else {
      delete stateTracker.activeZSnap;
    }
  }

  const guides: SnapGuide[] = [];
  const appliedTypes: SnapType[] = [];

  if (snappedX && activeGuideX && activeTypeX) {
    guides.push(activeGuideX);
    appliedTypes.push(activeTypeX);
  }
  if (snappedZ && activeGuideZ && activeTypeZ) {
    guides.push(activeGuideZ);
    appliedTypes.push(activeTypeZ);
  }

  return {
    position: [bestX, originalPos[1], bestZ],
    guides,
    snappedX,
    snappedZ,
    appliedTypes,
  };
}

