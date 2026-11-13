import type { Vector3Tuple } from '../../types/scene';

export type WallIdentifier =
  | 'left-wall'
  | 'right-wall'
  | 'front-wall'
  | 'back-wall'
  | 'floor'
  | 'ceiling';

export interface ClearanceRuleDetail {
  recommended: number; // Soft ergonomic recommendation (metres)
  hardMin: number;      // Hard physical minimum threshold (metres)
}

export interface ClearanceOptions {
  enforceHardClearance?: boolean; // When true, violating hardMin invalidates placement. Default: true
  hardClearanceRatio?: number;   // Fallback ratio of recommended buffer that becomes hard minimum (default 0.5)
  categoryRules?: Record<string, ClearanceRuleDetail>;
  exemptObjectIds?: Set<string> | string[]; // Objects exempted from clearance rules (e.g. semantic socket partners)
}

export interface PlacementValidation {
  valid: boolean;
  collisions: string[];
  boundaryViolations: WallIdentifier[];
  hardClearanceViolations: string[];
  clearanceViolations: string[]; // All clearance issues (hard violations + soft advisories)
  clearanceWarnings: string[];   // Soft ergonomic advisories only
  warnings: string[];
  suggestedPosition?: Vector3Tuple;
}

export interface TransformedBox {
  id: string;
  name: string;
  center: Vector3Tuple;
  halfSize: Vector3Tuple;
  rotationEuler: Vector3Tuple;
  category?: string;
  clearanceBuffer?: number;
}
