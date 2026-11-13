/**
 * Canonical Scene Schema for RoomGenie AI
 * Reference: ARCHITECTURE.md Section 4
 * Physical units: Metres (m)
 * Coordinate convention: Three.js (Y vertical / up, X and Z horizontal floor plane)
 */

export interface WallSegment {
  id: string;
  startPoint: [number, number]; // [x, z] in metres
  endPoint: [number, number];   // [x, z] in metres
  height?: number;              // metres
  thickness?: number;           // metres
}

export type WallOpeningType = 'door' | 'window';
export type DoorSwingType = 
  | 'inward-left' 
  | 'inward-right' 
  | 'outward-left' 
  | 'outward-right' 
  | 'inward' 
  | 'outward' 
  | 'sliding' 
  | 'none';

export interface WallOpening {
  id: string;
  wallId: string;
  type: WallOpeningType;
  distanceAlongWall: number; // metres from startPoint
  width: number;             // metres
  height: number;            // metres
  sillHeight?: number;       // metres
  swing?: DoorSwingType;
}

export interface RoomDimensions {
  width: number;  // X axis (metres)
  length: number; // Z axis (metres)
  height: number; // Y axis (metres)
  footprint?: [number, number][]; // Ordered 2D vertices [x, z] in metres (Phase 5)
  walls?: WallSegment[];          // Explicit wall segments (Phase 5)
  openings?: WallOpening[];       // Architectural openings (doors & windows) (Phase 5)
  isParametric?: boolean;         // Flag indicating parametric mode is active (Phase 5)
}

export type Vector3Tuple = [number, number, number];

export interface MaterialOverrides {
  color?: string;
  roughness?: number;
  metalness?: number;
}

export interface FurniturePlacement {
  id: string;                    // Placement UUID
  assetId: string;               // Catalog asset reference ID
  name: string;                  // Display name
  position: Vector3Tuple;        // [x, y, z] in metres
  rotationEuler: Vector3Tuple;   // [rx, ry, rz] in radians
  scale: Vector3Tuple;           // [sx, sy, sz] uniform/axis multipliers
  dimensions: Vector3Tuple;      // [width, height, depth] in metres
  materialOverrides?: MaterialOverrides;
  modelUrl?: string;             // Optional custom reconstructed GLB/GLTF model URL
  reconstructionJobId?: string;  // Stable UUID reference to FurnitureReconstructionJob
  isCustomReconstruction?: boolean; // Flag identifying custom photo-reconstructed items
}

export interface SemanticRelationship {
  id: string;                  // Unique relationship UUID
  anchorObjectId: string;      // Host / Anchor furniture item ID (e.g. Sofa, Bed, Desk)
  childObjectId: string;       // Connected / Child furniture item ID (e.g. Coffee Table, Nightstand)
  socketId: string;            // Socket identifier on anchor (e.g. 'front-table')
  gap: number;                 // Physical surface-to-surface gap distance in metres
  relativeYaw: number;         // Additional relative yaw rotation in radians (default: 0)
  createdAt?: number;          // Epoch timestamp when relationship was established
}

export type SemanticZoneType = 'living' | 'sleeping' | 'workspace' | 'dining' | 'circulation';

export interface SemanticZone {
  id: string;                  // Unique zone UUID
  type: SemanticZoneType;      // Functional zone category
  name: string;                // Display name (e.g. "Primary Living Conversation Zone")
  anchorObjectId?: string;     // Focal piece of furniture defining the zone
  memberObjectIds: string[];   // All furniture item IDs participating in this zone
  bounds?: {
    min: Vector3Tuple;
    max: Vector3Tuple;
  };
  provenance?: 'user' | 'inferred'; // Whether explicitly configured by user or inferred
  confidence?: number;         // Confidence score (0.0 to 1.0) when inferred
}

export interface CanonicalScene {
  schemaVersion: number;
  unit: 'm';
  room: RoomDimensions;
  objects: FurniturePlacement[];
  relationships?: SemanticRelationship[];
  zones?: SemanticZone[];
}

export interface FurnitureCatalogItem {
  id: string;
  name: string;
  category: 'seating' | 'tables' | 'storage' | 'beds' | 'decor';
  styleTags?: string[];
  dimensions: Vector3Tuple; // [width, height, depth] in metres
  pricePaise: number | null; // Deterministic price in INR paise (e.g., 2499900 = ₹24,999) or null if unpriced
  modelUrl?: string; // Optional GLB/GLTF file URL
  thumbnail?: string;
  license: string; // e.g. "CC0 1.0 Universal"
  source: string; // Asset attribution or procedural generator
  description: string;
  defaultColor: string;
}
