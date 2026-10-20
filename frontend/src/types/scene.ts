/**
 * Canonical Scene Schema for RoomGenie AI
 * Reference: ARCHITECTURE.md Section 4
 * Physical units: Metres (m)
 * Coordinate convention: Three.js (Y vertical / up, X and Z horizontal floor plane)
 */

export interface RoomDimensions {
  width: number;  // X axis (metres)
  length: number; // Z axis (metres)
  height: number; // Y axis (metres)
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
  isCustomReconstruction?: boolean; // Flag identifying custom photo-reconstructed items
}

export interface CanonicalScene {
  schemaVersion: number;
  unit: 'm';
  room: RoomDimensions;
  objects: FurniturePlacement[];
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
