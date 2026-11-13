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

export function sanitizeCoordinate(val: unknown, fallback: number = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  return fallback;
}

export function sanitizeDimension(val: unknown, fallback: number = 0.5): number {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.max(val, 0.01);
  }
  return fallback;
}

export function computeGroundedY(height: number, scaleY: number = 1): number {
  const safeH = sanitizeDimension(height, 0.5);
  const safeScaleY = sanitizeDimension(scaleY, 1.0);
  return (safeH * safeScaleY) / 2;
}

export function isProperlyGrounded(
  posY: number,
  height: number,
  scaleY: number = 1,
  tolerance: number = 0.02
): boolean {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return false;
  }
  if (typeof scaleY !== 'number' || !Number.isFinite(scaleY) || scaleY <= 0) {
    return false;
  }
  if (typeof posY !== 'number' || !Number.isFinite(posY)) {
    return false;
  }

  const expectedY = computeGroundedY(height, scaleY);
  return Math.abs(posY - expectedY) <= tolerance;
}

export function getGroundingDeviation(
  posY: number,
  height: number,
  scaleY: number = 1
): number {
  const expectedY = computeGroundedY(height, scaleY);
  const safeY = sanitizeCoordinate(posY, 0);
  return safeY - expectedY;
}

export function getRotationMatrix3(rotationEuler: Vector3Tuple): Matrix3 {
  const rx = sanitizeCoordinate(rotationEuler?.[0], 0);
  const ry = sanitizeCoordinate(rotationEuler?.[1], 0);
  const rz = sanitizeCoordinate(rotationEuler?.[2], 0);

  const euler = new Euler(rx, ry, rz, 'XYZ');
  const mat4 = new Matrix4().makeRotationFromEuler(euler);
  const mat3 = new Matrix3().setFromMatrix4(mat4);
  return mat3;
}

export function distanceXZ(a: Vector3Tuple, b: Vector3Tuple): number {
  const ax = sanitizeCoordinate(a?.[0], 0);
  const az = sanitizeCoordinate(a?.[2], 0);
  const bx = sanitizeCoordinate(b?.[0], 0);
  const bz = sanitizeCoordinate(b?.[2], 0);
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance3D(a: Vector3Tuple, b: Vector3Tuple): number {
  const ax = sanitizeCoordinate(a?.[0], 0);
  const ay = sanitizeCoordinate(a?.[1], 0);
  const az = sanitizeCoordinate(a?.[2], 0);
  const bx = sanitizeCoordinate(b?.[0], 0);
  const by = sanitizeCoordinate(b?.[1], 0);
  const bz = sanitizeCoordinate(b?.[2], 0);
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
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
  const safeW = sanitizeDimension(room?.width, 5.0);
  const safeL = sanitizeDimension(room?.length, 4.0);
  const safeH = sanitizeDimension(room?.height, 2.8);
  const halfX = safeW / 2;
  const halfZ = safeL / 2;
  return {
    minX: -halfX,
    maxX: halfX,
    minZ: -halfZ,
    maxZ: halfZ,
    minY: 0,
    maxY: safeH,
  };
}
