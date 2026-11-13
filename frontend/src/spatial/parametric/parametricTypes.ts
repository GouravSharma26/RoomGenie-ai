/**
 * Core type definitions for RoomGenie AI Parametric Room Architecture (Phase 5.1).
 * 
 * Standards & Conventions:
 * - Units: Metres (m).
 * - Floor plane: X/Z plane (Three.js standard, Y = 0).
 * - Columns/X: West (-) to East (+).
 * - Rows/Z: North (-) to South (+).
 * - Polygon winding: Counter-Clockwise (CCW) interior convention.
 */

export type Point2D = [number, number]; // [x, z] in world metres

/**
 * Architectural opening classification.
 */
export type WallOpeningType = 'door' | 'window';

/**
 * Door opening swing mechanism.
 */
export type DoorSwingType = 'inward' | 'outward' | 'sliding' | 'none';

/**
 * First-class architectural opening (Door or Window) relative to a host wall.
 */
export interface WallOpening {
  /** Stable unique identifier for the opening */
  id: string;
  /** Identifier of the host wall segment this opening belongs to */
  wallId: string;
  /** Opening classification */
  type: WallOpeningType;
  /** Distance in metres from the host wall's startPoint to the start of the opening */
  distanceAlongWall: number;
  /** Width of the opening in metres along the wall */
  width: number;
  /** Height of the opening in metres */
  height: number;
  /** Vertical elevation above the floor in metres (0.0 for doors, standard 0.8m-1.0m for windows) */
  sillHeight?: number;
  /** Swing mode for doors */
  swing?: DoorSwingType;
}

/**
 * Canonical wall segment connecting two floor vertices.
 */
export interface WallSegment {
  /** Stable unique identifier for the wall (e.g. 'wall-north', 'wall-1') */
  id: string;
  /** Starting vertex [x, z] in metres on the floor plane */
  startPoint: Point2D;
  /** Ending vertex [x, z] in metres on the floor plane */
  endPoint: Point2D;
  /** Wall height in metres (defaults to room height if omitted) */
  height?: number;
  /** Wall structural thickness in metres (default: 0.15m) */
  thickness?: number;
}

/**
 * Pure derived geometric properties of a wall segment.
 * Computed on demand — not stored in persistent canonical state to prevent drift.
 */
export interface DerivedWall {
  id: string;
  startPoint: Point2D;
  endPoint: Point2D;
  length: number;
  height: number;
  thickness: number;
  /** Unit direction vector pointing from startPoint to endPoint [ux, uz] */
  direction: Point2D;
  /** Interior-facing unit normal vector [nx, nz] */
  interiorNormal: Point2D;
  /** Angle in radians of the wall direction vector */
  angleRadians: number;
  /** Center point [x, z] of the wall segment */
  midpoint: Point2D;
}

/**
 * Geometric bounds of a 2D floor footprint.
 */
export interface FootprintBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;  // maxX - minX
  length: number; // maxZ - minZ
  center: Point2D;
}

/**
 * Result of validating a room footprint polygon.
 */
export interface PolygonValidationResult {
  valid: boolean;
  area: number;
  winding: 'ccw' | 'cw' | 'collinear';
  vertexCount: number;
  isSelfIntersecting: boolean;
  errors: string[];
}

/**
 * Parametric room specification with explicit footprint and wall segments.
 */
export interface ParametricRoom {
  /** Ordered counter-clockwise vertices [x, z] enclosing the room floor */
  footprint: Point2D[];
  /** Distinct wall segments matching the footprint edges */
  walls: WallSegment[];
  /** Parametric doors and windows hosted on walls */
  openings?: WallOpening[];
  /** Overall room ceiling height in metres */
  height: number;
  /** Default wall thickness in metres (default 0.15m) */
  defaultThickness?: number;
}

/**
 * Extended Room interface compatible with both legacy rectangular and parametric models.
 */
export interface CanonicalRoom {
  /** Bounding width along X in metres */
  width: number;
  /** Bounding length along Z in metres */
  length: number;
  /** Ceiling height along Y in metres */
  height: number;
  /** Ordered footprint vertices for parametric or non-rectangular rooms */
  footprint?: Point2D[];
  /** Structured wall segments */
  walls?: WallSegment[];
  /** Architectural openings (doors and windows) */
  openings?: WallOpening[];
  /** Flag indicating whether parametric geometry is explicitly active */
  isParametric?: boolean;
}

