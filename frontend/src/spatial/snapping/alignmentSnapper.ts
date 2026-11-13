import type { FurniturePlacement } from '../../types/scene';
import { computeAABBFromOBB, createOBBFromPlacement } from '../core/geometryEngine';
import type { SnapCandidate, SnapConfig, SnapStateTracker } from './snappingTypes';

/**
 * Calculates center-to-center and edge-to-edge alignment snapping candidates
 * between the target item and other furniture in the room.
 *
 * Priorities:
 * - Center-to-center alignment: 25
 * - Edge-to-edge alignment (same side): 22
 * - Flush adjacent alignment (opposite sides): 21
 */
export function calculateAlignmentSnap(
  target: FurniturePlacement,
  allObjects: FurniturePlacement[],
  config: SnapConfig,
  stateTracker?: SnapStateTracker
): SnapCandidate[] {
  if (!config.enabled || !config.alignmentSnap) {
    return [];
  }

  const otherObjects = allObjects.filter((o) => o.id !== target.id);
  if (otherObjects.length === 0) {
    return [];
  }

  const targetOBB = createOBBFromPlacement(target);
  const targetAABB = computeAABBFromOBB(targetOBB);
  const tExtentX = (targetAABB.max[0] - targetAABB.min[0]) / 2;
  const tExtentZ = (targetAABB.max[2] - targetAABB.min[2]) / 2;
  const [posX, , posZ] = target.position;

  const tMinX = posX - tExtentX;
  const tMaxX = posX + tExtentX;
  const tMinZ = posZ - tExtentZ;
  const tMaxZ = posZ + tExtentZ;

  const isXActive = stateTracker?.activeXSnap?.type === 'center' || stateTracker?.activeXSnap?.type === 'edge';
  const effectiveTolX = isXActive
    ? config.alignmentTolerance * (config.hysteresisFactor || 1.25)
    : config.alignmentTolerance;

  const isZActive = stateTracker?.activeZSnap?.type === 'center' || stateTracker?.activeZSnap?.type === 'edge';
  const effectiveTolZ = isZActive
    ? config.alignmentTolerance * (config.hysteresisFactor || 1.25)
    : config.alignmentTolerance;

  const candidates: SnapCandidate[] = [];

  for (const other of otherObjects) {
    const otherOBB = createOBBFromPlacement(other);
    const otherAABB = computeAABBFromOBB(otherOBB);
    const oExtentX = (otherAABB.max[0] - otherAABB.min[0]) / 2;
    const oExtentZ = (otherAABB.max[2] - otherAABB.min[2]) / 2;
    const [oPosX, , oPosZ] = other.position;

    const oMinX = oPosX - oExtentX;
    const oMaxX = oPosX + oExtentX;
    const oMinZ = oPosZ - oExtentZ;
    const oMaxZ = oPosZ + oExtentZ;

    // --- X AXIS ALIGNMENTS ---

    // 1. Center-to-Center X
    const deltaCenterX = Math.abs(posX - oPosX);
    if (deltaCenterX <= effectiveTolX) {
      const snappedX = Number(oPosX.toFixed(4));
      candidates.push({
        axis: 'x',
        snappedValue: snappedX,
        delta: deltaCenterX,
        priority: 25,
        type: 'center',
        guide: {
          id: `align-center-x-${other.id}`,
          type: 'center',
          axis: 'x',
          start: [snappedX, 0.02, Math.min(posZ, oPosZ) - 0.4],
          end: [snappedX, 0.02, Math.max(posZ, oPosZ) + 0.4],
          targetId: other.id,
          targetName: other.name,
          label: `Center Align: ${other.name}`,
        },
      });
    }

    // 2. Left Edge to Left Edge
    const deltaLeftLeft = Math.abs(tMinX - oMinX);
    if (deltaLeftLeft <= effectiveTolX) {
      const snappedX = Number((oMinX + tExtentX).toFixed(4));
      candidates.push({
        axis: 'x',
        snappedValue: snappedX,
        delta: Math.abs(posX - snappedX),
        priority: 22,
        type: 'edge',
        guide: {
          id: `align-edge-left-left-${other.id}`,
          type: 'edge',
          axis: 'x',
          start: [oMinX, 0.02, Math.min(posZ, oPosZ) - 0.4],
          end: [oMinX, 0.02, Math.max(posZ, oPosZ) + 0.4],
          targetId: other.id,
          targetName: other.name,
          label: `Left Edge Align: ${other.name}`,
        },
      });
    }

    // 3. Right Edge to Right Edge
    const deltaRightRight = Math.abs(tMaxX - oMaxX);
    if (deltaRightRight <= effectiveTolX) {
      const snappedX = Number((oMaxX - tExtentX).toFixed(4));
      candidates.push({
        axis: 'x',
        snappedValue: snappedX,
        delta: Math.abs(posX - snappedX),
        priority: 22,
        type: 'edge',
        guide: {
          id: `align-edge-right-right-${other.id}`,
          type: 'edge',
          axis: 'x',
          start: [oMaxX, 0.02, Math.min(posZ, oPosZ) - 0.4],
          end: [oMaxX, 0.02, Math.max(posZ, oPosZ) + 0.4],
          targetId: other.id,
          targetName: other.name,
          label: `Right Edge Align: ${other.name}`,
        },
      });
    }

    // 4. Flush Left-to-Right Edge (target sits right of other)
    const deltaLeftRight = Math.abs(tMinX - oMaxX);
    if (deltaLeftRight <= effectiveTolX) {
      const snappedX = Number((oMaxX + tExtentX).toFixed(4));
      candidates.push({
        axis: 'x',
        snappedValue: snappedX,
        delta: Math.abs(posX - snappedX),
        priority: 21,
        type: 'edge',
        guide: {
          id: `align-edge-flush-lr-${other.id}`,
          type: 'edge',
          axis: 'x',
          start: [oMaxX, 0.02, Math.min(posZ, oPosZ) - 0.3],
          end: [oMaxX, 0.02, Math.max(posZ, oPosZ) + 0.3],
          targetId: other.id,
          targetName: other.name,
          label: `Flush Side Align: ${other.name}`,
        },
      });
    }

    // 5. Flush Right-to-Left Edge (target sits left of other)
    const deltaRightLeft = Math.abs(tMaxX - oMinX);
    if (deltaRightLeft <= effectiveTolX) {
      const snappedX = Number((oMinX - tExtentX).toFixed(4));
      candidates.push({
        axis: 'x',
        snappedValue: snappedX,
        delta: Math.abs(posX - snappedX),
        priority: 21,
        type: 'edge',
        guide: {
          id: `align-edge-flush-rl-${other.id}`,
          type: 'edge',
          axis: 'x',
          start: [oMinX, 0.02, Math.min(posZ, oPosZ) - 0.3],
          end: [oMinX, 0.02, Math.max(posZ, oPosZ) + 0.3],
          targetId: other.id,
          targetName: other.name,
          label: `Flush Side Align: ${other.name}`,
        },
      });
    }

    // --- Z AXIS ALIGNMENTS ---

    // 1. Center-to-Center Z
    const deltaCenterZ = Math.abs(posZ - oPosZ);
    if (deltaCenterZ <= effectiveTolZ) {
      const snappedZ = Number(oPosZ.toFixed(4));
      candidates.push({
        axis: 'z',
        snappedValue: snappedZ,
        delta: deltaCenterZ,
        priority: 25,
        type: 'center',
        guide: {
          id: `align-center-z-${other.id}`,
          type: 'center',
          axis: 'z',
          start: [Math.min(posX, oPosX) - 0.4, 0.02, snappedZ],
          end: [Math.max(posX, oPosX) + 0.4, 0.02, snappedZ],
          targetId: other.id,
          targetName: other.name,
          label: `Center Align: ${other.name}`,
        },
      });
    }

    // 2. Front Edge to Front Edge
    const deltaFrontFront = Math.abs(tMinZ - oMinZ);
    if (deltaFrontFront <= effectiveTolZ) {
      const snappedZ = Number((oMinZ + tExtentZ).toFixed(4));
      candidates.push({
        axis: 'z',
        snappedValue: snappedZ,
        delta: Math.abs(posZ - snappedZ),
        priority: 22,
        type: 'edge',
        guide: {
          id: `align-edge-front-front-${other.id}`,
          type: 'edge',
          axis: 'z',
          start: [Math.min(posX, oPosX) - 0.4, 0.02, oMinZ],
          end: [Math.max(posX, oPosX) + 0.4, 0.02, oMinZ],
          targetId: other.id,
          targetName: other.name,
          label: `Front Edge Align: ${other.name}`,
        },
      });
    }

    // 3. Back Edge to Back Edge
    const deltaBackBack = Math.abs(tMaxZ - oMaxZ);
    if (deltaBackBack <= effectiveTolZ) {
      const snappedZ = Number((oMaxZ - tExtentZ).toFixed(4));
      candidates.push({
        axis: 'z',
        snappedValue: snappedZ,
        delta: Math.abs(posZ - snappedZ),
        priority: 22,
        type: 'edge',
        guide: {
          id: `align-edge-back-back-${other.id}`,
          type: 'edge',
          axis: 'z',
          start: [Math.min(posX, oPosX) - 0.4, 0.02, oMaxZ],
          end: [Math.max(posX, oPosX) + 0.4, 0.02, oMaxZ],
          targetId: other.id,
          targetName: other.name,
          label: `Back Edge Align: ${other.name}`,
        },
      });
    }

    // 4. Flush Front-to-Back Edge (target behind other)
    const deltaFrontBack = Math.abs(tMinZ - oMaxZ);
    if (deltaFrontBack <= effectiveTolZ) {
      const snappedZ = Number((oMaxZ + tExtentZ).toFixed(4));
      candidates.push({
        axis: 'z',
        snappedValue: snappedZ,
        delta: Math.abs(posZ - snappedZ),
        priority: 21,
        type: 'edge',
        guide: {
          id: `align-edge-flush-fb-${other.id}`,
          type: 'edge',
          axis: 'z',
          start: [Math.min(posX, oPosX) - 0.3, 0.02, oMaxZ],
          end: [Math.max(posX, oPosX) + 0.3, 0.02, oMaxZ],
          targetId: other.id,
          targetName: other.name,
          label: `Flush Front-Back: ${other.name}`,
        },
      });
    }

    // 5. Flush Back-to-Front Edge (target in front of other)
    const deltaBackFront = Math.abs(tMaxZ - oMinZ);
    if (deltaBackFront <= effectiveTolZ) {
      const snappedZ = Number((oMinZ - tExtentZ).toFixed(4));
      candidates.push({
        axis: 'z',
        snappedValue: snappedZ,
        delta: Math.abs(posZ - snappedZ),
        priority: 21,
        type: 'edge',
        guide: {
          id: `align-edge-flush-bf-${other.id}`,
          type: 'edge',
          axis: 'z',
          start: [Math.min(posX, oPosX) - 0.3, 0.02, oMinZ],
          end: [Math.max(posX, oPosX) + 0.3, 0.02, oMinZ],
          targetId: other.id,
          targetName: other.name,
          label: `Flush Back-Front: ${other.name}`,
        },
      });
    }
  }

  return candidates;
}
