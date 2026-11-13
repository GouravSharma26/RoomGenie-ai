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
import { 
  validatePlacement, 
  calculateSnap,
  snapToGrid,
  DEFAULT_SNAP_CONFIG,
  attachSocket,
  detachSocket,
  updateRelationshipGap,
  transformGroup,
  purgeInvalidRelationships,
  findCompatibleSockets,
  type PlacementValidation,
  type SnapConfig,
  type SnapGuide,
  type SnapStateTracker,
  type SocketCandidate,
  analyzeWalkability,
  type WalkabilityAnalysisResult,
  getCanonicalRoomGeometry,
  deriveWallProperties,
  validateWallOpenings,
  type WallOpening,
} from '../../spatial';

export const CATALOG_CATEGORY_LOOKUP: Record<string, string> = Object.fromEntries(
  SAMPLE_CATALOG.map((item) => [item.id, item.category])
);

export const CATALOG_TAG_LOOKUP: Record<string, string[]> = Object.fromEntries(
  SAMPLE_CATALOG.map((item) => [item.id, item.styleTags || []])
);

export function computeSceneValidations(scene: CanonicalScene): Record<string, PlacementValidation> {
  const validations: Record<string, PlacementValidation> = {};
  const rels = scene.relationships || [];

  for (const obj of scene.objects) {
    const connectedObjectIds = new Set<string>();
    for (const rel of rels) {
      if (rel.anchorObjectId === obj.id) {
        connectedObjectIds.add(rel.childObjectId);
      } else if (rel.childObjectId === obj.id) {
        connectedObjectIds.add(rel.anchorObjectId);
      }
    }

    validations[obj.id] = validatePlacement(
      obj,
      scene.objects,
      scene.room,
      CATALOG_CATEGORY_LOOKUP,
      { exemptObjectIds: connectedObjectIds }
    );
  }
  return validations;
}

interface EditorState {
  scene: CanonicalScene;
  selectedId: string | null;
  hoveredId: string | null;
  cameraResetNonce: number;
  viewMode: 'perspective' | 'top';
  gridSnap: boolean;
  snapConfig: SnapConfig;
  activeSnapGuides: SnapGuide[];
  snapStateTracker: SnapStateTracker;
  activeSocketCandidate: SocketCandidate | null;
  draggedObjectId: string | null;
  history: CanonicalScene[];
  future: CanonicalScene[];
  activeGestureSnapshot: CanonicalScene | null;
  gestureHadOutOfBoundsAttempt: boolean;
  currentDesignId: string | null;
  spatialValidations: Record<string, PlacementValidation>;
  showWalkabilityOverlay: boolean;
  walkabilityAnalysis: WalkabilityAnalysisResult | null;

  // Architectural Selection State
  selectedWallId: string | null;
  hoveredWallId: string | null;
  selectedOpeningId: string | null;
  hoveredOpeningId: string | null;

  // Actions
  startInteraction: (draggedId?: string) => void;
  endInteraction: () => void;
  cancelInteraction: () => void;
  toggleWalkabilityOverlay: () => void;
  setShowWalkabilityOverlay: (show: boolean) => void;
  runWalkabilityAnalysis: () => WalkabilityAnalysisResult;
  setActiveSocketCandidate: (candidate: SocketCandidate | null) => void;
  setDraggedObjectId: (id: string | null) => void;
  setCurrentDesignId: (id: string | null) => void;
  setRoomDimensions: (dims: Partial<RoomDimensions>) => void;
  resolvePlacement: (id: string) => void;
  resolveSelectedPlacement: () => void;
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
  updatePlacementPosition: (id: string, position: Vector3Tuple, options?: { skipSnapping?: boolean }) => void;
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
  setSnapConfig: (config: Partial<SnapConfig>) => void;
  setActiveSnapGuides: (guides: SnapGuide[]) => void;
  toggleSnapEnabled: () => void;
  toggleWallSnap: () => void;
  toggleAlignmentSnap: () => void;
  setGridSize: (size: number) => void;
  loadScene: (newScene: CanonicalScene) => void;
  attachObjectToSocket: (
    anchorId: string,
    socketId: string,
    childId: string,
    options?: { gap?: number; relativeYaw?: number }
  ) => { success: boolean; error?: string; violations?: string[] };
  detachObjectFromSocket: (childId: string) => boolean;
  setRelationshipGap: (
    childId: string,
    newGap: number
  ) => { success: boolean; error?: string; violations?: string[] };
  moveGroup: (
    anchorId: string,
    newPosition: Vector3Tuple,
    newRotationEuler: Vector3Tuple
  ) => { success: boolean; movedObjectIds?: string[]; violations?: string[] };
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Architectural Openings & Wall Editing Actions
  selectWall: (id: string | null) => void;
  hoverWall: (id: string | null) => void;
  selectOpening: (id: string | null) => void;
  hoverOpening: (id: string | null) => void;
  clearArchitecturalSelection: () => void;
  addWallOpening: (
    wallId: string,
    type: 'door' | 'window',
    params?: Partial<WallOpening>
  ) => { success: boolean; openingId?: string; error?: string };
  updateWallOpening: (
    openingId: string,
    updates: Partial<WallOpening>
  ) => { success: boolean; error?: string };
  moveWallOpening: (
    openingId: string,
    newDistanceAlongWall: number
  ) => { success: boolean; error?: string };
  deleteWallOpening: (openingId: string) => { success: boolean; error?: string };
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
  relationships: [],
};

const MAX_HISTORY = 50;

function cloneCanonicalScene(scene: CanonicalScene): CanonicalScene {
  return {
    schemaVersion: scene.schemaVersion,
    unit: scene.unit,
    room: {
      ...scene.room,
      footprint: scene.room.footprint ? scene.room.footprint.map((p) => [...p] as [number, number]) : undefined,
      walls: scene.room.walls ? scene.room.walls.map((w) => ({
        ...w,
        startPoint: [...w.startPoint] as [number, number],
        endPoint: [...w.endPoint] as [number, number],
      })) : undefined,
      openings: scene.room.openings ? scene.room.openings.map((op) => ({ ...op })) : undefined,
    },
    objects: scene.objects.map((obj) => ({
      ...obj,
      dimensions: [...obj.dimensions] as Vector3Tuple,
      position: [...obj.position] as Vector3Tuple,
      rotationEuler: [...obj.rotationEuler] as Vector3Tuple,
      scale: [...obj.scale] as Vector3Tuple,
      materialOverrides: obj.materialOverrides ? { ...obj.materialOverrides } : undefined,
    })),
    relationships: scene.relationships ? scene.relationships.map((rel) => ({ ...rel })) : [],
    zones: scene.zones ? scene.zones.map((zone) => ({
      ...zone,
      memberObjectIds: [...zone.memberObjectIds],
      bounds: zone.bounds ? {
        min: [...zone.bounds.min] as Vector3Tuple,
        max: [...zone.bounds.max] as Vector3Tuple,
      } : undefined,
    })) : undefined,
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
  selectedWallId: null,
  hoveredWallId: null,
  selectedOpeningId: null,
  hoveredOpeningId: null,
  cameraResetNonce: 0,
  viewMode: 'perspective',
  gridSnap: true,
  snapConfig: { ...DEFAULT_SNAP_CONFIG },
  activeSnapGuides: [],
  snapStateTracker: {},
  activeSocketCandidate: null,
  draggedObjectId: null,
  history: [],
  future: [],
  activeGestureSnapshot: null,
  gestureHadOutOfBoundsAttempt: false,
  currentDesignId: null,
  spatialValidations: computeSceneValidations(initialScene),
  showWalkabilityOverlay: false,
  walkabilityAnalysis: null,

  setActiveSocketCandidate: (candidate) => set({ activeSocketCandidate: candidate }),
  setDraggedObjectId: (id) => set({ draggedObjectId: id }),

  startInteraction: (draggedId?: string) => {
    set((state) => {
      if (state.activeGestureSnapshot !== null) {
        return draggedId !== undefined ? { draggedObjectId: draggedId } : state;
      }
      return {
        activeGestureSnapshot: cloneCanonicalScene(state.scene),
        gestureHadOutOfBoundsAttempt: false,
        draggedObjectId: draggedId !== undefined ? draggedId : state.draggedObjectId,
      };
    });
  },

  endInteraction: () => {
    set((state) => {
      let nextScene = state.scene;

      // Check if an active valid socket candidate was magnetically snapped during this drag
      if (state.activeSocketCandidate && state.activeSocketCandidate.valid && state.draggedObjectId) {
        const candidate = state.activeSocketCandidate;
        const attachResult = attachSocket(
          nextScene,
          candidate.anchorPlacement.id,
          candidate.socket.id,
          state.draggedObjectId,
          { gap: candidate.gap, categoryLookup: CATALOG_CATEGORY_LOOKUP }
        );
        if (attachResult.success) {
          nextScene = attachResult.updatedScene;
        }
      }

      if (!state.activeGestureSnapshot) {
        return {
          activeSnapGuides: [],
          snapStateTracker: {},
          activeSocketCandidate: null,
          draggedObjectId: null,
        };
      }
      const initial = state.activeGestureSnapshot;
      const current = nextScene;
      const hasChanged = JSON.stringify(initial) !== JSON.stringify(current);

      // Boundary clamp attempt unit of counting:
      // A continuous gesture (e.g. dragging a slider against boundary clamps) constitutes
      // at most ONE boundary violation attempt, committed upon gesture completion.
      if (state.gestureHadOutOfBoundsAttempt) {
        recordOutOfBoundsAttempt();
      }

      if (hasChanged) {
        recordEdit();
        return {
          scene: nextScene,
          spatialValidations: computeSceneValidations(nextScene),
          walkabilityAnalysis: state.showWalkabilityOverlay
            ? analyzeWalkability(nextScene, undefined, CATALOG_CATEGORY_LOOKUP)
            : state.walkabilityAnalysis,
          activeGestureSnapshot: null,
          gestureHadOutOfBoundsAttempt: false,
          activeSnapGuides: [],
          snapStateTracker: {},
          activeSocketCandidate: null,
          draggedObjectId: null,
          history: [...state.history, initial].slice(-MAX_HISTORY),
          future: [],
        };
      }
      return {
        scene: nextScene,
        activeGestureSnapshot: null,
        gestureHadOutOfBoundsAttempt: false,
        activeSnapGuides: [],
        snapStateTracker: {},
        activeSocketCandidate: null,
        draggedObjectId: null,
      };
    });
  },

  cancelInteraction: () => {
    set((state) => {
      if (!state.activeGestureSnapshot) {
        return {
          activeSnapGuides: [],
          snapStateTracker: {},
          activeSocketCandidate: null,
          draggedObjectId: null,
        };
      }
      const restoredScene = cloneCanonicalScene(state.activeGestureSnapshot);
      return {
        scene: restoredScene,
        spatialValidations: computeSceneValidations(restoredScene),
        activeGestureSnapshot: null,
        gestureHadOutOfBoundsAttempt: false,
        activeSnapGuides: [],
        snapStateTracker: {},
        activeSocketCandidate: null,
        draggedObjectId: null,
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

      const nextScene: CanonicalScene = {
        ...state.scene,
        room: validatedRoom,
        objects: clampedObjects,
      };

      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: computeSceneValidations(nextScene),
      };
    });
    recordEdit();
  },

  addFurniture: (item) => {
    const id = `furniture-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    set((state) => {
      const historyUpdate = pushSnapshot(state);
      // Find a non-overlapping or offset position aligned to the 5cm floor grid
      const offsetMultiplier = state.scene.objects.length * 0.3;
      const rawX = (offsetMultiplier % (state.scene.room.width / 3)) - (state.scene.room.width / 6);
      const rawZ = (offsetMultiplier % (state.scene.room.length / 3)) - (state.scene.room.length / 6);
      const initialPos: Vector3Tuple = [
        snapToGrid(rawX, 0.05),
        0,
        snapToGrid(rawZ, 0.05),
      ];

      const clampedPos = clampPositionToRoom(
        initialPos,
        item.dimensions,
        state.scene.room,
        [1, 1, 1],
        [0, 0, 0]
      );

      const candidateObj: FurniturePlacement = {
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

      // Check spatial constraints against existing objects and resolve if colliding
      const validation = validatePlacement(
        candidateObj,
        [...state.scene.objects, candidateObj],
        state.scene.room,
        CATALOG_CATEGORY_LOOKUP
      );
      if (!validation.valid && validation.suggestedPosition) {
        candidateObj.position = validation.suggestedPosition;
      }

      const nextScene: CanonicalScene = {
        ...state.scene,
        objects: [...state.scene.objects, candidateObj],
      };

      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: computeSceneValidations(nextScene),
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

      const validation = validatePlacement(
        newObject,
        [...state.scene.objects, newObject],
        state.scene.room,
        CATALOG_CATEGORY_LOOKUP
      );
      if (!validation.valid && validation.suggestedPosition) {
        newObject.position = validation.suggestedPosition;
      }

      const nextScene: CanonicalScene = {
        ...state.scene,
        objects: [...state.scene.objects, newObject],
      };

      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: computeSceneValidations(nextScene),
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

  selectObject: (id) =>
    set((state) => ({
      selectedId: id,
      selectedWallId: id !== null ? null : state.selectedWallId,
      selectedOpeningId: id !== null ? null : state.selectedOpeningId,
      activeSnapGuides: id === null ? [] : state.activeSnapGuides,
      snapStateTracker: id === null ? {} : state.snapStateTracker,
      activeSocketCandidate: id === null ? null : state.activeSocketCandidate,
      draggedObjectId: id === null ? null : state.draggedObjectId,
    })),
  hoverObject: (id) => set({ hoveredId: id }),

  updatePlacementPosition: (id, position, options) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;

      const obj = state.scene.objects[objIndex];
      let targetPos = position;
      let snapGuides: SnapGuide[] = [];
      let socketCandidate: SocketCandidate | null = null;

      // Apply intelligent magnetic snapping if enabled
      if (state.snapConfig.enabled && !options?.skipSnapping) {
        const candidatePlacement: FurniturePlacement = {
          ...obj,
          position,
        };

        // Check for nearby compatible sockets (within 1.2m radius)
        const nearbySockets = findCompatibleSockets(state.scene, candidatePlacement, {
          searchRadius: 1.2,
          categoryLookup: CATALOG_CATEGORY_LOOKUP,
          tagLookup: CATALOG_TAG_LOOKUP,
        });

        if (nearbySockets.length > 0) {
          const closest = nearbySockets[0];
          if (closest.distanceToTarget <= 0.8) {
            socketCandidate = closest;
            // When within close snap range (<= 0.35m) and valid, magnetically attract to target position
            if (closest.valid && closest.distanceToTarget <= 0.35) {
              targetPos = closest.targetPosition;
            }
          }
        }

        // Apply intelligent magnetic grid/wall/center snapping if not magnetically snapped to socket
        if (!socketCandidate || !socketCandidate.valid) {
          const snapResult = calculateSnap(
            candidatePlacement,
            state.scene.objects,
            state.scene.room,
            state.snapConfig,
            state.snapStateTracker,
            CATALOG_CATEGORY_LOOKUP
          );
          targetPos = snapResult.position;
          snapGuides = snapResult.guides;
        }
      }

      const clampedPos = clampPositionToRoom(targetPos, obj.dimensions, state.scene.room, obj.scale, obj.rotationEuler);
      const isClamped = Math.abs(clampedPos[0] - targetPos[0]) > 0.001 || Math.abs(clampedPos[2] - targetPos[2]) > 0.001;

      // Check if object is an anchor with attached children (Group Movement)
      const directChildren = (state.scene.relationships || []).filter((r) => r.anchorObjectId === id);
      let nextScene: CanonicalScene;

      if (directChildren.length > 0) {
        const groupResult = transformGroup(state.scene, id, clampedPos, obj.rotationEuler, {
          categoryLookup: CATALOG_CATEGORY_LOOKUP,
        });
        if (groupResult.success) {
          nextScene = groupResult.updatedScene;
        } else {
          // If group transformation violates bounds or collides externally, keep previous valid scene
          nextScene = state.scene;
        }
      } else {
        const updatedObjects = [...state.scene.objects];
        updatedObjects[objIndex] = {
          ...obj,
          position: clampedPos,
        };
        nextScene = {
          ...state.scene,
          objects: updatedObjects,
        };
      }

      const validations = computeSceneValidations(nextScene);

      if (state.activeGestureSnapshot !== null) {
        // Continuous intermediate update during active gesture:
        // Do NOT increment attemptedOutOfBoundsCount on intermediate ticks.
        // Instead, track that a boundary clamp attempt occurred during this gesture.
        return {
          scene: nextScene,
          spatialValidations: validations,
          activeSnapGuides: snapGuides,
          activeSocketCandidate: socketCandidate,
          draggedObjectId: id,
          gestureHadOutOfBoundsAttempt: state.gestureHadOutOfBoundsAttempt || isClamped,
        };
      }

      // Discrete standalone edit (not part of an active gesture):
      if (isClamped) {
        recordOutOfBoundsAttempt();
      }

      // Discrete standalone edit: push snapshot & record edit
      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: validations,
        activeSnapGuides: snapGuides,
        activeSocketCandidate: null,
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

      // Check if object is an anchor with attached children (Group Rotation)
      const directChildren = (state.scene.relationships || []).filter((r) => r.anchorObjectId === id);
      let nextScene: CanonicalScene;

      if (directChildren.length > 0) {
        const groupResult = transformGroup(state.scene, id, obj.position, validatedRot, {
          categoryLookup: CATALOG_CATEGORY_LOOKUP,
        });
        if (groupResult.success) {
          nextScene = groupResult.updatedScene;
        } else {
          nextScene = state.scene;
        }
      } else {
        const updatedObjects = [...state.scene.objects];
        updatedObjects[objIndex] = {
          ...obj,
          position: clampedPos,
          rotationEuler: validatedRot,
        };
        nextScene = {
          ...state.scene,
          objects: updatedObjects,
        };
      }

      const validations = computeSceneValidations(nextScene);

      if (state.activeGestureSnapshot !== null) {
        // Continuous intermediate update during active gesture: update scene only
        return {
          scene: nextScene,
          spatialValidations: validations,
        };
      }

      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: validations,
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

      const nextScene: CanonicalScene = {
        ...state.scene,
        objects: updatedObjects,
      };
      const validations = computeSceneValidations(nextScene);

      if (state.activeGestureSnapshot !== null) {
        // Continuous intermediate update during active gesture: update scene only
        return {
          scene: nextScene,
          spatialValidations: validations,
        };
      }

      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: validations,
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

      const nextScene: CanonicalScene = {
        ...state.scene,
        objects: updatedObjects,
      };

      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: computeSceneValidations(nextScene),
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

    const nextScene: CanonicalScene = {
      ...scene,
      objects: [...scene.objects, clone],
    };

    set((state) => ({
      ...pushSnapshot(state),
      scene: nextScene,
      spatialValidations: computeSceneValidations(nextScene),
      selectedId: newId,
    }));
    recordEdit();
  },

  deleteSelected: () => {
    const { selectedId } = get();
    if (!selectedId) return;

    // Release resource ownership in reconstructedAssetManager
    reconstructedAssetManager.releasePlacement(selectedId);

    const updatedObjects = get().scene.objects.filter((o) => o.id !== selectedId);
    const updatedRelationships = (get().scene.relationships || []).filter(
      (r) => r.anchorObjectId !== selectedId && r.childObjectId !== selectedId
    );

    const nextScene: CanonicalScene = {
      ...get().scene,
      objects: updatedObjects,
      relationships: updatedRelationships,
    };

    set((state) => ({
      ...pushSnapshot(state),
      scene: nextScene,
      spatialValidations: computeSceneValidations(nextScene),
      selectedId: null,
    }));
    recordEdit();
  },

  deleteObject: (id) => {
    // Release resource ownership in reconstructedAssetManager
    reconstructedAssetManager.releasePlacement(id);

    const updatedObjects = get().scene.objects.filter((o) => o.id !== id);
    const updatedRelationships = (get().scene.relationships || []).filter(
      (r) => r.anchorObjectId !== id && r.childObjectId !== id
    );

    const nextScene: CanonicalScene = {
      ...get().scene,
      objects: updatedObjects,
      relationships: updatedRelationships,
    };

    set((state) => ({
      ...pushSnapshot(state),
      scene: nextScene,
      spatialValidations: computeSceneValidations(nextScene),
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
        room: {
          ...state.scene.room,
          openings: [],
        },
        objects: [],
        relationships: [],
      },
      spatialValidations: {},
      selectedId: null,
      selectedWallId: null,
      hoveredWallId: null,
      selectedOpeningId: null,
      hoveredOpeningId: null,
      currentDesignId: null,
      activeSnapGuides: [],
      activeSocketCandidate: null,
      draggedObjectId: null,
    }));
    recordEdit();
  },

  triggerCameraReset: () => {
    set((state) => ({ cameraResetNonce: state.cameraResetNonce + 1 }));
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleGridSnap: () =>
    set((state) => {
      const nextGridSnap = !state.gridSnap;
      return {
        gridSnap: nextGridSnap,
        snapConfig: { ...state.snapConfig, gridSnap: nextGridSnap },
      };
    }),

  toggleWalkabilityOverlay: () => {
    const next = !get().showWalkabilityOverlay;
    let analysis = get().walkabilityAnalysis;
    if (next || !analysis) {
      analysis = analyzeWalkability(get().scene, undefined, CATALOG_CATEGORY_LOOKUP);
    }
    set({ showWalkabilityOverlay: next, walkabilityAnalysis: analysis });
  },

  setShowWalkabilityOverlay: (show: boolean) => {
    let analysis = get().walkabilityAnalysis;
    if (show || !analysis) {
      analysis = analyzeWalkability(get().scene, undefined, CATALOG_CATEGORY_LOOKUP);
    }
    set({ showWalkabilityOverlay: show, walkabilityAnalysis: analysis });
  },

  runWalkabilityAnalysis: () => {
    const analysis = analyzeWalkability(get().scene, undefined, CATALOG_CATEGORY_LOOKUP);
    set({ walkabilityAnalysis: analysis });
    return analysis;
  },

  setSnapConfig: (partial) =>
    set((state) => ({
      snapConfig: { ...state.snapConfig, ...partial },
      gridSnap: partial.gridSnap !== undefined ? partial.gridSnap : state.gridSnap,
    })),

  setActiveSnapGuides: (guides) => set({ activeSnapGuides: guides }),

  toggleSnapEnabled: () =>
    set((state) => {
      const nextEnabled = !state.snapConfig.enabled;
      return {
        snapConfig: { ...state.snapConfig, enabled: nextEnabled },
        activeSnapGuides: nextEnabled ? state.activeSnapGuides : [],
      };
    }),

  toggleWallSnap: () =>
    set((state) => ({
      snapConfig: { ...state.snapConfig, wallSnap: !state.snapConfig.wallSnap },
    })),

  toggleAlignmentSnap: () =>
    set((state) => ({
      snapConfig: { ...state.snapConfig, alignmentSnap: !state.snapConfig.alignmentSnap },
    })),

  setGridSize: (size) =>
    set((state) => ({
      snapConfig: { ...state.snapConfig, gridSize: size },
    })),

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

    const sanitizedScene: CanonicalScene = {
      ...newScene,
      relationships: newScene.relationships ? [...newScene.relationships] : [],
    };
    const purgedScene = purgeInvalidRelationships(sanitizedScene).scene;

    set((state) => ({
      ...pushSnapshot(state),
      scene: purgedScene,
      spatialValidations: computeSceneValidations(purgedScene),
      selectedId: purgedScene.objects.length > 0 ? purgedScene.objects[0].id : null,
      selectedWallId: null,
      selectedOpeningId: null,
      hoveredWallId: null,
      hoveredOpeningId: null,
    }));
  },

  attachObjectToSocket: (anchorId, socketId, childId, options) => {
    const state = get();
    const result = attachSocket(state.scene, anchorId, socketId, childId, {
      ...options,
      categoryLookup: CATALOG_CATEGORY_LOOKUP,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        violations: result.violations,
      };
    }

    const historyUpdate = pushSnapshot(state);
    set({
      ...historyUpdate,
      scene: result.updatedScene,
      spatialValidations: computeSceneValidations(result.updatedScene),
    });
    recordEdit();

    return { success: true };
  },

  detachObjectFromSocket: (childId) => {
    const state = get();
    const rels = state.scene.relationships || [];
    const isAttached = rels.some((r) => r.childObjectId === childId);
    if (!isAttached) {
      return false;
    }

    const historyUpdate = pushSnapshot(state);
    const nextScene = detachSocket(state.scene, childId);

    set({
      ...historyUpdate,
      scene: nextScene,
      spatialValidations: computeSceneValidations(nextScene),
    });
    recordEdit();

    return true;
  },

  setRelationshipGap: (childId, newGap) => {
    const state = get();
    const result = updateRelationshipGap(state.scene, childId, newGap, {
      categoryLookup: CATALOG_CATEGORY_LOOKUP,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        violations: result.violations,
      };
    }

    const historyUpdate = pushSnapshot(state);
    set({
      ...historyUpdate,
      scene: result.updatedScene,
      spatialValidations: computeSceneValidations(result.updatedScene),
    });
    recordEdit();

    return { success: true };
  },

  moveGroup: (anchorId, newPosition, newRotationEuler) => {
    const state = get();
    const result = transformGroup(state.scene, anchorId, newPosition, newRotationEuler, {
      categoryLookup: CATALOG_CATEGORY_LOOKUP,
    });

    if (!result.success) {
      return {
        success: false,
        violations: result.violations,
      };
    }

    const historyUpdate = pushSnapshot(state);
    set({
      ...historyUpdate,
      scene: result.updatedScene,
      spatialValidations: computeSceneValidations(result.updatedScene),
    });
    recordEdit();

    return {
      success: true,
      movedObjectIds: result.movedObjectIds,
    };
  },

  undo: () => {
    const { history, future, scene } = get();
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const currentSnapshot = cloneCanonicalScene(scene);

    set({
      scene: previous,
      spatialValidations: computeSceneValidations(previous),
      history: newHistory,
      future: [currentSnapshot, ...future].slice(0, MAX_HISTORY),
      selectedId: previous.objects.length > 0 ? previous.objects[0].id : null,
      activeGestureSnapshot: null,
      gestureHadOutOfBoundsAttempt: false,
    });
    recordUndoRedo();
  },

  redo: () => {
    const { history, future, scene } = get();
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const currentSnapshot = cloneCanonicalScene(scene);

    set({
      scene: next,
      spatialValidations: computeSceneValidations(next),
      history: [...history, currentSnapshot].slice(-MAX_HISTORY),
      future: newFuture,
      selectedId: next.objects.length > 0 ? next.objects[0].id : null,
      activeGestureSnapshot: null,
      gestureHadOutOfBoundsAttempt: false,
    });
    recordUndoRedo();
  },

  resolvePlacement: (id) => {
    set((state) => {
      const objIndex = state.scene.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return state;
      const validation = state.spatialValidations[id];
      if (!validation?.suggestedPosition) return state;

      const obj = state.scene.objects[objIndex];
      const updatedObjects = [...state.scene.objects];
      updatedObjects[objIndex] = {
        ...obj,
        position: validation.suggestedPosition,
      };

      const nextScene: CanonicalScene = {
        ...state.scene,
        objects: updatedObjects,
      };

      recordEdit();
      const historyUpdate = pushSnapshot(state);
      return {
        ...historyUpdate,
        scene: nextScene,
        spatialValidations: computeSceneValidations(nextScene),
      };
    });
  },

  resolveSelectedPlacement: () => {
    const selectedId = get().selectedId;
    if (selectedId) {
      get().resolvePlacement(selectedId);
    }
  },

  selectWall: (wallId) =>
    set(() => ({
      selectedWallId: wallId,
      selectedOpeningId: null,
      selectedId: null,
      activeSnapGuides: [],
      activeSocketCandidate: null,
    })),

  hoverWall: (wallId) => set({ hoveredWallId: wallId }),

  selectOpening: (openingId) =>
    set((state) => {
      if (!openingId) {
        return { selectedOpeningId: null };
      }
      const canonicalRoom = getCanonicalRoomGeometry(state.scene.room);
      const openings = canonicalRoom.openings || [];
      const op = openings.find((o) => o.id === openingId);
      return {
        selectedOpeningId: openingId,
        selectedWallId: op ? op.wallId : state.selectedWallId,
        selectedId: null,
        activeSnapGuides: [],
        activeSocketCandidate: null,
      };
    }),

  hoverOpening: (openingId) => set({ hoveredOpeningId: openingId }),

  clearArchitecturalSelection: () =>
    set({
      selectedWallId: null,
      selectedOpeningId: null,
      hoveredWallId: null,
      hoveredOpeningId: null,
    }),

  addWallOpening: (wallId, type, params) => {
    let resultOpeningId = '';
    let success = false;
    let errorMessage: string | undefined;

    set((state) => {
      const canonicalRoom = getCanonicalRoomGeometry(state.scene.room);
      const hostWall = canonicalRoom.walls.find((w) => w.id === wallId);
      if (!hostWall) {
        errorMessage = `Host wall '${wallId}' does not exist.`;
        return state;
      }

      const derived = deriveWallProperties(hostWall, canonicalRoom.height);
      const width = params?.width ?? (type === 'door' ? 0.9 : 1.2);
      const height = params?.height ?? (type === 'door' ? 2.1 : 1.2);
      const sillHeight = params?.sillHeight ?? (type === 'door' ? 0.0 : 0.9);
      const swing = params?.swing ?? (type === 'door' ? 'inward-left' : 'none');

      if (width > derived.length - 0.05) {
        errorMessage = `Opening width (${width}m) exceeds available wall length (${derived.length}m).`;
        return state;
      }
      if (sillHeight + height > derived.height + 1e-3) {
        errorMessage = `Opening vertical extent (${sillHeight + height}m) exceeds wall height (${derived.height}m).`;
        return state;
      }

      let candDist = params?.distanceAlongWall;
      const existingOpenings = (canonicalRoom.openings || []).filter((op) => op.wallId === wallId);

      if (candDist === undefined) {
        if (existingOpenings.length === 0) {
          candDist = Math.max(0.1, (derived.length - width) / 2);
        } else {
          const sorted = [...existingOpenings].sort((a, b) => a.distanceAlongWall - b.distanceAlongWall);
          if (sorted[0].distanceAlongWall >= width + 0.2) {
            candDist = 0.1;
          } else {
            let foundSlot = false;
            for (let i = 0; i < sorted.length - 1; i++) {
              const gapStart = sorted[i].distanceAlongWall + sorted[i].width;
              const gapEnd = sorted[i + 1].distanceAlongWall;
              if (gapEnd - gapStart >= width + 0.2) {
                candDist = gapStart + 0.1;
                foundSlot = true;
                break;
              }
            }
            if (!foundSlot) {
              const lastEnd = sorted[sorted.length - 1].distanceAlongWall + sorted[sorted.length - 1].width;
              if (derived.length - lastEnd >= width + 0.2) {
                candDist = lastEnd + 0.1;
                foundSlot = true;
              }
            }
            if (!foundSlot) {
              errorMessage = `No non-overlapping space available on wall '${wallId}' for opening of width ${width}m.`;
              return state;
            }
          }
        }
      }

      const openingId = params?.id || `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const finalDist = candDist !== undefined ? candDist : 0.1;
      const newOpening: WallOpening = {
        id: openingId,
        wallId,
        type,
        distanceAlongWall: Number(finalDist.toFixed(4)),
        width: Number(width.toFixed(4)),
        height: Number(height.toFixed(4)),
        sillHeight: Number(sillHeight.toFixed(4)),
        swing,
      };

      const candidateOpenings = [...(canonicalRoom.openings || []), newOpening];
      const validation = validateWallOpenings(candidateOpenings, canonicalRoom.walls);
      if (!validation.valid) {
        errorMessage = validation.errors.join(' ');
        return state;
      }

      const historyUpdate = pushSnapshot(state);
      const nextScene: CanonicalScene = {
        ...state.scene,
        room: {
          ...state.scene.room,
          footprint: canonicalRoom.footprint,
          walls: canonicalRoom.walls,
          openings: candidateOpenings,
          isParametric: true,
        },
      };

      resultOpeningId = openingId;
      success = true;
      recordEdit();

      return {
        ...historyUpdate,
        scene: nextScene,
        selectedOpeningId: openingId,
        selectedWallId: wallId,
        selectedId: null,
      };
    });

    return { success, openingId: resultOpeningId, error: errorMessage };
  },

  updateWallOpening: (openingId, updates) => {
    let success = false;
    let errorMessage: string | undefined;

    set((state) => {
      const canonicalRoom = getCanonicalRoomGeometry(state.scene.room);
      const currentOpenings = canonicalRoom.openings || [];
      const opIndex = currentOpenings.findIndex((o) => o.id === openingId);
      if (opIndex === -1) {
        errorMessage = `Opening '${openingId}' does not exist.`;
        return state;
      }

      const targetOp = currentOpenings[opIndex];
      const candidateOp: WallOpening = {
        ...targetOp,
        ...updates,
      };

      const candidateOpenings = [...currentOpenings];
      candidateOpenings[opIndex] = candidateOp;

      const validation = validateWallOpenings(candidateOpenings, canonicalRoom.walls);
      if (!validation.valid) {
        errorMessage = validation.errors.join(' ');
        return state;
      }

      const historyUpdate = pushSnapshot(state);
      const nextScene: CanonicalScene = {
        ...state.scene,
        room: {
          ...state.scene.room,
          footprint: canonicalRoom.footprint,
          walls: canonicalRoom.walls,
          openings: candidateOpenings,
          isParametric: true,
        },
      };

      success = true;
      recordEdit();

      return {
        ...historyUpdate,
        scene: nextScene,
      };
    });

    return { success, error: errorMessage };
  },

  moveWallOpening: (openingId, newDistanceAlongWall) => {
    return get().updateWallOpening(openingId, { distanceAlongWall: newDistanceAlongWall });
  },

  deleteWallOpening: (openingId) => {
    let success = false;
    let errorMessage: string | undefined;

    set((state) => {
      const currentOpenings = state.scene.room.openings || [];
      const opIndex = currentOpenings.findIndex((o) => o.id === openingId);
      if (opIndex === -1) {
        errorMessage = `Opening '${openingId}' does not exist.`;
        return state;
      }

      const historyUpdate = pushSnapshot(state);
      const candidateOpenings = currentOpenings.filter((o) => o.id !== openingId);

      const nextScene: CanonicalScene = {
        ...state.scene,
        room: {
          ...state.scene.room,
          openings: candidateOpenings,
        },
      };

      success = true;
      recordEdit();

      return {
        ...historyUpdate,
        scene: nextScene,
        selectedOpeningId: state.selectedOpeningId === openingId ? null : state.selectedOpeningId,
      };
    });

    return { success, error: errorMessage };
  },

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,
}));

if (
  typeof window !== 'undefined' &&
  (import.meta.env.DEV || import.meta.env.MODE === 'test')
) {
  (window as unknown as { __editorStore?: typeof useEditorStore }).__editorStore = useEditorStore;
}
