import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { SAMPLE_CATALOG } from '../data/catalog';
import { serializeCanonicalScene, parseCanonicalScene } from '../validation/sceneValidation';
import type { CanonicalScene, FurniturePlacement, Vector3Tuple } from '../../types/scene';

const createPlacement = (
  id: string,
  catalogId: string,
  position: Vector3Tuple,
  rotationEuler: Vector3Tuple = [0, 0, 0]
): FurniturePlacement => {
  const item = SAMPLE_CATALOG.find((c) => c.id === catalogId);
  if (!item) throw new Error(`Catalog item ${catalogId} not found`);
  return {
    id,
    assetId: item.id,
    name: item.name,
    dimensions: [...item.dimensions],
    scale: [1, 1, 1],
    position: [...position],
    rotationEuler: [...rotationEuler],
  };
};

describe('Phase 3.3: Editor Store Integration & Atomic Undo/Redo', () => {
  beforeEach(() => {
    // Reset store to known baseline room before each test
    useEditorStore.getState().clearScene();
    useEditorStore.getState().setRoomDimensions({ width: 8.0, length: 8.0, height: 2.8 });

    // Clear history/future created by beforeEach setup
    useEditorStore.setState({
      history: [],
      future: [],
    });
  });

  describe('Store Actions', () => {
    it('successfully attaches coffee table to sofa front socket', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });
      useEditorStore.setState({ history: [], future: [] });

      const attachRes = useEditorStore.getState().attachObjectToSocket(
        'sofa-1',
        'sofa-front-table',
        'table-1',
        { gap: 0.45 }
      );

      expect(attachRes.success).toBe(true);
      const state = useEditorStore.getState();
      expect(state.scene.relationships?.length).toBe(1);
      const rel = state.scene.relationships![0];
      expect(rel.anchorObjectId).toBe('sofa-1');
      expect(rel.childObjectId).toBe('table-1');
      expect(rel.socketId).toBe('sofa-front-table');
      expect(rel.gap).toBe(0.45);

      // Child table positioned directly in front of sofa (+Z)
      const updatedTable = state.scene.objects.find((o) => o.id === 'table-1')!;
      expect(updatedTable.position[0]).toBeCloseTo(0, 2);
      expect(updatedTable.position[2]).toBeGreaterThan(sofa.dimensions[2] / 2);
    });

    it('rejects incompatible attachment without modifying state or history', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const wardrobe = createPlacement('wardrobe-1', 'storage-wardrobe-compact', [2, 1.0, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, wardrobe],
        relationships: [],
      });
      useEditorStore.setState({ history: [], future: [] });

      const attachRes = useEditorStore.getState().attachObjectToSocket(
        'sofa-1',
        'sofa-front-table',
        'wardrobe-1'
      );

      expect(attachRes.success).toBe(false);
      expect(attachRes.error).toContain('not compatible');
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);
      expect(useEditorStore.getState().history.length).toBe(0);
    });

    it('rejects invalid socket ID without modifying state', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });
      useEditorStore.setState({ history: [], future: [] });

      const res = useEditorStore.getState().attachObjectToSocket(
        'sofa-1',
        'nonexistent-socket',
        'table-1'
      );

      expect(res.success).toBe(false);
      expect(useEditorStore.getState().history.length).toBe(0);
    });

    it('detaches object from socket and preserves world transform', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      const tablePosBefore = [...useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position];

      const detached = useEditorStore.getState().detachObjectFromSocket('table-1');
      expect(detached).toBe(true);

      const state = useEditorStore.getState();
      expect(state.scene.relationships?.length).toBe(0);
      const tablePosAfter = state.scene.objects.find((o) => o.id === 'table-1')!.position;
      expect(tablePosAfter).toEqual(tablePosBefore);

      // Detaching unattached item returns false
      const secondDetach = useEditorStore.getState().detachObjectFromSocket('table-1');
      expect(secondDetach).toBe(false);
    });

    it('updates relationship gap within bounds and repositions child', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.35 });
      const pos1Z = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position[2];

      const gapRes = useEditorStore.getState().setRelationshipGap('table-1', 0.60);
      expect(gapRes.success).toBe(true);

      const state = useEditorStore.getState();
      expect(state.scene.relationships![0].gap).toBe(0.60);
      const pos2Z = state.scene.objects.find((o) => o.id === 'table-1')!.position[2];
      expect(pos2Z).toBeGreaterThan(pos1Z);
    });

    it('moves group atomically and rejects if any member violates room boundaries', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      useEditorStore.setState({ history: [], future: [] });

      // Valid group move to [1.0, 0.425, -1.0] with 90 deg rotation
      const moveRes = useEditorStore.getState().moveGroup('sofa-1', [1.0, 0.425, -1.0], [0, Math.PI / 2, 0]);
      expect(moveRes.success).toBe(true);
      expect(moveRes.movedObjectIds).toContain('sofa-1');
      expect(moveRes.movedObjectIds).toContain('table-1');

      const state = useEditorStore.getState();
      const movedSofa = state.scene.objects.find((o) => o.id === 'sofa-1')!;
      const movedTable = state.scene.objects.find((o) => o.id === 'table-1')!;
      expect(movedSofa.position[0]).toBe(1.0);
      expect(movedTable.rotationEuler[1]).toBeCloseTo(Math.PI / 2, 2);

      // Attempt invalid group move that pushes child table outside room (+Z boundary is 4.0m)
      const invalidMove = useEditorStore.getState().moveGroup('sofa-1', [0, 0.425, 3.8], [0, 0, 0]);
      expect(invalidMove.success).toBe(false);
      expect(invalidMove.violations?.length).toBeGreaterThan(0);

      // Verify sofa and table remain at previous valid coordinates (atomic rollback)
      const rolledBackSofa = useEditorStore.getState().scene.objects.find((o) => o.id === 'sofa-1')!;
      expect(rolledBackSofa.position[0]).toBe(1.0);
    });

    it('rejects group movement when any group member collides with an external obstacle', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);
      const wardrobe = createPlacement('obstacle-1', 'storage-wardrobe-compact', [-2.0, 1.0, 0]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table, wardrobe],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      useEditorStore.setState({ history: [], future: [] });

      // Move sofa directly toward the wardrobe obstacle
      const blockedMove = useEditorStore.getState().moveGroup('sofa-1', [-2.0, 0.425, 0], [0, 0, 0]);
      expect(blockedMove.success).toBe(false);
      expect(blockedMove.violations?.some((v) => v.includes('collides with external furniture'))).toBe(true);

      // Ensure no history was created for failed move
      expect(useEditorStore.getState().history.length).toBe(0);
    });
  });

  describe('Atomic Undo/Redo', () => {
    it('creates exactly 1 history entry for attachment, and undo/redo cleanly toggles relationship', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });
      useEditorStore.setState({ history: [], future: [] });

      const tablePosBefore = [...table.position];

      // Attach
      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      expect(useEditorStore.getState().history.length).toBe(1);
      expect(useEditorStore.getState().future.length).toBe(0);
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);

      // Undo
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().history.length).toBe(0);
      expect(useEditorStore.getState().future.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);
      expect(useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position).toEqual(tablePosBefore);

      // Redo
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().history.length).toBe(1);
      expect(useEditorStore.getState().future.length).toBe(0);
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships![0].socketId).toBe('sofa-front-table');
    });

    it('creates exactly 1 history entry for detachment and undo restores relationship', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      useEditorStore.setState({ history: [], future: [] });

      // Detach
      useEditorStore.getState().detachObjectFromSocket('table-1');
      expect(useEditorStore.getState().history.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);

      // Undo
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships![0].socketId).toBe('sofa-front-table');

      // Redo
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);
    });

    it('creates exactly 1 history entry for gap update and undo restores previous gap and position', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.35 });
      useEditorStore.setState({ history: [], future: [] });

      const posBeforeZ = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position[2];

      useEditorStore.getState().setRelationshipGap('table-1', 0.65);
      expect(useEditorStore.getState().history.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships![0].gap).toBe(0.65);

      // Undo
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.relationships![0].gap).toBe(0.35);
      expect(useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position[2]).toBe(posBeforeZ);

      // Redo
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().scene.relationships![0].gap).toBe(0.65);
    });

    it('creates exactly 1 history entry for group movement and restores all objects on undo', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      useEditorStore.setState({ history: [], future: [] });

      const sofaBefore = [...useEditorStore.getState().scene.objects.find((o) => o.id === 'sofa-1')!.position];
      const tableBefore = [...useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position];

      useEditorStore.getState().moveGroup('sofa-1', [1.5, 0.425, -1.0], [0, 0, 0]);
      expect(useEditorStore.getState().history.length).toBe(1);

      // Undo
      useEditorStore.getState().undo();
      const sofaAfterUndo = useEditorStore.getState().scene.objects.find((o) => o.id === 'sofa-1')!.position;
      const tableAfterUndo = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1')!.position;
      expect(sofaAfterUndo).toEqual(sofaBefore);
      expect(tableAfterUndo).toEqual(tableBefore);

      // Redo
      useEditorStore.getState().redo();
      const sofaAfterRedo = useEditorStore.getState().scene.objects.find((o) => o.id === 'sofa-1')!.position;
      expect(sofaAfterRedo[0]).toBe(1.5);
    });

    it('undoing furniture deletion restores both furniture and its relationship', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      useEditorStore.setState({ history: [], future: [] });

      // Delete anchor sofa
      useEditorStore.getState().deleteObject('sofa-1');
      expect(useEditorStore.getState().scene.objects.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);

      // Undo deletion
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.objects.length).toBe(2);
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);
      expect(useEditorStore.getState().scene.relationships![0].anchorObjectId).toBe('sofa-1');
      expect(useEditorStore.getState().scene.relationships![0].childObjectId).toBe('table-1');
    });
  });

  describe('Lifecycle Integration', () => {
    it('deleting an anchor item automatically removes attached child relationships', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);

      useEditorStore.getState().deleteObject('sofa-1');
      const state = useEditorStore.getState();
      expect(state.scene.objects.find((o) => o.id === 'sofa-1')).toBeUndefined();
      expect(state.scene.relationships?.length).toBe(0);
    });

    it('deleting a child item automatically removes its relationship', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);

      useEditorStore.getState().deleteObject('table-1');
      const state = useEditorStore.getState();
      expect(state.scene.objects.find((o) => o.id === 'table-1')).toBeUndefined();
      expect(state.scene.relationships?.length).toBe(0);
    });

    it('duplicating furniture does not duplicate relationships referencing original furniture', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      useEditorStore.getState().selectObject('sofa-1');

      useEditorStore.getState().duplicateSelected();
      const state = useEditorStore.getState();
      expect(state.scene.objects.length).toBe(3);
      // Still exactly 1 relationship (sofa-1 -> table-1). Duplicate sofa has no relationships.
      expect(state.scene.relationships?.length).toBe(1);
      expect(state.scene.relationships![0].anchorObjectId).toBe('sofa-1');
    });

    it('loading a legacy scene without relationships initializes relationships array as empty', () => {
      const legacyScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 6.0, length: 5.0, height: 2.8 },
        objects: [
          createPlacement('sofa-legacy', 'sofa-modern-3seater', [0, 0.425, 0]),
        ],
      };

      useEditorStore.getState().loadScene(legacyScene);
      const state = useEditorStore.getState();
      expect(state.scene.relationships).toBeDefined();
      expect(state.scene.relationships?.length).toBe(0);
    });

    it('loading a scene with orphaned or invalid relationship references purges them cleanly', () => {
      const dirtyScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 6.0, length: 5.0, height: 2.8 },
        objects: [
          createPlacement('sofa-valid', 'sofa-modern-3seater', [0, 0.425, 0]),
        ],
        relationships: [
          {
            id: 'rel-orphaned',
            anchorObjectId: 'sofa-valid',
            childObjectId: 'missing-child',
            socketId: 'sofa-front-table',
            gap: 0.45,
            relativeYaw: 0,
          },
        ],
      };

      useEditorStore.getState().loadScene(dirtyScene);
      const state = useEditorStore.getState();
      expect(state.scene.relationships?.length).toBe(0);
    });

    it('clearScene removes all relationships along with furniture', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2, 0.225, 2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
      });

      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1');
      expect(useEditorStore.getState().scene.relationships?.length).toBe(1);

      useEditorStore.getState().clearScene();
      const state = useEditorStore.getState();
      expect(state.scene.objects.length).toBe(0);
      expect(state.scene.relationships?.length).toBe(0);
    });
  });

  describe('Persistence & Serialization', () => {
    it('serializes and parses canonical scene with semantic relationships intact', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [0, 0.225, 1.2]);

      const sceneWithRel: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [
          {
            id: 'rel-sofa-table',
            anchorObjectId: 'sofa-1',
            childObjectId: 'table-1',
            socketId: 'sofa-front-table',
            gap: 0.45,
            relativeYaw: 0,
            createdAt: 1700000000000,
          },
        ],
      };

      const jsonStr = serializeCanonicalScene(sceneWithRel);
      expect(jsonStr).toContain('sofa-front-table');

      const parsed = parseCanonicalScene(jsonStr);
      expect(parsed).not.toBeNull();
      expect(parsed!.relationships?.length).toBe(1);
      const rel = parsed!.relationships![0];
      expect(rel.id).toBe('rel-sofa-table');
      expect(rel.anchorObjectId).toBe('sofa-1');
      expect(rel.childObjectId).toBe('table-1');
      expect(rel.gap).toBe(0.45);
    });

    it('parses legacy JSON without relationships field and returns valid scene', () => {
      const legacyJson = JSON.stringify({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'sofa-1',
            assetId: 'sofa-modern-3seater',
            name: 'Modern 3-Seater Sofa',
            dimensions: [2.1, 0.85, 0.9],
            scale: [1, 1, 1],
            rotationEuler: [0, 0, 0],
            position: [0, 0.425, 0],
          },
        ],
      });

      const parsed = parseCanonicalScene(legacyJson);
      expect(parsed).not.toBeNull();
      expect(parsed!.objects.length).toBe(1);
      expect(parsed!.relationships).toEqual([]);
    });
  });

  describe('Phase 3.4: Viewport Interaction & Group Dynamics', () => {
    it('updatePlacementPosition on anchor automatically moves attached child synchronously', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [0, 0.225, 1.2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });
      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.45 });
      useEditorStore.setState({ history: [], future: [] });

      // Move anchor by +1m in X
      useEditorStore.getState().updatePlacementPosition('sofa-1', [1.0, 0.425, 0.0]);

      const updatedSofa = useEditorStore.getState().scene.objects.find((o) => o.id === 'sofa-1');
      const updatedTable = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1');

      expect(updatedSofa?.position[0]).toBeCloseTo(1.0, 2);
      expect(updatedTable?.position[0]).toBeCloseTo(1.0, 2); // Table followed sofa in X
    });

    it('updatePlacementRotation on anchor automatically rotates attached child around anchor', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [0, 0.225, 1.2]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });
      useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.45 });

      // Rotate sofa 90 degrees (Math.PI / 2)
      useEditorStore.getState().updatePlacementRotation('sofa-1', [0, Math.PI / 2, 0]);

      const updatedTable = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1');
      // Table should now be shifted along +X (sofa's new front)
      expect(updatedTable?.position[0]).toBeGreaterThan(0.5);
    });

    it('detects compatible socket candidate during drag near anchor', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2.0, 0.225, 2.0]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });

      // Start drag interaction on table
      useEditorStore.getState().startInteraction('table-1');

      // Drag table close to sofa's front socket (prospective target is [0, 0.225, 1.2])
      useEditorStore.getState().updatePlacementPosition('table-1', [0.1, 0.225, 1.25]);

      const candidate = useEditorStore.getState().activeSocketCandidate;
      expect(candidate).not.toBeNull();
      expect(candidate?.socket.id).toBe('sofa-front-table');
      expect(candidate?.anchorPlacement.id).toBe('sofa-1');
      expect(candidate?.valid).toBe(true);
    });

    it('endInteraction commits attachment when dropped near valid socket candidate with exactly 1 history entry', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2.0, 0.225, 2.0]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });
      useEditorStore.setState({ history: [], future: [] });

      // Drag and drop near front socket
      useEditorStore.getState().startInteraction('table-1');
      useEditorStore.getState().updatePlacementPosition('table-1', [0.05, 0.225, 1.22]);

      expect(useEditorStore.getState().activeSocketCandidate).not.toBeNull();

      // Release drag
      useEditorStore.getState().endInteraction();

      // Attached
      const rels = useEditorStore.getState().scene.relationships || [];
      expect(rels.length).toBe(1);
      expect(rels[0].anchorObjectId).toBe('sofa-1');
      expect(rels[0].childObjectId).toBe('table-1');
      expect(rels[0].socketId).toBe('sofa-front-table');

      // Exactly 1 history entry
      expect(useEditorStore.getState().history.length).toBe(1);

      // Undo restores unattached state
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);
    });

    it('cancelInteraction restores initial snapshot, clears candidate, and leaves 0 history entries', () => {
      const sofa = createPlacement('sofa-1', 'sofa-modern-3seater', [0, 0.425, 0]);
      const table = createPlacement('table-1', 'table-oak-coffee', [2.0, 0.225, 2.0]);

      useEditorStore.getState().loadScene({
        schemaVersion: 1,
        unit: 'm',
        room: { width: 8.0, length: 8.0, height: 2.8 },
        objects: [sofa, table],
        relationships: [],
      });
      useEditorStore.setState({ history: [], future: [] });

      useEditorStore.getState().startInteraction('table-1');
      useEditorStore.getState().updatePlacementPosition('table-1', [0.05, 0.225, 1.22]);

      // Cancel drag (e.g. Escape key)
      useEditorStore.getState().cancelInteraction();

      expect(useEditorStore.getState().activeSocketCandidate).toBeNull();
      expect(useEditorStore.getState().draggedObjectId).toBeNull();
      expect(useEditorStore.getState().scene.relationships?.length).toBe(0);
      expect(useEditorStore.getState().history.length).toBe(0);

      // Table restored to original [2, 0.225, 2]
      const currentTable = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1');
      expect(currentTable?.position[0]).toBeCloseTo(2.0, 2);
    });
  });
});

