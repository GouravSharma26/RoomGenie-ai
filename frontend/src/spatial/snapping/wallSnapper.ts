import type { FurniturePlacement, RoomDimensions } from '../../types/scene';
import { computeAABBFromOBB, createOBBFromPlacement } from '../core/geometryEngine';
import type { SnapCandidate, SnapConfig, SnapStateTracker } from './snappingTypes';

/**
 * Calculates wall magnetic snapping candidates for a target furniture item.
 * Supports arbitrary rotations (yaw/pitch/roll), non-uniform scales, and configurable offsets.
 * Priority: 30 (high priority).
 */
export function calculateWallSnap(
  target: FurniturePlacement,
  room: RoomDimensions,
  config: SnapConfig,
  stateTracker?: SnapStateTracker
): SnapCandidate[] {
  if (!config.enabled || !config.wallSnap) {
    return [];
  }

  const obb = createOBBFromPlacement(target);
  const aabb = computeAABBFromOBB(obb);

  const extentX = (aabb.max[0] - aabb.min[0]) / 2;
  const extentZ = (aabb.max[2] - aabb.min[2]) / 2;
  const [posX, , posZ] = target.position;

  const halfW = room.width / 2;
  const halfL = room.length / 2;
  const wallOffset = Math.max(config.wallOffset || 0, 0);

  const candidates: SnapCandidate[] = [];

  // Determine effective tolerance with hysteresis if previously snapped to wall
  const isXWallActive = stateTracker?.activeXSnap?.type === 'wall';
  const effectiveToleranceX = isXWallActive
    ? config.wallTolerance * (config.hysteresisFactor || 1.25)
    : config.wallTolerance;

  const isZWallActive = stateTracker?.activeZSnap?.type === 'wall';
  const effectiveToleranceZ = isZWallActive
    ? config.wallTolerance * (config.hysteresisFactor || 1.25)
    : config.wallTolerance;

  // 1. Left Wall (X = -halfW)
  const leftEdge = aabb.min[0];
  const distToLeftWall = leftEdge - (-halfW);
  // Capture if within tolerance or slightly penetrating wall (up to -10cm)
  if (distToLeftWall >= -0.10 && distToLeftWall <= effectiveToleranceX) {
    const targetCenterX = Number((-halfW + wallOffset + extentX).toFixed(4));
    const delta = Math.abs(posX - targetCenterX);
    candidates.push({
      axis: 'x',
      snappedValue: targetCenterX,
      delta,
      priority: 30,
      type: 'wall',
      guide: {
        id: 'wall-snap-left',
        type: 'wall',
        axis: 'x',
        start: [-halfW + 0.005, 0.02, Math.max(-halfL, posZ - extentZ - 0.3)],
        end: [-halfW + 0.005, 0.02, Math.min(halfL, posZ + extentZ + 0.3)],
        label: 'Left Wall Snap',
      },
    });
  }

  // 2. Right Wall (X = +halfW)
  const rightEdge = aabb.max[0];
  const distToRightWall = halfW - rightEdge;
  if (distToRightWall >= -0.10 && distToRightWall <= effectiveToleranceX) {
    const targetCenterX = Number((halfW - wallOffset - extentX).toFixed(4));
    const delta = Math.abs(posX - targetCenterX);
    candidates.push({
      axis: 'x',
      snappedValue: targetCenterX,
      delta,
      priority: 30,
      type: 'wall',
      guide: {
        id: 'wall-snap-right',
        type: 'wall',
        axis: 'x',
        start: [halfW - 0.005, 0.02, Math.max(-halfL, posZ - extentZ - 0.3)],
        end: [halfW - 0.005, 0.02, Math.min(halfL, posZ + extentZ + 0.3)],
        label: 'Right Wall Snap',
      },
    });
  }

  // 3. Front Wall (Z = -halfL)
  const frontEdge = aabb.min[2];
  const distToFrontWall = frontEdge - (-halfL);
  if (distToFrontWall >= -0.10 && distToFrontWall <= effectiveToleranceZ) {
    const targetCenterZ = Number((-halfL + wallOffset + extentZ).toFixed(4));
    const delta = Math.abs(posZ - targetCenterZ);
    candidates.push({
      axis: 'z',
      snappedValue: targetCenterZ,
      delta,
      priority: 30,
      type: 'wall',
      guide: {
        id: 'wall-snap-front',
        type: 'wall',
        axis: 'z',
        start: [Math.max(-halfW, posX - extentX - 0.3), 0.02, -halfL + 0.005],
        end: [Math.min(halfW, posX + extentX + 0.3), 0.02, -halfL + 0.005],
        label: 'Front Wall Snap',
      },
    });
  }

  // 4. Back Wall (Z = +halfL)
  const backEdge = aabb.max[2];
  const distToBackWall = halfL - backEdge;
  if (distToBackWall >= -0.10 && distToBackWall <= effectiveToleranceZ) {
    const targetCenterZ = Number((halfL - wallOffset - extentZ).toFixed(4));
    const delta = Math.abs(posZ - targetCenterZ);
    candidates.push({
      axis: 'z',
      snappedValue: targetCenterZ,
      delta,
      priority: 30,
      type: 'wall',
      guide: {
        id: 'wall-snap-back',
        type: 'wall',
        axis: 'z',
        start: [Math.max(-halfW, posX - extentX - 0.3), 0.02, halfL - 0.005],
        end: [Math.min(halfW, posX + extentX + 0.3), 0.02, halfL - 0.005],
        label: 'Back Wall Snap',
      },
    });
  }

  return candidates;
}

