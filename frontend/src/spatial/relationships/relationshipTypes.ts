import type { 
  Vector3Tuple, 
  SemanticRelationship, 
  SemanticZone, 
  SemanticZoneType,
  CanonicalScene,
  FurniturePlacement 
} from '../../types/scene';

export type { SemanticRelationship, SemanticZone, SemanticZoneType, CanonicalScene, FurniturePlacement };

/**
 * Defines how a connected child item should orient itself relative to its anchor socket:
 * - 'face-anchor': Child turns to face toward the anchor item (e.g. Armchair facing Sofa)
 * - 'same-direction': Child points the same direction as anchor (e.g. Nightstand beside Bed)
 * - 'perpendicular-left': Child turns 90 degrees counter-clockwise relative to anchor
 * - 'perpendicular-right': Child turns 90 degrees clockwise relative to anchor
 * - 'free': Child preserves its own custom rotation without alignment constraint
 */
export type SocketFacingMode = 
  | 'face-anchor'
  | 'same-direction'
  | 'perpendicular-left'
  | 'perpendicular-right'
  | 'free';

/**
 * Declarative specification of a semantic socket exposed by an anchor furniture item.
 * Sockets represent physical connection zones with defined outward normals,
 * compatibility rules, and functional gap boundaries.
 */
export interface SpatialSocketDefinition {
  id: string;                      // Unique socket ID on anchor (e.g. 'front-table', 'left-nightstand')
  name: string;                    // Human-readable title (e.g. 'Front Coffee Table')
  anchorAssetId?: string;          // Specific asset ID or undefined if applicable to entire category
  anchorCategory: string;          // Primary anchor category: 'seating', 'beds', 'tables'
  allowedCategories: string[];     // Furniture categories permitted to connect to this socket
  allowedAssetTags?: string[];     // Optional tag filtering (e.g. ['living-room', 'bedroom'])
  
  /**
   * Outward normal unit vector from the anchor's contact face in local space.
   * +Z: Front face [0, 0, 1]
   * -Z: Back face [0, 0, -1]
   * -X: Left face [-1, 0, 0]
   * +X: Right face [1, 0, 0]
   */
  surfaceNormal: Vector3Tuple;
  
  /**
   * Lateral placement offset ratio along the surface tangent (-1.0 to +1.0).
   * 0.0 = centered on the anchor face (default)
   * -0.5 = shifted toward left side of surface
   * +0.5 = shifted toward right side of surface
   */
  lateralRatio?: number;

  /**
   * Facing orientation behavior applied to the child item.
   */
  facingMode: SocketFacingMode;

  /**
   * Base relative yaw offset in radians added to the facing mode.
   */
  baseRelativeYaw: number;

  /**
   * Functional surface-to-surface spacing parameters (in metres).
   * Note: The clearance gap is applied strictly once between the anchor surface
   * and the child contact surface, factoring in actual dynamic furniture bounds.
   */
  recommendedGap: number;          // Default ergonomic spacing gap (m)
  minGap: number;                  // Minimum physical clearance gap (m)
  maxGap: number;                  // Maximum ergonomic connection distance (m)
}

/**
 * Calculated result of placing a child item into a socket.
 */
export interface ChildTransformResult {
  position: Vector3Tuple;          // Computed child world position [x, y, z]
  rotationEuler: Vector3Tuple;     // Computed child world rotation [rx, ry, rz]
  anchorSurfacePoint: Vector3Tuple;// World coordinates of anchor contact point
  childContactPoint: Vector3Tuple; // World coordinates of child contact point
  effectiveGap: number;            // Measured distance between contact points (m)
}

/**
 * Candidate socket discovered during spatial proximity search.
 */
export interface SocketCandidate {
  socket: SpatialSocketDefinition;
  anchorPlacement: FurniturePlacement;
  targetPlacement: FurniturePlacement;
  targetPosition: Vector3Tuple;
  targetRotation: Vector3Tuple;
  distanceToTarget: number;
  gap: number;
  valid: boolean;
  violations: string[];
}

/**
 * Result of attempting to attach a child item to an anchor socket.
 */
export interface AttachmentResult {
  success: boolean;
  relationship?: SemanticRelationship;
  childPlacement?: FurniturePlacement;
  updatedScene: CanonicalScene;
  error?: string;
  violations?: string[];
}

/**
 * Result of adjusting the separation gap of an existing socket relationship.
 */
export interface GapUpdateResult {
  success: boolean;
  newGap: number;
  childPlacement?: FurniturePlacement;
  updatedScene: CanonicalScene;
  error?: string;
  violations?: string[];
}

/**
 * Result of transforming an anchor group and all its attached children.
 */
export interface GroupTransformResult {
  success: boolean;
  updatedScene: CanonicalScene;
  movedObjectIds: string[];
  violations: string[];
}
