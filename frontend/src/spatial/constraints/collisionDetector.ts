import { OBB } from 'three/examples/jsm/math/OBB.js';
import { Vector3 } from 'three';
import type { FurniturePlacement } from '../../types/scene';
import { createOBBFromPlacement } from '../core/geometryEngine';

/**
 * Collision Detector for RoomGenie AI
 * Uses Oriented Bounding Boxes (OBB) and Separating Axis Theorem (SAT)
 * to detect actual 3D physical intersections between furniture items.
 */

export const DEFAULT_COLLISION_TOLERANCE = 0.002; // 2mm numerical margin for touching/flush objects

/**
 * Shrinks an OBB by a tiny tolerance margin to permit flush/adjacent placement
 * without triggering false positive collisions on floating-point boundary edges.
 */
export function deflateOBB(obb: OBB, tolerance: number = DEFAULT_COLLISION_TOLERANCE): OBB {
  if (tolerance <= 0) return obb;
  const deflatedHalf = new Vector3(
    Math.max(obb.halfSize.x - tolerance, 0.001),
    Math.max(obb.halfSize.y - tolerance, 0.001),
    Math.max(obb.halfSize.z - tolerance, 0.001)
  );
  return new OBB(obb.center.clone(), deflatedHalf, obb.rotation.clone());
}

/**
 * Checks whether two OBBs physically intersect, accounting for tolerance.
 */
export function doOBBsIntersect(
  obb1: OBB,
  obb2: OBB,
  tolerance: number = DEFAULT_COLLISION_TOLERANCE
): boolean {
  const d1 = deflateOBB(obb1, tolerance);
  const d2 = deflateOBB(obb2, tolerance);
  return d1.intersectsOBB(d2);
}

/**
 * Checks if two furniture placements collide.
 */
export function checkFurnitureCollision(
  a: FurniturePlacement,
  b: FurniturePlacement,
  tolerance: number = DEFAULT_COLLISION_TOLERANCE
): boolean {
  if (a.id === b.id) return false;
  const obbA = createOBBFromPlacement(a);
  const obbB = createOBBFromPlacement(b);
  return doOBBsIntersect(obbA, obbB, tolerance);
}

/**
 * Detects all colliding furniture IDs for a given target placement.
 */
export function detectCollisions(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  tolerance: number = DEFAULT_COLLISION_TOLERANCE
): string[] {
  const targetOBB = createOBBFromPlacement(target);
  const collidingIds: string[] = [];

  for (const obj of allObjects) {
    if (obj.id === target.id) continue;
    const otherOBB = createOBBFromPlacement(obj);
    if (doOBBsIntersect(targetOBB, otherOBB, tolerance)) {
      collidingIds.push(obj.id);
    }
  }

  return collidingIds;
}

/**
 * Detects all collisions in a scene, returning an adjacency map of colliding IDs.
 */
export function detectAllSceneCollisions(
  objects: FurniturePlacement[],
  tolerance: number = DEFAULT_COLLISION_TOLERANCE
): Map<string, string[]> {
  const collisionMap = new Map<string, string[]>();
  for (const obj of objects) {
    collisionMap.set(obj.id, []);
  }

  const obbs = objects.map((obj) => ({
    id: obj.id,
    obb: createOBBFromPlacement(obj),
  }));

  for (let i = 0; i < obbs.length; i++) {
    for (let j = i + 1; j < obbs.length; j++) {
      if (doOBBsIntersect(obbs[i].obb, obbs[j].obb, tolerance)) {
        collisionMap.get(obbs[i].id)?.push(obbs[j].id);
        collisionMap.get(obbs[j].id)?.push(obbs[i].id);
      }
    }
  }

  return collisionMap;
}

