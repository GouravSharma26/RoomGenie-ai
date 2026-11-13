import type { FurniturePlacement } from '../../types/scene';
import type { SnapCandidate, SnapConfig } from './snappingTypes';

/**
 * Snaps a single coordinate value to the nearest floor grid increment.
 *
 * @param value Coordinate value in metres
 * @param gridSize Grid spacing step in metres (e.g. 0.05 for 5cm)
 * @returns Quantized coordinate value
 */
export function snapToGrid(value: number, gridSize: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(gridSize) || gridSize <= 0) {
    return value;
  }
  const snapped = Math.round(value / gridSize) * gridSize;
  return Number(snapped.toFixed(4));
}

/**
 * Evaluates floor grid snapping candidates for a target furniture placement.
 * Grid snapping has baseline priority (10) and applies whenever gridSnap is enabled.
 */
export function calculateGridSnap(
  target: FurniturePlacement,
  config: SnapConfig
): SnapCandidate[] {
  if (!config.enabled || !config.gridSnap || config.gridSize <= 0) {
    return [];
  }

  const [posX, , posZ] = target.position;
  const snappedX = snapToGrid(posX, config.gridSize);
  const snappedZ = snapToGrid(posZ, config.gridSize);

  const candidates: SnapCandidate[] = [];

  const deltaX = Math.abs(snappedX - posX);
  candidates.push({
    axis: 'x',
    snappedValue: snappedX,
    delta: deltaX,
    priority: 10,
    type: 'grid',
    guide: {
      id: `grid-x-${snappedX}`,
      type: 'grid',
      axis: 'x',
      start: [snappedX, 0.005, posZ - 0.4],
      end: [snappedX, 0.005, posZ + 0.4],
      label: `Grid ${Math.round(config.gridSize * 100)}cm`,
    },
  });

  const deltaZ = Math.abs(snappedZ - posZ);
  candidates.push({
    axis: 'z',
    snappedValue: snappedZ,
    delta: deltaZ,
    priority: 10,
    type: 'grid',
    guide: {
      id: `grid-z-${snappedZ}`,
      type: 'grid',
      axis: 'z',
      start: [posX - 0.4, 0.005, snappedZ],
      end: [posX + 0.4, 0.005, snappedZ],
      label: `Grid ${Math.round(config.gridSize * 100)}cm`,
    },
  });

  return candidates;
}
