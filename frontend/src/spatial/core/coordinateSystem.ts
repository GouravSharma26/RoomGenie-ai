import { Euler, Matrix3, Matrix4 } from 'three';
import type { RoomDimensions, Vector3Tuple } from '../../types/scene';

/**
 * Coordinate System Utility for RoomGenie AI
 * Metric standards:
 * - 1 Three.js unit = 1 metre
 * - +Y is vertical up
 * - X (width) and Z (length) define horizontal floor plane
 * - Origin (0, 0, 0) is the center of the room floor
 */

export function computeGroundedY(height: number, scaleY: number = 1): number {
  return (Math.max(height, 0.05) * Math.max(scaleY, 0.05)) / 2;
}

export function isProperlyGrounded(
  posY: number,
  height: number,
  scaleY: number = 1,
  tolerance: number = 0.02
): boolean {
  const expectedY = computeGroundedY(height, scaleY);
  return Math.abs(posY - expectedY) <= tolerance;
}

export function getRotationMatrix3(rotationEuler: Vector3Tuple): Matrix3 {
  const [rx, ry, rz] = rotationEuler;
  const euler = new Euler(rx, ry, rz, 'XYZ');
  const mat4 = new Matrix4().makeRotationFromEuler(euler);
  const mat3 = new Matrix3().setFromMatrix4(mat4);
  return mat3;
}

export function distanceXZ(a: Vector3Tuple, b: Vector3Tuple): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance3D(a: Vector3Tuple, b: Vector3Tuple): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function getRoomBounds(room: RoomDimensions): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
} {
  const halfX = room.width / 2;
  const halfZ = room.length / 2;
  return {
    minX: -halfX,
    maxX: halfX,
    minZ: -halfZ,
    maxZ: halfZ,
    minY: 0,
    maxY: room.height,
  };
}
