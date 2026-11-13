import { OBB } from 'three/examples/jsm/math/OBB.js';
import { Vector3 } from 'three';
import type { FurniturePlacement, Vector3Tuple } from '../../types/scene';
import { 
  getRotationMatrix3, 
  sanitizeCoordinate, 
  sanitizeDimension 
} from './coordinateSystem';

/**
 * Geometry Engine for RoomGenie AI
 * Constructs and converts 3D geometric representations (OBB, AABB, extents)
 * for furniture items and architectural spaces.
 */

export function createOBB(
  position: Vector3Tuple,
  dimensions: Vector3Tuple,
  scale: Vector3Tuple = [1, 1, 1],
  rotationEuler: Vector3Tuple = [0, 0, 0]
): OBB {
  const posX = sanitizeCoordinate(position?.[0], 0);
  const posY = sanitizeCoordinate(position?.[1], 0);
  const posZ = sanitizeCoordinate(position?.[2], 0);

  const dimX = sanitizeDimension(dimensions?.[0], 0.5);
  const dimY = sanitizeDimension(dimensions?.[1], 0.5);
  const dimZ = sanitizeDimension(dimensions?.[2], 0.5);

  const scaleX = sanitizeDimension(scale?.[0], 1.0);
  const scaleY = sanitizeDimension(scale?.[1], 1.0);
  const scaleZ = sanitizeDimension(scale?.[2], 1.0);

  const center = new Vector3(posX, posY, posZ);
  const halfSize = new Vector3(
    Math.max((dimX * scaleX) / 2, 0.005),
    Math.max((dimY * scaleY) / 2, 0.005),
    Math.max((dimZ * scaleZ) / 2, 0.005)
  );
  const rotMatrix3 = getRotationMatrix3(rotationEuler);
  return new OBB(center, halfSize, rotMatrix3);
}

export function createOBBFromPlacement(placement: FurniturePlacement): OBB {
  return createOBB(
    placement.position,
    placement.dimensions,
    placement.scale,
    placement.rotationEuler
  );
}

export function createExpandedOBB(
  baseOBB: OBB,
  bufferXZ: number,
  bufferY: number = 0
): OBB {
  const safeBufXZ = Math.max(sanitizeCoordinate(bufferXZ, 0), 0);
  const safeBufY = Math.max(sanitizeCoordinate(bufferY, 0), 0);

  const expandedHalfSize = new Vector3(
    baseOBB.halfSize.x + safeBufXZ,
    baseOBB.halfSize.y + safeBufY,
    baseOBB.halfSize.z + safeBufXZ
  );
  return new OBB(baseOBB.center.clone(), expandedHalfSize, baseOBB.rotation.clone());
}

export function getOBBCorners(obb: OBB): Vector3Tuple[] {
  const c = obb.center;
  const h = obb.halfSize;
  const e = obb.rotation.elements;

  // Matrix3 is column-major in Three.js
  const ux = new Vector3(e[0], e[1], e[2]).multiplyScalar(h.x);
  const uy = new Vector3(e[3], e[4], e[5]).multiplyScalar(h.y);
  const uz = new Vector3(e[6], e[7], e[8]).multiplyScalar(h.z);

  const signs = [
    [-1, -1, -1],
    [1, -1, -1],
    [-1, 1, -1],
    [1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [-1, 1, 1],
    [1, 1, 1],
  ];

  return signs.map(([sx, sy, sz]) => {
    const pt = new Vector3()
      .copy(c)
      .addScaledVector(ux, sx)
      .addScaledVector(uy, sy)
      .addScaledVector(uz, sz);
    return [pt.x, pt.y, pt.z] as Vector3Tuple;
  });
}

export function computeAABBFromOBB(obb: OBB): { min: Vector3Tuple; max: Vector3Tuple } {
  const corners = getOBBCorners(obb);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const [x, y, z] of corners) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}
