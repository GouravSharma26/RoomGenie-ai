import { describe, it, expect } from 'vitest';
import type { FurniturePlacement, RoomDimensions } from '../../types/scene';
import { 
  snapToGrid, 
  calculateGridSnap, 
  calculateWallSnap, 
  calculateAlignmentSnap, 
  calculateSnap, 
  DEFAULT_SNAP_CONFIG,
  type SnapConfig,
  type SnapStateTracker
} from '../index';

const standardRoom: RoomDimensions = {
  width: 5.0,
  length: 4.0,
  height: 2.8,
};

const createMockPlacement = (overrides: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id: 'test-item-1',
  assetId: 'sofa-3seat',
  name: 'Modern Sofa',
  dimensions: [1.0, 0.8, 0.8],
  position: [0, 0.4, 0],
  rotationEuler: [0, 0, 0],
  scale: [1, 1, 1],
  ...overrides,
});

describe('Smart Magnetic Snapping — Milestone 2', () => {
  describe('Grid Snapping (gridSnapper)', () => {
    it('snaps coordinates to the default 5cm (0.05m) grid', () => {
      expect(snapToGrid(0.04, 0.05)).toBe(0.05);
      expect(snapToGrid(0.07, 0.05)).toBe(0.05);
      expect(snapToGrid(0.08, 0.05)).toBe(0.10);
      expect(snapToGrid(0.02, 0.05)).toBe(0.00);
      expect(snapToGrid(0.00, 0.05)).toBe(0.00);
    });

    it('snaps negative coordinates accurately without floating-point drift', () => {
      expect(snapToGrid(-0.14, 0.05)).toBe(-0.15);
      expect(snapToGrid(-0.12, 0.05)).toBe(-0.10);
      expect(snapToGrid(-1.23, 0.05)).toBe(-1.25);
    });

    it('supports alternative grid resolutions (1cm, 2.5cm, 10cm, 25cm)', () => {
      expect(snapToGrid(0.043, 0.01)).toBe(0.04);
      expect(snapToGrid(0.047, 0.01)).toBe(0.05);
      expect(snapToGrid(0.061, 0.025)).toBe(0.05);
      expect(snapToGrid(0.068, 0.025)).toBe(0.075);
      expect(snapToGrid(0.34, 0.10)).toBe(0.30);
      expect(snapToGrid(0.36, 0.10)).toBe(0.40);
      expect(snapToGrid(0.61, 0.25)).toBe(0.50);
      expect(snapToGrid(0.64, 0.25)).toBe(0.75);
    });

    it('returns original value if input or gridSize is invalid', () => {
      expect(snapToGrid(NaN, 0.05)).toBeNaN();
      expect(snapToGrid(1.5, 0)).toBe(1.5);
      expect(snapToGrid(1.5, -0.05)).toBe(1.5);
    });

    it('generates X and Z candidates with baseline priority 10', () => {
      const target = createMockPlacement({ position: [0.34, 0.4, -0.72] });
      const candidates = calculateGridSnap(target, DEFAULT_SNAP_CONFIG);

      expect(candidates).toHaveLength(2);
      const xCand = candidates.find((c) => c.axis === 'x');
      const zCand = candidates.find((c) => c.axis === 'z');

      expect(xCand?.snappedValue).toBe(0.35);
      expect(xCand?.priority).toBe(10);
      expect(xCand?.type).toBe('grid');

      expect(zCand?.snappedValue).toBe(-0.70);
      expect(zCand?.priority).toBe(10);
      expect(zCand?.type).toBe('grid');
    });

    it('returns no candidates when gridSnap or enabled is false', () => {
      const target = createMockPlacement({ position: [0.34, 0.4, -0.72] });
      expect(calculateGridSnap(target, { ...DEFAULT_SNAP_CONFIG, gridSnap: false })).toHaveLength(0);
      expect(calculateGridSnap(target, { ...DEFAULT_SNAP_CONFIG, enabled: false })).toHaveLength(0);
    });
  });

  describe('Wall Snapping (wallSnapper)', () => {
    it('snaps accurately to all 4 walls for axis-aligned furniture', () => {
      // Room: W=5.0 (X from -2.5 to 2.5), L=4.0 (Z from -2.0 to 2.0)
      // Item: width=1.0 (extentX=0.5), depth=0.8 (extentZ=0.4)

      // 1. Left Wall (X = -2.5). When center is at -1.90, left edge is at -2.40 (10cm from wall)
      const leftTarget = createMockPlacement({ position: [-1.90, 0.4, 0] });
      const leftCands = calculateWallSnap(leftTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(leftCands).toHaveLength(1);
      expect(leftCands[0].axis).toBe('x');
      expect(leftCands[0].snappedValue).toBe(-2.0); // -2.5 + 0.5 = -2.0
      expect(leftCands[0].type).toBe('wall');
      expect(leftCands[0].priority).toBe(30);

      // 2. Right Wall (X = 2.5). When center is at 1.90, right edge is at 2.40 (10cm from wall)
      const rightTarget = createMockPlacement({ position: [1.90, 0.4, 0] });
      const rightCands = calculateWallSnap(rightTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(rightCands).toHaveLength(1);
      expect(rightCands[0].axis).toBe('x');
      expect(rightCands[0].snappedValue).toBe(2.0); // 2.5 - 0.5 = 2.0

      // 3. Front Wall (Z = -2.0). When center is at -1.50, front edge is at -1.90 (10cm from wall)
      const frontTarget = createMockPlacement({ position: [0, 0.4, -1.50] });
      const frontCands = calculateWallSnap(frontTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(frontCands).toHaveLength(1);
      expect(frontCands[0].axis).toBe('z');
      expect(frontCands[0].snappedValue).toBe(-1.6); // -2.0 + 0.4 = -1.6

      // 4. Back Wall (Z = 2.0). When center is at 1.50, back edge is at 1.90 (10cm from wall)
      const backTarget = createMockPlacement({ position: [0, 0.4, 1.50] });
      const backCands = calculateWallSnap(backTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(backCands).toHaveLength(1);
      expect(backCands[0].axis).toBe('z');
      expect(backCands[0].snappedValue).toBe(1.6); // 2.0 - 0.4 = 1.6
    });

    it('accounts for rotated furniture (90 degree yaw)', () => {
      // Dimensions: width=1.0, depth=0.8.
      // Rotated 90 deg around Y: extent along X becomes depth/2 = 0.4, extent along Z becomes width/2 = 0.5
      const rotatedTarget = createMockPlacement({
        dimensions: [1.0, 0.8, 0.8],
        position: [-1.98, 0.4, 0],
        rotationEuler: [0, Math.PI / 2, 0],
      });

      const cands = calculateWallSnap(rotatedTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(cands).toHaveLength(1);
      expect(cands[0].axis).toBe('x');
      // With depth 0.8 rotated 90 deg, extentX is 0.4m. Left wall (-2.5) + extentX (0.4) = -2.10m
      expect(cands[0].snappedValue).toBe(-2.1);
    });

    it('accounts for rotated furniture at 45 degrees', () => {
      // 1.0m x 0.8m at 45 deg: corner extents extend diagonally (~0.636m)
      // Flush center at left wall is ~ -1.864m. Placed at -1.80m (distance ~0.064m <= 0.15m tolerance)
      const diagTarget = createMockPlacement({
        dimensions: [1.0, 0.8, 0.8],
        position: [-1.80, 0.4, 0],
        rotationEuler: [0, Math.PI / 4, 0],
      });

      const cands = calculateWallSnap(diagTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(cands).toHaveLength(1);
      expect(cands[0].axis).toBe('x');
      // Snapped position must be strictly greater than -2.0 because diagonal extent > 0.5
      expect(cands[0].snappedValue).toBeGreaterThan(-2.0);
    });

    it('accounts for non-uniform scaling', () => {
      // Dimensions [1.0, 0.8, 0.8] scaled [2.0, 1.0, 1.0] -> width = 2.0m, extentX = 1.0m
      const scaledTarget = createMockPlacement({
        dimensions: [1.0, 0.8, 0.8],
        scale: [2.0, 1.0, 1.0],
        position: [-1.42, 0.4, 0],
      });

      const cands = calculateWallSnap(scaledTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(cands).toHaveLength(1);
      expect(cands[0].axis).toBe('x');
      // Left wall (-2.5) + extentX (1.0) = -1.5m
      expect(cands[0].snappedValue).toBe(-1.5);
    });

    it('respects configurable wallOffset', () => {
      // Offset 0.05m (5cm gap from wall)
      const target = createMockPlacement({ position: [-1.90, 0.4, 0] });
      const config: SnapConfig = { ...DEFAULT_SNAP_CONFIG, wallOffset: 0.05 };

      const cands = calculateWallSnap(target, standardRoom, config);
      expect(cands).toHaveLength(1);
      // Left wall (-2.5) + offset (0.05) + extentX (0.5) = -1.95m
      expect(cands[0].snappedValue).toBe(-1.95);
    });

    it('does not snap when distance exceeds tolerance', () => {
      // Placed at center of room (X=0, Z=0)
      const centerTarget = createMockPlacement({ position: [0, 0.4, 0] });
      const cands = calculateWallSnap(centerTarget, standardRoom, DEFAULT_SNAP_CONFIG);
      expect(cands).toHaveLength(0);
    });
  });

  describe('Alignment Snapping (alignmentSnapper)', () => {
    it('snaps center-to-center along the X axis', () => {
      const other = createMockPlacement({
        id: 'other-1',
        name: 'Desk',
        position: [0.5, 0.4, -1.0],
      });

      // Target at X = 0.53 (within 5cm tolerance of other at X = 0.50)
      const target = createMockPlacement({
        id: 'target-1',
        position: [0.53, 0.4, 1.0],
      });

      const cands = calculateAlignmentSnap(target, [other, target], DEFAULT_SNAP_CONFIG);
      const centerCand = cands.find((c) => c.axis === 'x' && c.type === 'center');

      expect(centerCand).toBeDefined();
      expect(centerCand?.snappedValue).toBe(0.5);
      expect(centerCand?.priority).toBe(25);
    });

    it('snaps center-to-center along the Z axis', () => {
      const other = createMockPlacement({
        id: 'other-1',
        name: 'Desk',
        position: [-1.0, 0.4, -0.6],
      });

      // Target at Z = -0.58 (within 5cm tolerance of other at Z = -0.60)
      const target = createMockPlacement({
        id: 'target-1',
        position: [1.0, 0.4, -0.58],
      });

      const cands = calculateAlignmentSnap(target, [other, target], DEFAULT_SNAP_CONFIG);
      const centerCand = cands.find((c) => c.axis === 'z' && c.type === 'center');

      expect(centerCand).toBeDefined();
      expect(centerCand?.snappedValue).toBe(-0.6);
      expect(centerCand?.priority).toBe(25);
    });

    it('snaps edge-to-edge (Left-to-Left and Right-to-Right)', () => {
      // Other: center X = 0, width = 1.0 -> leftEdge = -0.5, rightEdge = +0.5
      const other = createMockPlacement({
        id: 'other-1',
        name: 'Bookshelf',
        dimensions: [1.0, 1.8, 0.4],
        position: [0, 0.9, -1.0],
      });

      // Target: width = 0.6 -> extentX = 0.3.
      // Left edge align: target left edge should be -0.5 -> target center = -0.5 + 0.3 = -0.2
      const targetNearLeft = createMockPlacement({
        id: 'target-1',
        dimensions: [0.6, 0.8, 0.6],
        position: [-0.18, 0.4, 0.5],
      });

      const cands = calculateAlignmentSnap(targetNearLeft, [other, targetNearLeft], DEFAULT_SNAP_CONFIG);
      const edgeCand = cands.find((c) => c.axis === 'x' && c.guide.id.includes('left-left'));

      expect(edgeCand).toBeDefined();
      expect(edgeCand?.snappedValue).toBe(-0.2);
      expect(edgeCand?.priority).toBe(22);
    });

    it('snaps flush side-by-side (Target left edge to Other right edge)', () => {
      // Other: center X = 0, width = 1.0 -> rightEdge = 0.5
      const other = createMockPlacement({
        id: 'other-1',
        name: 'Sofa',
        dimensions: [1.0, 0.8, 0.8],
        position: [0, 0.4, 0],
      });

      // Target: width = 0.6 -> extentX = 0.3.
      // Flush right: target left edge sits at 0.5 -> target center = 0.5 + 0.3 = 0.8
      const target = createMockPlacement({
        id: 'target-1',
        dimensions: [0.6, 0.8, 0.6],
        position: [0.82, 0.4, 0],
      });

      const cands = calculateAlignmentSnap(target, [other, target], DEFAULT_SNAP_CONFIG);
      const flushCand = cands.find((c) => c.axis === 'x' && c.guide.id.includes('flush-lr'));

      expect(flushCand).toBeDefined();
      expect(flushCand?.snappedValue).toBe(0.8);
      expect(flushCand?.priority).toBe(21);
    });

    it('excludes target itself from alignment matching', () => {
      const target = createMockPlacement({ id: 'target-solo', position: [0.3, 0.4, 0.3] });
      const cands = calculateAlignmentSnap(target, [target], DEFAULT_SNAP_CONFIG);
      expect(cands).toHaveLength(0);
    });
  });

  describe('Master Snap Manager & Priority Resolution (calculateSnap)', () => {
    it('prioritizes Wall Snapping over Grid Snapping when near a wall', () => {
      // Target placed near left wall: X = -1.91 (5cm grid would snap to -1.90, but wall snap is -2.0)
      const target = createMockPlacement({ position: [-1.91, 0.4, 0] });
      const result = calculateSnap(target, [target], standardRoom, DEFAULT_SNAP_CONFIG);

      expect(result.snappedX).toBe(true);
      expect(result.position[0]).toBe(-2.0); // Snapped to Wall (-2.0), NOT to grid (-1.90)
      expect(result.appliedTypes).toContain('wall');
      expect(result.guides.some((g) => g.type === 'wall')).toBe(true);
    });

    it('prioritizes Alignment Snapping over Grid Snapping', () => {
      // Other object center at X = 0.33
      const other = createMockPlacement({ id: 'other', position: [0.33, 0.4, -1.0] });
      // Target at X = 0.34 (Grid snap would choose 0.35, but alignment chooses 0.33)
      const target = createMockPlacement({ id: 'target', position: [0.34, 0.4, 1.0] });

      const result = calculateSnap(target, [other, target], standardRoom, DEFAULT_SNAP_CONFIG);
      expect(result.snappedX).toBe(true);
      expect(result.position[0]).toBe(0.33); // Alignment (0.33) won over grid (0.35)
      expect(result.appliedTypes).toContain('center');
    });

    it('falls back to Grid Snapping when neither wall nor alignment applies', () => {
      const target = createMockPlacement({ position: [0.23, 0.4, -0.67] });
      const result = calculateSnap(target, [target], standardRoom, DEFAULT_SNAP_CONFIG);

      expect(result.snappedX).toBe(true);
      expect(result.snappedZ).toBe(true);
      expect(result.position[0]).toBe(0.25);
      expect(result.position[2]).toBe(-0.65);
      expect(result.appliedTypes).toContain('grid');
    });

    it('rejects a snapped candidate that causes an illegal physical collision', () => {
      // Obstacle placed flush against left wall: center [-2.0, 0.4, 0], dims [1.0, 0.8, 1.0]
      const obstacle = createMockPlacement({
        id: 'wall-obstacle',
        dimensions: [1.0, 0.8, 1.0],
        position: [-2.0, 0.4, 0],
      });

      // Target trying to place directly overlapping obstacle at X = -1.90, Z = 0
      const target = createMockPlacement({
        id: 'target',
        dimensions: [1.0, 0.8, 1.0],
        position: [-1.90, 0.4, 0],
      });

      // Snap manager must not force the target into physical collision at -2.0
      const result = calculateSnap(target, [obstacle, target], standardRoom, DEFAULT_SNAP_CONFIG);
      // Target should not be placed at -2.0 if it collides with obstacle
      expect(result.position[0]).not.toBe(-2.0);
    });

    it('maintains hysteresis stickiness when state tracker is active', () => {
      const tracker: SnapStateTracker = {
        activeXSnap: { type: 'wall', targetValue: -2.0 },
      };

      // Normal wall tolerance is 0.15m. Distance here is 0.17m (beyond 0.15m, but within 0.15 * 1.25 = 0.1875m)
      const target = createMockPlacement({ position: [-1.83, 0.4, 0] });
      const result = calculateSnap(target, [target], standardRoom, DEFAULT_SNAP_CONFIG, tracker);

      expect(result.snappedX).toBe(true);
      expect(result.position[0]).toBe(-2.0); // Remains snapped due to hysteresis
    });

    it('releases snap when moved beyond the hysteresis release threshold', () => {
      const tracker: SnapStateTracker = {
        activeXSnap: { type: 'wall', targetValue: -2.0 },
      };

      // Distance is 0.22m, which exceeds even the 0.1875m hysteresis threshold
      // Test with gridSnap disabled to verify tracker is cleared
      const target = createMockPlacement({ position: [-1.78, 0.4, 0] });
      const result = calculateSnap(
        target,
        [target],
        standardRoom,
        { ...DEFAULT_SNAP_CONFIG, gridSnap: false },
        tracker
      );

      expect(result.appliedTypes).not.toContain('wall');
      expect(tracker.activeXSnap).toBeUndefined();
    });

    it('returns exact original position when snapping is disabled', () => {
      const target = createMockPlacement({ position: [0.1234, 0.4, -0.5678] });
      const result = calculateSnap(
        target,
        [target],
        standardRoom,
        { ...DEFAULT_SNAP_CONFIG, enabled: false }
      );

      expect(result.position[0]).toBe(0.1234);
      expect(result.position[2]).toBe(-0.5678);
      expect(result.guides).toHaveLength(0);
      expect(result.snappedX).toBe(false);
      expect(result.snappedZ).toBe(false);
    });

    it('computes 100 snap iterations in under 50ms (real-time 60fps performance)', () => {
      const sceneObjects: FurniturePlacement[] = [
        createMockPlacement({ id: 'obs-1', position: [-1.5, 0.4, -1.0] }),
        createMockPlacement({ id: 'obs-2', position: [1.0, 0.4, 0.5] }),
        createMockPlacement({ id: 'obs-3', position: [0.0, 0.4, -0.5] }),
      ];
      const target = createMockPlacement({ id: 'target', position: [0.24, 0.4, -0.48] });
      const tracker: SnapStateTracker = {};

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        target.position[0] = 0.2 + (i % 10) * 0.05;
        calculateSnap(target, [...sceneObjects, target], standardRoom, DEFAULT_SNAP_CONFIG, tracker);
      }
      const durationMs = performance.now() - start;

      // 100 calculations must run in well under 50ms (< 0.5ms per frame)
      expect(durationMs).toBeLessThan(50);
    });
  });
});
