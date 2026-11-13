import type { Vector3Tuple } from '../../types/scene';

export type SnapType = 'wall' | 'center' | 'edge' | 'grid';
export type SnapAxis = 'x' | 'z';

export interface SnapGuide {
  id: string;
  type: SnapType;
  axis: SnapAxis;
  start: Vector3Tuple;
  end: Vector3Tuple;
  targetId?: string;
  targetName?: string;
  label?: string;
}

export interface SnapConfig {
  enabled: boolean;            // Master snapping toggle (default: true)
  wallSnap: boolean;           // Wall snapping toggle (default: true)
  wallTolerance: number;       // Wall magnetic distance (metres, default: 0.15)
  wallOffset: number;          // Desired offset from wall (metres, default: 0.0)
  alignmentSnap: boolean;      // Center & edge alignment toggle (default: true)
  alignmentTolerance: number;  // Alignment magnetic distance (metres, default: 0.05)
  gridSnap: boolean;           // Grid snapping toggle (default: true)
  gridSize: number;            // Grid step size in metres (default: 0.05)
  hysteresisFactor: number;    // Break-away factor before releasing snap (default: 1.25)
}

export interface SnapCandidate {
  axis: SnapAxis;
  snappedValue: number;
  delta: number;               // Distance from original value
  priority: number;            // Higher priority candidate wins
  type: SnapType;
  guide: SnapGuide;
}

export interface SnapResult {
  position: Vector3Tuple;
  guides: SnapGuide[];
  snappedX: boolean;
  snappedZ: boolean;
  appliedTypes: SnapType[];
}

export interface SnapStateTracker {
  activeXSnap?: { type: SnapType; targetValue: number };
  activeZSnap?: { type: SnapType; targetValue: number };
}

