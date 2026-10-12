import { create } from 'zustand';
import type { 
  CanonicalScene, 
  RoomDimensions, 
  FurniturePlacement, 
  FurnitureCatalogItem, 
  Vector3Tuple 
} from '../../types/scene';
import { 
  DEFAULT_ROOM, 
  validateRoomDimensions, 
  clampPositionToRoom, 
  validateScale, 
  validateRotation 
} from '../validation/sceneValidation';
import { SAMPLE_CATALOG } from '../data/catalog';

interface EditorState {
  scene: CanonicalScene;
  selectedId: string | null;
  hoveredId: string | null;
  cameraResetNonce: number;
  viewMode: 'perspective' | 'top';
  gridSnap: boolean;
  history: CanonicalScene[];

  // Actions
  setRoomDimensions: (dims: Partial<RoomDimensions>) => void;
  addFurniture: (item: FurnitureCatalogItem) => void;
  selectObject: (id: string | null) => void;
  hoverObject: (id: string | null) => void;
  updatePlacementPosition: (id: string, position: Vector3Tuple) => void;
  updatePlacementRotation: (id: string, rotation: Vector3Tuple) => void;
  updatePlacementScale: (id: string, scale: Vector3Tuple) => void;
  updatePlacementColor: (id: string, color: string) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  deleteObject: (id: string) => void;
  clearScene: () => void;
  triggerCameraReset: () => void;
  setViewMode: (mode: 'perspective' | 'top') => void;
  toggleGridSnap: () => void;
  loadScene: (newScene: CanonicalScene) => void;
}

const initialScene: CanonicalScene = {
  schemaVersion: 1,
  unit: 'm',
  room: { ...DEFAULT_ROOM },
  objects: [
    // Pre-populate with one sample sofa for initial visual delight
    {
      id: 'initial-sofa',
      assetId: SAMPLE_CATALOG[0].id,
      name: SAMPLE_CATALOG[0].name,
      dimensions: SAMPLE_CATALOG[0].dimensions,
      position: [0, SAMPLE_CATALOG[0].dimensions[1] / 2, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
      materialOverrides: { color: SAMPLE_CATALOG[0].defaultColor },
    },
  ],
};

export const useEditorStore = create<EditorState>((set, get) => ({
  scene: initialScene,
  selectedId: 'initial-sofa',
  hoveredId: null,
  cameraResetNonce: 0,
  viewMode: 'perspective',
  gridSnap: true,
  history: [],

  setRoomDimensions: (dims) => {
    set((state) => {
      const validatedRoom = validateRoomDimensions({ ...state.scene.room, ...dims });
      
      // Re-clamp all existing objects to the new room dimensions
      const clampedObjects = state.scene.objects.map((obj) => ({
        ...obj,
        position: clampPositionToRoom(obj.position, obj.dimensions, validatedRoom, obj.scale, obj.rotationEuler),
      }));

      return {
        scene: {
          ...state.scene,
          room: validatedRoom,
          objects: clampedObjects,
        },
      };
    });
  },

  addFurniture: (item) => {
    const id = `furniture-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    set((state) => {
      // Find a non-overlapping or offset position
      const offsetMultiplier = state.scene.objects.length * 0.3;
      const initialPos: Vector3Tuple = [
        (offsetMultiplier % (state.scene.room.width / 3)) - (state.scene.room.width / 6),
        0,
        (offsetMultiplier % (state.scene.room.length / 3)) - (state.scene.room.length / 6),
      ];

      const clampedPos = clampPositionToRoom(
        initialPos,
        item.dimensions,
        state.scene.room,
        [1, 1, 1]
      );

      const newObject: FurniturePlacement = {
        id,
        assetId: item.id,
        name: item.name,
        dimensions: item.dimensions,
        position: clampedPos,
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        materialOverrides: { color: item.defaultColor },
      };

      return {
        scene: {
          ...state.scene,
          objects: [...state.scene.objects, newObject],
        },
        selectedId: id,
      };
    });
  },

  selectObject: (id) => set({ selectedId: id }),
  hoverObject: (id) => set({ hoveredId: id }),

  updatePlacementPosition: (id, position) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;

      const obj = state.scene.objects[objIndex];
      const clampedPos = clampPositionToRoom(position, obj.dimensions, state.scene.room, obj.scale, obj.rotationEuler);

      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        position: clampedPos,
      };

      return {
        scene: {
          ...state.scene,
          objects: updatedObjects,
        },
      };
    });
  },

  updatePlacementRotation: (id, rotation) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;

      const obj = state.scene.objects[objIndex];
      const validatedRot = validateRotation(rotation);
      // Re-clamp position with new rotation so corners do not pierce room boundaries
      const clampedPos = clampPositionToRoom(obj.position, obj.dimensions, state.scene.room, obj.scale, validatedRot);

      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        position: clampedPos,
        rotationEuler: validatedRot,
      };

      return {
        scene: {
          ...state.scene,
          objects: updatedObjects,
        },
      };
    });
  },

  updatePlacementScale: (id, scale) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;

      const obj = state.scene.objects[objIndex];
      const validatedS = validateScale(scale);
      // Re-clamp position with new scale to avoid boundary clipping
      const clampedPos = clampPositionToRoom(obj.position, obj.dimensions, state.scene.room, validatedS, obj.rotationEuler);

      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        scale: validatedS,
        position: clampedPos,
      };

      return {
        scene: {
          ...state.scene,
          objects: updatedObjects,
        },
      };
    });
  },

  updatePlacementColor: (id, color) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;

      const obj = state.scene.objects[objIndex];
      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        materialOverrides: {
          ...obj.materialOverrides,
          color,
        },
      };

      return {
        scene: {
          ...state.scene,
          objects: updatedObjects,
        },
      };
    });
  },

  duplicateSelected: () => {
    const { scene, selectedId } = get();
    if (!selectedId) return;

    const source = scene.objects.find((o) => o.id === selectedId);
    if (!source) return;

    const newId = `furniture-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    // Slightly shift duplicated item by 0.3m
    const offsetPos: Vector3Tuple = [
      source.position[0] + 0.3,
      source.position[1],
      source.position[2] + 0.3,
    ];
    const clampedPos = clampPositionToRoom(offsetPos, source.dimensions, scene.room, source.scale);

    const clone: FurniturePlacement = {
      ...source,
      id: newId,
      name: `${source.name} (Copy)`,
      position: clampedPos,
    };

    set({
      scene: {
        ...scene,
        objects: [...scene.objects, clone],
      },
      selectedId: newId,
    });
  },

  deleteSelected: () => {
    const { scene, selectedId } = get();
    if (!selectedId) return;

    set({
      scene: {
        ...scene,
        objects: scene.objects.filter((o) => o.id !== selectedId),
      },
      selectedId: null,
    });
  },

  deleteObject: (id) => {
    set((state) => ({
      scene: {
        ...state.scene,
        objects: state.scene.objects.filter((o) => o.id !== id),
      },
      selectedId: state.selectedId === id ? null : state.selectedId,
    }));
  },

  clearScene: () => {
    set((state) => ({
      scene: {
        ...state.scene,
        objects: [],
      },
      selectedId: null,
    }));
  },

  triggerCameraReset: () => {
    set((state) => ({ cameraResetNonce: state.cameraResetNonce + 1 }));
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleGridSnap: () => set((state) => ({ gridSnap: !state.gridSnap })),

  loadScene: (newScene) => {
    set({
      scene: newScene,
      selectedId: newScene.objects.length > 0 ? newScene.objects[0].id : null,
    });
  },
}));
