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
import { reconstructedAssetManager } from '../../services/reconstructedAssetManager';
import { recordEdit, recordOutOfBoundsAttempt, recordUndoRedo } from '../../services/evaluationTelemetry';

interface EditorState {
  scene: CanonicalScene;
  selectedId: string | null;
  hoveredId: string | null;
  cameraResetNonce: number;
  viewMode: 'perspective' | 'top';
  gridSnap: boolean;
  history: CanonicalScene[];
  future: CanonicalScene[];
  activeGestureSnapshot: CanonicalScene | null;
  currentDesignId: string | null;

  // Actions
  startInteraction: () => void;
  endInteraction: () => void;
  setCurrentDesignId: (id: string | null) => void;
  setRoomDimensions: (dims: Partial<RoomDimensions>) => void;
  addFurniture: (item: FurnitureCatalogItem) => void;
  addCustomPlacement: (params: {
    assetId: string;
    name: string;
    dimensions: Vector3Tuple;
    modelUrl?: string;
    reconstructionJobId?: string;
    materialOverrides?: { color?: string; roughness?: number; metalness?: number };
    isCustomReconstruction?: boolean;
  }) => string;
  updatePlacementModelUrl: (id: string, modelUrl: string) => void;
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
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
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

const MAX_HISTORY = 50;

function cloneCanonicalScene(scene: CanonicalScene): CanonicalScene {
  return {
    schemaVersion: scene.schemaVersion,
    unit: scene.unit,
    room: { ...scene.room },
    objects: scene.objects.map((obj) => ({
      ...obj,
      dimensions: [...obj.dimensions] as Vector3Tuple,
      position: [...obj.position] as Vector3Tuple,
      rotationEuler: [...obj.rotationEuler] as Vector3Tuple,
      scale: [...obj.scale] as Vector3Tuple,
      materialOverrides: obj.materialOverrides ? { ...obj.materialOverrides } : undefined,
    })),
  };
}

function pushSnapshot(state: EditorState): { history: CanonicalScene[]; future: CanonicalScene[] } {
  const snapshot = cloneCanonicalScene(state.scene);
  return {
    history: [...state.history, snapshot].slice(-MAX_HISTORY),
    future: [],
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  scene: initialScene,
  selectedId: 'initial-sofa',
  hoveredId: null,
  cameraResetNonce: 0,
  viewMode: 'perspective',
  gridSnap: true,
  history: [],
  future: [],
  activeGestureSnapshot: null,
  currentDesignId: null,

  startInteraction: () => {
    set((state) => {
      if (state.activeGestureSnapshot !== null) return state;
      return {
        activeGestureSnapshot: cloneCanonicalScene(state.scene),
      };
    });
  },

  endInteraction: () => {
    set((state) => {
      if (!state.activeGestureSnapshot) return state;
      const initial = state.activeGestureSnapshot;
      const current = state.scene;
      const hasChanged = JSON.stringify(initial) !== JSON.stringify(current);
      if (hasChanged) {
        recordEdit();
        return {
          activeGestureSnapshot: null,
          history: [...state.history, initial].slice(-MAX_HISTORY),
          future: [],
        };
      }
      return {
        activeGestureSnapshot: null,
      };
    });
  },

  setCurrentDesignId: (id) => set({ currentDesignId: id }),

  setRoomDimensions: (dims) => {
    set((state) => {
      const historyUpdate = pushSnapshot(state);
      const validatedRoom = validateRoomDimensions({ ...state.scene.room, ...dims });
      
      // Re-clamp all existing objects to the new room dimensions
      const clampedObjects = state.scene.objects.map((obj) => ({
        ...obj,
        position: clampPositionToRoom(obj.position, obj.dimensions, validatedRoom, obj.scale, obj.rotationEuler),
      }));

      return {
        ...historyUpdate,
        scene: {
          ...state.scene,
          room: validatedRoom,
          objects: clampedObjects,
        },
      };
    });
    recordEdit();
  },

  addFurniture: (item) => {
    const id = `furniture-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    set((state) => {
      const historyUpdate = pushSnapshot(state);
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
        [1, 1, 1],
        [0, 0, 0]
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
        modelUrl: item.modelUrl,
      };

      return {
        ...historyUpdate,
        scene: {
          ...state.scene,
          objects: [...state.scene.objects, newObject],
        },
        selectedId: id,
      };
    });
    recordEdit();
  },

  addCustomPlacement: (params) => {
    const id = `reconstruction-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Register ownership in reconstructedAssetManager if reconstructionJobId exists
    if (params.reconstructionJobId && params.modelUrl) {
      reconstructedAssetManager.claimForPlacement(params.reconstructionJobId, id, params.modelUrl);
    }

    set((state) => {
      const historyUpdate = pushSnapshot(state);
      const offsetMultiplier = state.scene.objects.length * 0.3;
      const initialPos: Vector3Tuple = [
        (offsetMultiplier % (state.scene.room.width / 3)) - (state.scene.room.width / 6),
        0,
        (offsetMultiplier % (state.scene.room.length / 3)) - (state.scene.room.length / 6),
      ];

      const clampedPos = clampPositionToRoom(
        initialPos,
        params.dimensions,
        state.scene.room,
        [1, 1, 1],
        [0, 0, 0]
      );

      const newObject: FurniturePlacement = {
        id,
        assetId: params.assetId,
        name: params.name,
        dimensions: params.dimensions,
        position: clampedPos,
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        materialOverrides: params.materialOverrides || { color: '#6366f1' },
        modelUrl: params.modelUrl,
        reconstructionJobId: params.reconstructionJobId,
        isCustomReconstruction: params.isCustomReconstruction ?? true,
      };

      return {
        ...historyUpdate,
        scene: {
          ...state.scene,
          objects: [...state.scene.objects, newObject],
        },
        selectedId: id,
      };
    });
    recordEdit();
    return id;
  },

  updatePlacementModelUrl: (id, modelUrl) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;
      const obj = state.scene.objects[objIndex];
      if (obj.modelUrl === modelUrl) return state;

      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        modelUrl,
      };
      return {
        scene: {
          ...state.scene,
          objects: updatedObjects,
        },
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

      if (Math.abs(clampedPos[0] - position[0]) > 0.001 || Math.abs(clampedPos[2] - position[2]) > 0.001) {
        recordOutOfBoundsAttempt();
      }

      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        position: clampedPos,
      };

      if (state.activeGestureSnapshot !== null) {
        // Continuous intermediate update during active gesture: update scene only
        return {
          scene: {
            ...state.scene,
            objects: updatedObjects,
          },
        };
      }

      // Discrete standalone edit: push snapshot & record edit
      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
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

      if (state.activeGestureSnapshot !== null) {
        // Continuous intermediate update during active gesture: update scene only
        return {
          scene: {
            ...state.scene,
            objects: updatedObjects,
          },
        };
      }

      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
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

      if (state.activeGestureSnapshot !== null) {
        // Continuous intermediate update during active gesture: update scene only
        return {
          scene: {
            ...state.scene,
            objects: updatedObjects,
          },
        };
      }

      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
        scene: {
          ...state.scene,
          objects: updatedObjects,
        },
      };
    });
  },

  updatePlacementColor: (id, color) => {
    recordEdit();
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;

      const obj = state.scene.objects[objIndex];
      const historyUpdate = pushSnapshot(state);
      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        materialOverrides: {
          ...obj.materialOverrides,
          color,
        },
      };

      return {
        ...historyUpdate,
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
    const clampedPos = clampPositionToRoom(offsetPos, source.dimensions, scene.room, source.scale, source.rotationEuler);

    const clone: FurniturePlacement = {
      ...source,
      id: newId,
      name: `${source.name} (Copy)`,
      position: clampedPos,
    };

    // If source has reconstructionJobId, register new clone as an owner
    if (source.reconstructionJobId && source.modelUrl) {
      reconstructedAssetManager.claimForPlacement(
        source.reconstructionJobId,
        newId,
        source.modelUrl
      );
    }

    set((state) => ({
      ...pushSnapshot(state),
      scene: {
        ...state.scene,
        objects: [...state.scene.objects, clone],
      },
      selectedId: newId,
    }));
    recordEdit();
  },

  deleteSelected: () => {
    const { selectedId } = get();
    if (!selectedId) return;

    // Release resource ownership in reconstructedAssetManager
    reconstructedAssetManager.releasePlacement(selectedId);

    set((state) => ({
      ...pushSnapshot(state),
      scene: {
        ...state.scene,
        objects: state.scene.objects.filter((o) => o.id !== selectedId),
      },
      selectedId: null,
    }));
    recordEdit();
  },

  deleteObject: (id) => {
    // Release resource ownership in reconstructedAssetManager
    reconstructedAssetManager.releasePlacement(id);

    set((state) => ({
      ...pushSnapshot(state),
      scene: {
        ...state.scene,
        objects: state.scene.objects.filter((o) => o.id !== id),
      },
      selectedId: state.selectedId === id ? null : state.selectedId,
    }));
    recordEdit();
  },

  clearScene: () => {
    const { scene } = get();
    // Release all scene placement resources
    reconstructedAssetManager.releasePlacements(scene.objects.map((o) => o.id));

    set((state) => ({
      ...pushSnapshot(state),
      scene: {
        ...state.scene,
        objects: [],
      },
      selectedId: null,
      currentDesignId: null,
    }));
    recordEdit();
  },

  triggerCameraReset: () => {
    set((state) => ({ cameraResetNonce: state.cameraResetNonce + 1 }));
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleGridSnap: () => set((state) => ({ gridSnap: !state.gridSnap })),

  loadScene: (newScene) => {
    const { scene } = get();
    // Release existing placement resources
    reconstructedAssetManager.releasePlacements(scene.objects.map((o) => o.id));

    // Claim any active reconstruction models present in the new scene
    for (const obj of newScene.objects) {
      if (obj.reconstructionJobId && obj.modelUrl) {
        reconstructedAssetManager.claimForPlacement(obj.reconstructionJobId, obj.id, obj.modelUrl);
      }
    }

    set((state) => ({
      ...pushSnapshot(state),
      scene: newScene,
      selectedId: newScene.objects.length > 0 ? newScene.objects[0].id : null,
    }));
  },

  undo: () => {
    const { history, future, scene } = get();
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const currentSnapshot: CanonicalScene = {
      schemaVersion: scene.schemaVersion,
      unit: scene.unit,
      room: { ...scene.room },
      objects: scene.objects.map((obj) => ({
        ...obj,
        dimensions: [...obj.dimensions] as Vector3Tuple,
        position: [...obj.position] as Vector3Tuple,
        rotationEuler: [...obj.rotationEuler] as Vector3Tuple,
        scale: [...obj.scale] as Vector3Tuple,
        materialOverrides: obj.materialOverrides ? { ...obj.materialOverrides } : undefined,
      })),
    };

    set({
      scene: previous,
      history: newHistory,
      future: [currentSnapshot, ...future].slice(0, MAX_HISTORY),
      selectedId: previous.objects.length > 0 ? previous.objects[0].id : null,
      activeGestureSnapshot: null,
    });
    recordUndoRedo();
  },

  redo: () => {
    const { history, future, scene } = get();
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const currentSnapshot: CanonicalScene = {
      schemaVersion: scene.schemaVersion,
      unit: scene.unit,
      room: { ...scene.room },
      objects: scene.objects.map((obj) => ({
        ...obj,
        dimensions: [...obj.dimensions] as Vector3Tuple,
        position: [...obj.position] as Vector3Tuple,
        rotationEuler: [...obj.rotationEuler] as Vector3Tuple,
        scale: [...obj.scale] as Vector3Tuple,
        materialOverrides: obj.materialOverrides ? { ...obj.materialOverrides } : undefined,
      })),
    };

    set({
      scene: next,
      history: [...history, currentSnapshot].slice(-MAX_HISTORY),
      future: newFuture,
      selectedId: next.objects.length > 0 ? next.objects[0].id : null,
      activeGestureSnapshot: null,
    });
    recordUndoRedo();
  },

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,
}));
