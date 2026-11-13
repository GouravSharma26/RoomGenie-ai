import type { Vector3Tuple } from '../../types/scene';

export type WallIdentifier =
  | 'left-wall'
  | 'right-wall'
  | 'front-wall'
  | 'back-wall'
  | 'floor'
  | 'ceiling';

export interface PlacementValidation {
  valid: boolean;
  collisions: string[];
  boundaryViolations: WallIdentifier[];
  clearanceViolations: string[];
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

export interface ClearanceRequirement {
  defaultBuffer: number;
  categoryOverrides: Record<string, number>;
}

