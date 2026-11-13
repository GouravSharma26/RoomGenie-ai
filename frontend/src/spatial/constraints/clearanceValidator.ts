import type { FurniturePlacement } from '../../types/scene';
import { createExpandedOBB, createOBBFromPlacement } from '../core/geometryEngine';
import { doOBBsIntersect } from './collisionDetector';
import type { ClearanceOptions, ClearanceRuleDetail } from '../core/spatialTypes';

/**
 * Standard minimum clearance buffers (in metres) by furniture category pairing.
 * Dual-tier design:
 * - recommended: Ergonomic optimal breathing / circulation space (soft recommendation)
 * - hardMin: Absolute functional minimum required for egress / door opening / legroom (hard constraint)
 */
export const DEFAULT_CLEARANCE_RULES: Record<string, ClearanceRuleDetail> = {
  default: { recommended: 0.10, hardMin: 0.04 },
  'seating-tables': { recommended: 0.35, hardMin: 0.20 },
  'tables-seating': { recommended: 0.35, hardMin: 0.20 },
  'storage-seating': { recommended: 0.60, hardMin: 0.35 },
  'beds-storage': { recommended: 0.70, hardMin: 0.40 },
  'beds-seating': { recommended: 0.50, hardMin: 0.30 },
};

/**
 * Legacy flat map for backward compatibility.
 */
export const CLEARANCE_RULES: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULT_CLEARANCE_RULES).map(([key, rule]) => [key, rule.recommended])
);

export function getClearanceRule(
  catA?: string,
  catB?: string,
  customRules?: Record<string, ClearanceRuleDetail>
): ClearanceRuleDetail {
  if (catA && catB) {
    const key = `${catA}-${catB}`;
    if (customRules && customRules[key]) return customRules[key];
    if (DEFAULT_CLEARANCE_RULES[key]) return DEFAULT_CLEARANCE_RULES[key];
  }
  return customRules?.default || DEFAULT_CLEARANCE_RULES.default;
}

export function getRecommendedClearance(catA?: string, catB?: string): number {
  return getClearanceRule(catA, catB).recommended;
}

export interface ClearanceValidationResult {
  hardViolations: string[];
  softWarnings: string[];
  allViolations: string[];
}

/**
 * Validates clearance between a target object and existing objects in the scene.
 * Distinguishes between:
 * - hardViolations: Breaches of mandatory operational clearances (makes placement invalid)
 * - softWarnings: Ergonomic advisories (preserves placement validity with guidance)
 */
export function validateClearanceDetails(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  categoryLookup: Record<string, string> = {},
  options: ClearanceOptions = {}
): ClearanceValidationResult {
  const targetOBB = createOBBFromPlacement(target);
  const targetCat = categoryLookup[target.assetId] || 'decor';
  const enforceHard = options.enforceHardClearance !== false;

  const hardViolations: string[] = [];
  const softWarnings: string[] = [];

  for (const obj of allObjects) {
    if (obj.id === target.id) continue;
    const objOBB = createOBBFromPlacement(obj);

    // If objects are physically intersecting, that is handled authoritatively by collision detector
    if (doOBBsIntersect(targetOBB, objOBB)) {
      continue;
    }

    const objCat = categoryLookup[obj.assetId] || 'decor';
    const rule = getClearanceRule(targetCat, objCat, options.categoryRules);

    // 1. Check Hard Minimum Clearance
    const expandedHardOBB = createExpandedOBB(targetOBB, rule.hardMin, 0);
    if (expandedHardOBB.intersectsOBB(objOBB)) {
      const msg = `Critical clearance violation: Insufficient space between "${target.name}" and "${obj.name}" (mandatory minimum: ${(rule.hardMin * 100).toFixed(0)}cm)`;
      if (enforceHard) {
        hardViolations.push(msg);
      } else {
        softWarnings.push(msg);
      }
      continue;
    }

    // 2. Check Soft Recommended Clearance
    const expandedRecOBB = createExpandedOBB(targetOBB, rule.recommended, 0);
    if (expandedRecOBB.intersectsOBB(objOBB)) {
      softWarnings.push(
        `Insufficient clearance between "${target.name}" and "${obj.name}" (min recommended: ${(rule.recommended * 100).toFixed(0)}cm)`
      );
    }
  }

  const allViolations = [...hardViolations, ...softWarnings];
  return {
    hardViolations,
    softWarnings,
    allViolations,
  };
}

/**
 * Convenience wrapper returning all clearance issues (for backward compatibility).
 */
export function validateClearances(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  categoryLookup: Record<string, string> = {},
  options: ClearanceOptions = {}
): string[] {
  return validateClearanceDetails(target, allObjects, categoryLookup, options).allViolations;
}
