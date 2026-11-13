import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { buildCornerJunctions } from '../parametric/geometry/cornerJunctionBuilder';
import { deriveWallProperties, createRectangularWalls } from '../parametric/roomGeometry';
import type { WallSegment, Point2D } from '../parametric/parametricTypes';

describe('Phase 5.3: Architectural Openings & Interactive Wall Editing', () => {
  beforeEach(() => {
    useEditorStore.setState({
      history: [],
      future: [],
      selectedId: null,
      selectedWallId: null,
      selectedOpeningId: null,
    });
    useEditorStore.getState().clearScene();
    useEditorStore.getState().setRoomDimensions({
      width: 6.0,
      length: 5.0,
      height: 2.8,
    });
    useEditorStore.setState({ history: [], future: [] });
  });

  describe('Stage 2 & 3 — Wall & Opening Selection Architecture', () => {
    it('selects and deselects a wall independently', () => {
      const store = useEditorStore.getState();
      expect(store.selectedWallId).toBeNull();

      store.selectWall('wall-south');
      expect(useEditorStore.getState().selectedWallId).toBe('wall-south');
      expect(useEditorStore.getState().selectedId).toBeNull(); // Clears furniture selection
      expect(useEditorStore.getState().selectedOpeningId).toBeNull();

      store.selectWall(null);
      expect(useEditorStore.getState().selectedWallId).toBeNull();
    });

    it('clears wall selection when furniture is selected, and vice versa', () => {
      const store = useEditorStore.getState();
      store.selectWall('wall-east');
      expect(useEditorStore.getState().selectedWallId).toBe('wall-east');

      // Select furniture
      store.selectObject('initial-sofa');
      expect(useEditorStore.getState().selectedId).toBe('initial-sofa');
      expect(useEditorStore.getState().selectedWallId).toBeNull(); // Wall selection cleared
    });

    it('gives opening selection precedence and sets host wall reference', () => {
      const store = useEditorStore.getState();
      const addRes = store.addWallOpening('wall-south', 'door');
      expect(addRes.success).toBe(true);

      const opId = addRes.openingId!;
      expect(useEditorStore.getState().selectedOpeningId).toBe(opId);
      expect(useEditorStore.getState().selectedWallId).toBe('wall-south');
      expect(useEditorStore.getState().selectedId).toBeNull();

      // Clear architectural selection
      store.clearArchitecturalSelection();
      expect(useEditorStore.getState().selectedOpeningId).toBeNull();
      expect(useEditorStore.getState().selectedWallId).toBeNull();
    });
  });

  describe('Stage 4 & 5 — Add, Move, Resize, and Delete Openings', () => {
    it('adds a valid door to a wall at a deterministic position', () => {
      const store = useEditorStore.getState();
      const res = store.addWallOpening('wall-south', 'door', { width: 1.0, height: 2.1 });
      expect(res.success).toBe(true);
      expect(res.openingId).toBeDefined();

      const openings = useEditorStore.getState().scene.room.openings!;
      expect(openings).toHaveLength(1);
      expect(openings[0].wallId).toBe('wall-south');
      expect(openings[0].type).toBe('door');
      expect(openings[0].width).toBe(1.0);
      expect(openings[0].height).toBe(2.1);
      expect(openings[0].sillHeight).toBe(0.0);
      expect(openings[0].swing).toBe('inward-left');
    });

    it('adds a valid window with custom sill height', () => {
      const store = useEditorStore.getState();
      const res = store.addWallOpening('wall-north', 'window', {
        width: 1.5,
        height: 1.2,
        sillHeight: 0.85,
      });
      expect(res.success).toBe(true);

      const op = useEditorStore.getState().scene.room.openings![0];
      expect(op.type).toBe('window');
      expect(op.sillHeight).toBe(0.85);
      expect(op.height).toBe(1.2);
    });

    it('rejects adding an opening to a non-existent wall', () => {
      const store = useEditorStore.getState();
      const res = store.addWallOpening('non-existent-wall-id', 'door');
      expect(res.success).toBe(false);
      expect(res.error).toContain('does not exist');
      expect(useEditorStore.getState().scene.room.openings ?? []).toHaveLength(0);
    });

    it('rejects adding an opening that exceeds wall length', () => {
      const store = useEditorStore.getState();
      // Wall length is 6.0m
      const res = store.addWallOpening('wall-south', 'door', { width: 10.0 });
      expect(res.success).toBe(false);
      expect(res.error).toContain('exceeds');
    });

    it('rejects adding an opening that exceeds room height', () => {
      const store = useEditorStore.getState();
      // Room height is 2.8m
      const res = store.addWallOpening('wall-south', 'window', {
        height: 2.5,
        sillHeight: 1.0, // 3.5m total > 2.8m
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('exceeds wall height');
    });

    it('moves an opening along the host wall and validates boundaries', () => {
      const store = useEditorStore.getState();
      const addRes = store.addWallOpening('wall-south', 'door', {
        distanceAlongWall: 1.0,
        width: 1.0,
      });
      expect(addRes.success).toBe(true);
      const opId = addRes.openingId!;

      // Move to valid position
      const moveRes = store.moveWallOpening(opId, 3.0);
      expect(moveRes.success).toBe(true);
      expect(
        useEditorStore.getState().scene.room.openings!.find((o) => o.id === opId)?.distanceAlongWall
      ).toBe(3.0);

      // Move to invalid position beyond wall length
      const invalidMove = store.moveWallOpening(opId, 5.5); // 5.5 + 1.0 = 6.5m > 6.0m
      expect(invalidMove.success).toBe(false);
      expect(invalidMove.error).toContain('exceeds');
      // Position remains at 3.0
      expect(
        useEditorStore.getState().scene.room.openings!.find((o) => o.id === opId)?.distanceAlongWall
      ).toBe(3.0);
    });

    it('resizes an opening and updates vertical dimensions and swing', () => {
      const store = useEditorStore.getState();
      const addRes = store.addWallOpening('wall-south', 'door', { width: 0.9, height: 2.1 });
      const opId = addRes.openingId!;

      // Update width and door swing
      const updateRes = store.updateWallOpening(opId, {
        width: 1.2,
        swing: 'outward-right',
      });
      expect(updateRes.success).toBe(true);

      const updated = useEditorStore.getState().scene.room.openings!.find((o) => o.id === opId)!;
      expect(updated.width).toBe(1.2);
      expect(updated.swing).toBe('outward-right');
    });

    it('deletes an opening cleanly', () => {
      const store = useEditorStore.getState();
      const addRes = store.addWallOpening('wall-south', 'door');
      const opId = addRes.openingId!;
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(1);

      const delRes = store.deleteWallOpening(opId);
      expect(delRes.success).toBe(true);
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(0);
      expect(useEditorStore.getState().selectedOpeningId).toBeNull();
    });
  });

  describe('Stage 6 & 8 — Undo/Redo Integration & History Symmetry', () => {
    it('supports full undo and redo for adding an opening', () => {
      const store = useEditorStore.getState();
      expect(store.canUndo()).toBe(false);

      const res = store.addWallOpening('wall-south', 'door');
      expect(res.success).toBe(true);
      expect(useEditorStore.getState().canUndo()).toBe(true);
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(1);

      // Undo
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.room.openings ?? []).toHaveLength(0);
      expect(useEditorStore.getState().canRedo()).toBe(true);

      // Redo
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(1);
    });

    it('supports undo for moving an opening', () => {
      const store = useEditorStore.getState();
      const addRes = store.addWallOpening('wall-south', 'door', { distanceAlongWall: 1.0 });
      const opId = addRes.openingId!;

      store.moveWallOpening(opId, 3.5);
      expect(
        useEditorStore.getState().scene.room.openings!.find((o) => o.id === opId)?.distanceAlongWall
      ).toBe(3.5);

      // Undo move
      useEditorStore.getState().undo();
      expect(
        useEditorStore.getState().scene.room.openings!.find((o) => o.id === opId)?.distanceAlongWall
      ).toBe(1.0);
    });

    it('supports undo for deleting an opening', () => {
      const store = useEditorStore.getState();
      const addRes = store.addWallOpening('wall-south', 'door');
      const opId = addRes.openingId!;

      store.deleteWallOpening(opId);
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(0);

      // Undo delete
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.room.openings).toHaveLength(1);
      expect(useEditorStore.getState().scene.room.openings![0].id).toBe(opId);
    });
  });

  describe('Stage 7 — Wall Corner Geometry Hardening', () => {
    it('builds clean 90-degree corner junctions for a rectangular room', () => {
      const walls = createRectangularWalls(5.0, 4.0, 2.8, 0.15);
      const derived = walls.map((w) => deriveWallProperties(w));

      const result = buildCornerJunctions(derived, 2.8);
      expect(result.cornerCount).toBe(4);
      expect(result.triangleCount).toBeGreaterThan(0);
      expect(result.vertexCount).toBeGreaterThan(0);

      const geo = result.junctionGeometry;
      expect(geo.getAttribute('position')).toBeDefined();
      expect(geo.getAttribute('normal')).toBeDefined();
    });

    it('handles acute wall corner (e.g. 45 degrees) with bounded miter limit', () => {
      // 3 walls forming a sharp triangle with an acute corner
      const walls: WallSegment[] = [
        { id: 'w1', startPoint: [0, 0], endPoint: [4, 0], height: 2.8, thickness: 0.2 },
        { id: 'w2', startPoint: [4, 0], endPoint: [2, 2], height: 2.8, thickness: 0.2 },
        { id: 'w3', startPoint: [2, 2], endPoint: [0, 0], height: 2.8, thickness: 0.2 },
      ];
      const derived = walls.map((w) => deriveWallProperties(w));

      const result = buildCornerJunctions(derived, 2.8, 1.5);
      expect(result.cornerCount).toBe(3);

      const box = result.junctionGeometry.boundingBox!;
      expect(box).toBeDefined();
      // Bounded miter guarantees no infinite coordinate blowout
      expect(box.max.x).toBeLessThan(10.0);
      expect(box.min.x).toBeGreaterThan(-10.0);
    });

    it('handles obtuse wall corner (e.g. 135 degrees in pentagonal room)', () => {
      const pentaWalls: WallSegment[] = [
        { id: 'p1', startPoint: [-2.0, 2.5] as Point2D, endPoint: [2.0, 2.5] as Point2D },
        { id: 'p2', startPoint: [2.0, 2.5] as Point2D,  endPoint: [3.0, -0.5] as Point2D },
        { id: 'p3', startPoint: [3.0, -0.5] as Point2D, endPoint: [0.0, -2.5] as Point2D },
        { id: 'p4', startPoint: [0.0, -2.5] as Point2D, endPoint: [-3.0, -0.5] as Point2D },
        { id: 'p5', startPoint: [-3.0, -0.5] as Point2D, endPoint: [-2.0, 2.5] as Point2D },
      ];
      const derived = pentaWalls.map((w) => deriveWallProperties(w));

      const result = buildCornerJunctions(derived, 2.8);
      expect(result.cornerCount).toBe(5);
      expect(result.triangleCount).toBeGreaterThan(0);
    });

    it('handles concave corner (e.g. in L-shaped room) cleanly on interior wedge', () => {
      const lWalls: WallSegment[] = [
        { id: 'l1', startPoint: [-3.0, 3.0] as Point2D, endPoint: [3.0, 3.0] as Point2D },
        { id: 'l2', startPoint: [3.0, 3.0] as Point2D,  endPoint: [3.0, 0.0] as Point2D },
        { id: 'l3', startPoint: [3.0, 0.0] as Point2D,  endPoint: [0.0, 0.0] as Point2D }, // Concave vertex at [0, 0]
        { id: 'l4', startPoint: [0.0, 0.0] as Point2D,  endPoint: [0.0, -3.0] as Point2D },
        { id: 'l5', startPoint: [0.0, -3.0] as Point2D, endPoint: [-3.0, -3.0] as Point2D },
        { id: 'l6', startPoint: [-3.0, -3.0] as Point2D, endPoint: [-3.0, 3.0] as Point2D },
      ];
      const derived = lWalls.map((w) => deriveWallProperties(w));

      const result = buildCornerJunctions(derived, 2.8);
      expect(result.cornerCount).toBe(6);
      expect(result.junctionGeometry.getAttribute('position').count).toBeGreaterThan(0);
    });
  });
});
