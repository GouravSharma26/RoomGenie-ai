import * as THREE from 'three';
import type { Point2D, WallOpening, DerivedWall } from '../parametricTypes';

/**
 * 2D bounding interval on the wall elevation plane.
 */
export interface WallElevationInterval {
  sMin: number;
  sMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Solid box section in wall-local coordinates:
 * s in [sMin, sMax] (along wall direction u)
 * y in [yMin, yMax] (vertical height up)
 * t in [-thickness/2, +thickness/2] (along interior normal n)
 */
export interface SolidWallSection extends WallElevationInterval {
  type: 'full' | 'sill' | 'lintel' | 'partition';
}

/**
 * Wall-local representation of an architectural opening.
 */
export interface LocalOpeningBounds {
  openingId: string;
  type: 'door' | 'window';
  sStart: number;
  sEnd: number;
  ySill: number;
  yTop: number;
  width: number;
  height: number;
}

/**
 * Result of building geometry for an individual wall segment.
 */
export interface WallGeometryResult {
  wallId: string;
  /** Primary solid wall mesh geometry with openings cleanly cut out */
  wallGeometry: THREE.BufferGeometry;
  /** Optional structural frame/casing geometry for doors and windows */
  frameGeometry?: THREE.BufferGeometry;
  /** Derived geometric properties of the wall segment */
  derived: DerivedWall;
  /** Solid wall sections generated for this segment */
  solidSections: SolidWallSection[];
  /** Openings placed on this wall */
  openings: WallOpening[];
  /** Non-blocking diagnostics or warnings encountered during generation */
  diagnostics: string[];
}

/**
 * Result of building geometry for a room floor.
 */
export interface FloorGeometryResult {
  /** Triangulated floor mesh geometry at Y = 0 */
  floorGeometry: THREE.BufferGeometry;
  /** Triangulated ceiling mesh geometry at Y = height (optional) */
  ceilingGeometry?: THREE.BufferGeometry;
  /** Floor boundary outline line geometry */
  outlineGeometry: THREE.BufferGeometry;
  /** Total floor surface area in m² */
  area: number;
  /** Number of triangles in the floor mesh */
  triangleCount: number;
  /** Bounding box of the floor */
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    width: number;
    length: number;
    center: Point2D;
  };
  /** Diagnostics or warnings */
  diagnostics: string[];
}

/**
 * Complete procedural room geometry suite for the viewport.
 */
export interface ProceduralRoomGeometries {
  floor: FloorGeometryResult;
  walls: WallGeometryResult[];
  /** Corner junction filler mesh uniting adjacent walls at polygon vertices */
  cornerJunctions?: THREE.BufferGeometry;
  /** Overall generation diagnostics */
  diagnostics: string[];
}

