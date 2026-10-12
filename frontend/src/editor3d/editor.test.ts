import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './store/editorStore';
import { SAMPLE_CATALOG } from './data/catalog';
import { 
  validateRoomDimensions, 
  clampPositionToRoom, 
  validateScale, 
  validateRotation, 
  serializeCanonicalScene, 
  parseCanonicalScene 
} from './validation/sceneValidation';
import type { CanonicalScene, Vector3Tuple } from '../types/scene';

describe('Phase 1: 3D Room Editor Scene State & Validation', () => {
  beforeEach(() => {
    // Reset store before each test
    useEditorStore.getState().clearScene();
    useEditorStore.getState().setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });
  });

  describe('Room Dimensions & Boundary Clamping', () => {
    it('initializes with valid canonical dimensions', () => {
      const room = useEditorStore.getState().scene.room;
      expect(room.width).toBe(5.0);
      expect(room.length).toBe(4.0);
      expect(room.height).toBe(2.8);
    });

    it('rejects invalid or extreme room dimensions', () => {
      expect(validateRoomDimensions({ width: -10, length: NaN as any, height: 999 })).toEqual({
        width: 2.0,   // Clamped to MIN_ROOM_DIMENSION
        length: 4.0,  // NaN fallback to default
        height: 10.0, // Clamped to MAX height
      });
    });

    it('clamps object position within room boundaries', () => {
      const room = { width: 5.0, length: 4.0, height: 2.8 };
      const objDims: Vector3Tuple = [2.0, 0.8, 1.0]; // Width: 2m, Height: 0.8m, Depth: 1m
      
      // Attempt to place far outside right wall (X = 10m)
      const clampedFarRight = clampPositionToRoom([10, 0, 0], objDims, room);
      // Half room is 2.5m, half object width is 1.0m -> max X is 1.5m
      expect(clampedFarRight[0]).toBeCloseTo(1.5, 2);
      expect(clampedFarRight[1]).toBeCloseTo(0.4, 2); // Base at floor -> center Y is 0.4m

      // Attempt to place far outside back wall (Z = -10m)
      const clampedFarBack = clampPositionToRoom([0, 0, -10], objDims, room);
      // Half length is 2.0m, half depth is 0.5m -> min Z is -1.5m
      expect(clampedFarBack[2]).toBeCloseTo(-1.5, 2);
    });

    it('re-clamps existing items when room dimensions shrink', () => {
      const store = useEditorStore.getState();
      store.addFurniture(SAMPLE_CATALOG[0]); // 2.1m wide sofa
      const item = useEditorStore.getState().scene.objects[0];

      // Move sofa near edge of 5m room
      store.updatePlacementPosition(item.id, [1.4, item.position[1], 0]);
      expect(useEditorStore.getState().scene.objects[0].position[0]).toBeCloseTo(1.4, 1);

      // Shrink room width from 5m to 2.5m
      store.setRoomDimensions({ width: 2.5 });
      const updatedItem = useEditorStore.getState().scene.objects[0];
      // Max allowed X in 2.5m room for 2.1m object is 2.5/2 - 2.1/2 = 0.2m
      expect(updatedItem.position[0]).toBeLessThanOrEqual(0.25);
    });
  });

  describe('Furniture CRUD Operations', () => {
    it('adds furniture from catalog and selects it', () => {
      const store = useEditorStore.getState();
      expect(store.scene.objects.length).toBe(0);

      store.addFurniture(SAMPLE_CATALOG[0]); // Modern Sofa
      const state = useEditorStore.getState();
      expect(state.scene.objects.length).toBe(1);
      expect(state.scene.objects[0].assetId).toBe('sofa-modern-3seater');
      expect(state.selectedId).toBe(state.scene.objects[0].id);
    });

    it('duplicates selected furniture with a distinct ID and offset', () => {
      const store = useEditorStore.getState();
      store.addFurniture(SAMPLE_CATALOG[1]); // Coffee Table
      const original = useEditorStore.getState().scene.objects[0];

      store.duplicateSelected();
      const state = useEditorStore.getState();
      expect(state.scene.objects.length).toBe(2);

      const duplicate = state.scene.objects.find((o) => o.id !== original.id);
      expect(duplicate).toBeDefined();
      expect(duplicate?.assetId).toBe(original.assetId);
      expect(state.selectedId).toBe(duplicate?.id);
    });

    it('deletes selected furniture', () => {
      const store = useEditorStore.getState();
      store.addFurniture(SAMPLE_CATALOG[0]);
      store.addFurniture(SAMPLE_CATALOG[1]);
      expect(useEditorStore.getState().scene.objects.length).toBe(2);

      store.selectObject(useEditorStore.getState().scene.objects[0].id);
      store.deleteSelected();

      expect(useEditorStore.getState().scene.objects.length).toBe(1);
      expect(useEditorStore.getState().selectedId).toBeNull();
    });

    it('clears entire scene', () => {
      const store = useEditorStore.getState();
      store.addFurniture(SAMPLE_CATALOG[0]);
      store.addFurniture(SAMPLE_CATALOG[1]);
      store.clearScene();

      expect(useEditorStore.getState().scene.objects.length).toBe(0);
      expect(useEditorStore.getState().selectedId).toBeNull();
    });
  });

  describe('Transform Rejection and Normalization', () => {
    it('clamps scale between 0.1x and 5.0x', () => {
      expect(validateScale([0.001, 10, -5])).toEqual([0.1, 5.0, 0.1]);
      expect(validateScale([NaN, null, undefined] as any)).toEqual([1, 1, 1]);
    });

    it('normalizes rotation angles in radians', () => {
      const twoPi = Math.PI * 2;
      const normalized = validateRotation([twoPi * 3, -twoPi * 2, 0]);
      expect(normalized[0]).toBeCloseTo(0, 4);
      expect(normalized[1]).toBeCloseTo(0, 4);
    });
  });

  describe('Canonical Scene Serialization', () => {
    it('serializes and parses canonical scene without loss', () => {
      const originalScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 6.0, length: 5.0, height: 3.0 },
        objects: [
          {
            id: 'test-sofa-1',
            assetId: 'sofa-modern-3seater',
            name: 'Modern Sofa',
            position: [1.0, 0.4, -0.5],
            rotationEuler: [0, 1.57, 0],
            scale: [1, 1, 1],
            dimensions: [2.1, 0.85, 0.9],
            materialOverrides: { color: '#4f46e5' },
          },
        ],
      };

      const jsonStr = serializeCanonicalScene(originalScene);
      expect(typeof jsonStr).toBe('string');

      const parsed = parseCanonicalScene(jsonStr);
      expect(parsed).not.toBeNull();
      expect(parsed?.schemaVersion).toBe(1);
      expect(parsed?.room.width).toBe(6.0);
      expect(parsed?.objects.length).toBe(1);
      expect(parsed?.objects[0].name).toBe('Modern Sofa');
    });

    it('preserves all supported material overrides (color, roughness, metalness)', () => {
      const sceneWithMaterials: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'mat-test-1',
            assetId: 'coffee-table-minimal',
            name: 'Coffee Table',
            position: [0, 0.225, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [1.2, 0.45, 0.6],
            materialOverrides: {
              color: '#d97706',
              roughness: 0.45,
              metalness: 0.85,
            },
          },
        ],
      };

      const parsed = parseCanonicalScene(serializeCanonicalScene(sceneWithMaterials));
      expect(parsed).not.toBeNull();
      const overrides = parsed?.objects[0].materialOverrides;
      expect(overrides).toBeDefined();
      expect(overrides?.color).toBe('#d97706');
      expect(overrides?.roughness).toBe(0.45);
      expect(overrides?.metalness).toBe(0.85);
    });

    it('rejects unsupported schema versions explicitly', () => {
      const baseJson = {
        schemaVersion: 2, // Unsupported future schema
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [],
      };
      expect(parseCanonicalScene(JSON.stringify(baseJson))).toBeNull();

      const noVersion = { ...baseJson, schemaVersion: undefined };
      expect(parseCanonicalScene(JSON.stringify(noVersion))).toBeNull();
    });

    it('rejects negative or zero room dimensions', () => {
      const negativeWidth = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: -5.0, length: 4.0, height: 2.8 },
        objects: [],
      };
      expect(parseCanonicalScene(JSON.stringify(negativeWidth))).toBeNull();

      const zeroLength = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 0, height: 2.8 },
        objects: [],
      };
      expect(parseCanonicalScene(JSON.stringify(zeroLength))).toBeNull();

      const nanHeight = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: NaN },
        objects: [],
      };
      expect(parseCanonicalScene(JSON.stringify(nanHeight))).toBeNull();
    });

    it('rejects negative or zero furniture object dimensions', () => {
      const negativeObj = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'bad-obj-1',
            assetId: 'sofa-modern-3seater',
            name: 'Corrupt Sofa',
            position: [0, 0, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [-2.1, 0.85, 0.9], // Negative width
          },
        ],
      };
      expect(parseCanonicalScene(JSON.stringify(negativeObj))).toBeNull();

      const zeroObj = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'bad-obj-2',
            assetId: 'sofa-modern-3seater',
            name: 'Zero Height Sofa',
            position: [0, 0, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [2.1, 0, 0.9], // Zero height
          },
        ],
      };
      expect(parseCanonicalScene(JSON.stringify(zeroObj))).toBeNull();
    });

    it('returns null safely for corrupt or invalid JSON', () => {
      expect(parseCanonicalScene('invalid-json{{{')).toBeNull();
      expect(parseCanonicalScene('null')).toBeNull();
      expect(parseCanonicalScene('{}')).toBeNull();
    });
  });
});

