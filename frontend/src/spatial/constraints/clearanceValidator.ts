import type { FurniturePlacement } from '../../types/scene';
import { createExpandedOBB, createOBBFromPlacement } from '../core/geometryEngine';
import { doOBBsIntersect } from './collisionDetector';

/**
 * Standard minimum clearance buffers (in metres) by furniture category pairing.
 * Based on architectural ergonomics and circulation standards.
 */
export const CLEARANCE_RULES: Record<string, number> = {
  default: 0.10,            // 10cm default breathing room
  'seating-tables': 0.35,   // At least 35cm between sofa/chair and coffee table
  'tables-seating': 0.35,
  'storage-seating': 0.60,  // Pullout drawers/cabinets need space
  'beds-storage': 0.70,     // Wardrobe opening in front of bed
  'beds-seating': 0.50,
};

export function getRecommendedClearance(catA?: string, catB?: string): number {
  if (catA && catB) {
    const key = `${catA}-${catB}`;
    if (CLEARANCE_RULES[key]) return CLEARANCE_RULES[key];
  }
  return CLEARANCE_RULES.default;
}

/**
 * Validates clearance between a target object and a list of existing objects.
 * Flags objects that violate the recommended ergonomic buffer zone without directly colliding.
 */
export function validateClearances(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  categoryLookup: Record<string, string> = {}
): string[] {
  const targetOBB = createOBBFromPlacement(target);
  const targetCat = categoryLookup[target.assetId] || 'decor';
  const clearanceViolations: string[] = [];

  for (const obj of allObjects) {
    if (obj.id === target.id) continue;
    const objOBB = createOBBFromPlacement(obj);

    // If objects are already physically colliding, that is handled by collision detector
    if (doOBBsIntersect(targetOBB, objOBB)) {
      continue;
    }

    const objCat = categoryLookup[obj.assetId] || 'decor';
    const requiredClearance = getRecommendedClearance(targetCat, objCat);

    // Expand the target OBB horizontally by the required buffer distance
    const expandedTargetOBB = createExpandedOBB(targetOBB, requiredClearance, 0);

    if (expandedTargetOBB.intersectsOBB(objOBB)) {
      clearanceViolations.push(
        `Insufficient clearance between "${target.name}" and "${obj.name}" (min recommended: ${(requiredClearance * 100).toFixed(0)}cm)`
      );
    }
  }

  return clearanceViolations;
}

