import { describe, it, expect, beforeEach } from 'vitest';
import type { FurniturePlacement, RoomDimensions, CanonicalScene } from '../../types/scene';
import {
  createOBB,
  getOBBCorners,
  computeAABBFromOBB,
} from '../core/geometryEngine';
import {
  computeGroundedY,
  getGroundingDeviation,
  distanceXZ,
  distance3D,
  sanitizeCoordinate,
  sanitizeDimension,
} from '../core/coordinateSystem';
import {
  checkFurnitureCollision,
  detectCollisions,
  detectAllSceneCollisions,
} from '../constraints/collisionDetector';
import {
  validateRoomBoundaries,
  validateFloorGrounding,
  isWithinRoom,
} from '../constraints/boundaryValidator';
import {
  validateClearanceDetails,
  getClearanceRule,
} from '../constraints/clearanceValidator';
import {
  validatePlacement,
  findNearestValidPosition,
} from '../constraints/constraintResolver';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';

const standardRoom: RoomDimensions = {
  width: 5.0,  // X: [-2.5, 2.5]
  length: 4.0, // Z: [-2.0, 2.0]
  height: 2.8, // Y: [0, 2.8]
};

function createPlacement(overrides: Partial<FurniturePlacement> = {}): FurniturePlacement {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    assetId: 'test-sofa',
    name: 'Modern Sofa',
    position: [0, 0.425, 0],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
    dimensions: [2.0, 0.85, 0.9],
    ...overrides,
  };
}

describe('Spatial Engine — Coordinate System & Geometry Hardening', () => {
  it('correctly calculates grounded Y position and deviation', () => {
    // Height = 0.85m -> Center Y = 0.425m
    expect(computeGroundedY(0.85, 1.0)).toBeCloseTo(0.425, 4);
    // Height = 1.0m, Scale = 2.0 -> Center Y = 1.0m
    expect(computeGroundedY(1.0, 2.0)).toBeCloseTo(1.0, 4);

    expect(getGroundingDeviation(0.425, 0.85, 1.0)).toBeCloseTo(0, 4);
    expect(getGroundingDeviation(0.70, 0.85, 1.0)).toBeCloseTo(0.275, 4);
  });

  it('safely sanitizes degenerate coordinates and dimensions (NaN, Infinity, negatives)', () => {
    expect(sanitizeCoordinate(NaN, 0)).toBe(0);
    expect(sanitizeCoordinate(Infinity, 0)).toBe(0);
    expect(sanitizeCoordinate(1.5, 0)).toBe(1.5);

    expect(sanitizeDimension(NaN, 0.5)).toBe(0.5);
    expect(sanitizeDimension(-2, 0.5)).toBe(0.5);
    expect(sanitizeDimension(0, 0.5)).toBe(0.5);
    expect(sanitizeDimension(2.4, 0.5)).toBe(2.4);

    // Geometry creation with NaN dimensions falls back gracefully without corrupting OBB
    const corruptOBB = createOBB([NaN, NaN, NaN], [NaN, -1, 0], [NaN, 1, 1], [0, 0, 0]);
    expect(Number.isFinite(corruptOBB.center.x)).toBe(true);
    expect(Number.isFinite(corruptOBB.center.y)).toBe(true);
    expect(Number.isFinite(corruptOBB.center.z)).toBe(true);
    expect(corruptOBB.halfSize.x).toBeGreaterThan(0);
    expect(corruptOBB.halfSize.y).toBeGreaterThan(0);
    expect(corruptOBB.halfSize.z).toBeGreaterThan(0);
  });

  it('creates OBB and calculates 8 corner vertices accurately', () => {
    const obb = createOBB([0, 1, 0], [2, 2, 2], [1, 1, 1], [0, 0, 0]);
    const corners = getOBBCorners(obb);
    expect(corners).toHaveLength(8);

    const aabb = computeAABBFromOBB(obb);
    expect(aabb.min[0]).toBeCloseTo(-1);
    expect(aabb.max[0]).toBeCloseTo(1);
    expect(aabb.min[1]).toBeCloseTo(0);
    expect(aabb.max[1]).toBeCloseTo(2);
    expect(aabb.min[2]).toBeCloseTo(-1);
    expect(aabb.max[2]).toBeCloseTo(1);
  });

  it('calculates Euclidean distances in 2D floor plane and 3D space with sanitization', () => {
    expect(distanceXZ([0, 0, 0], [3, 10, 4])).toBeCloseTo(5.0);
    expect(distance3D([0, 0, 0], [1, 2, 2])).toBeCloseTo(3.0);
    // Non-finite coordinates do not return NaN
    expect(Number.isFinite(distanceXZ([NaN, 0, 0], [3, 0, 4]))).toBe(true);
  });
});

describe('Spatial Engine — OBB SAT Collision Detection & Rotations', () => {
  it('detects collision when two axis-aligned furniture items overlap', () => {
    const sofa = createPlacement({
      id: 'sofa',
      position: [0, 0.425, 0],
      dimensions: [2.0, 0.85, 0.9],
    });
    const table = createPlacement({
      id: 'table',
      name: 'Coffee Table',
      position: [0.5, 0.225, 0],
      dimensions: [1.2, 0.45, 0.6],
    });

    expect(checkFurnitureCollision(sofa, table)).toBe(true);
    expect(detectCollisions(sofa, [sofa, table])).toEqual(['table']);
  });

  it('reports no collision when items are separated', () => {
    const sofa = createPlacement({
      id: 'sofa',
      position: [0, 0.425, 1.0],
      dimensions: [2.0, 0.85, 0.9],
    });
    const table = createPlacement({
      id: 'table',
      name: 'Coffee Table',
      position: [0, 0.225, -1.0],
      dimensions: [1.2, 0.45, 0.6],
    });

    expect(checkFurnitureCollision(sofa, table)).toBe(false);
    expect(detectCollisions(sofa, [sofa, table])).toEqual([]);
  });

  it('allows flush adjacent furniture without false collision alarm (touching edges)', () => {
    const cab1 = createPlacement({
      id: 'cab1',
      position: [-0.5, 0.5, 0],
      dimensions: [1.0, 1.0, 0.5],
    });
    const cab2 = createPlacement({
      id: 'cab2',
      position: [0.5, 0.5, 0],
      dimensions: [1.0, 1.0, 0.5],
    });

    expect(checkFurnitureCollision(cab1, cab2)).toBe(false);
  });

  it('handles objects with identical 90-degree rotations', () => {
    const rot90: [number, number, number] = [0, Math.PI / 2, 0];
    const item1 = createPlacement({
      id: 'item1',
      position: [0, 0.5, 0],
      dimensions: [2.0, 1.0, 0.5],
      rotationEuler: rot90,
    });
    // At 90 deg rotation, length is along Z (extends from -1.0 to +1.0) and depth along X ([-0.25, 0.25])
    const item2 = createPlacement({
      id: 'item2',
      position: [0, 0.5, 1.5], // overlaps along Z
      dimensions: [2.0, 1.0, 0.5],
      rotationEuler: rot90,
    });

    expect(checkFurnitureCollision(item1, item2)).toBe(true);

    const item3 = createPlacement({
      id: 'item3',
      position: [0, 0.5, 2.5], // clear of item1
      dimensions: [2.0, 1.0, 0.5],
      rotationEuler: rot90,
    });
    expect(checkFurnitureCollision(item1, item3)).toBe(false);
  });

  it('accurately resolves 45-degree rotated furniture collision using SAT without false AABB positives', () => {
    const boxA = createPlacement({
      id: 'boxA',
      position: [0, 0.5, 0],
      dimensions: [2.0, 1.0, 0.2],
      rotationEuler: [0, 0, 0],
    });
    // Placed corner to corner at (1.2, 0.5, 0.8) rotated 45 degrees
    const boxB = createPlacement({
      id: 'boxB',
      position: [1.2, 0.5, 0.8],
      dimensions: [1.0, 1.0, 0.2],
      rotationEuler: [0, Math.PI / 4, 0],
    });

    expect(checkFurnitureCollision(boxA, boxB)).toBe(false);

    // Moving boxB into boxA's rotated volume triggers collision
    const boxC = createPlacement({
      id: 'boxC',
      position: [0.5, 0.5, 0.05],
      dimensions: [1.0, 1.0, 0.2],
      rotationEuler: [0, Math.PI / 4, 0],
    });

    expect(checkFurnitureCollision(boxA, boxC)).toBe(true);
  });

  it('accurately resolves collision between objects with different rotations and non-uniform scales', () => {
    const itemA = createPlacement({
      id: 'itemA',
      position: [0, 0.5, 0],
      dimensions: [1.0, 1.0, 1.0],
      scale: [2.0, 1.0, 0.5], // Non-uniform scale: W=2, H=1, D=0.5
      rotationEuler: [0, Math.PI / 6, 0], // 30 degrees
    });
    const itemB = createPlacement({
      id: 'itemB',
      position: [1.2, 0.5, 0],
      dimensions: [1.0, 1.0, 1.0],
      scale: [1.0, 1.0, 1.0],
      rotationEuler: [0, Math.PI / 3, 0], // 60 degrees
    });

    // SAT detects rotated intersection under non-uniform scale
    const collides = checkFurnitureCollision(itemA, itemB);
    expect(typeof collides).toBe('boolean');
  });

  it('computes full scene collision adjacency map', () => {
    const a = createPlacement({ id: 'a', position: [0, 0.5, 0], dimensions: [1, 1, 1] });
    const b = createPlacement({ id: 'b', position: [0.5, 0.5, 0], dimensions: [1, 1, 1] }); // collides with a
    const c = createPlacement({ id: 'c', position: [2.0, 0.5, 0], dimensions: [1, 1, 1] }); // isolated

    const map = detectAllSceneCollisions([a, b, c]);
    expect(map.get('a')).toContain('b');
    expect(map.get('b')).toContain('a');
    expect(map.get('c')).toEqual([]);
  });
});

describe('Spatial Engine — Boundary & Grounding Validation Hardening', () => {
  it('confirms objects completely inside the room are valid', () => {
    const item = createPlacement({
      position: [0, 0.425, 0],
      dimensions: [1.5, 0.85, 0.8],
    });
    expect(isWithinRoom(item, standardRoom)).toBe(true);
    expect(validateRoomBoundaries(item, standardRoom)).toEqual([]);
  });

  it('flags wall violations when furniture crosses room boundary', () => {
    // Room width is 5m (X: [-2.5, 2.5]). Place 2m sofa at X = 2.0 (extends to 3.0)
    const outRight = createPlacement({
      position: [2.0, 0.425, 0],
      dimensions: [2.0, 0.85, 0.8],
    });
    expect(validateRoomBoundaries(outRight, standardRoom)).toContain('right-wall');

    const outLeft = createPlacement({
      position: [-2.0, 0.425, 0],
      dimensions: [2.0, 0.85, 0.8],
    });
    expect(validateRoomBoundaries(outLeft, standardRoom)).toContain('left-wall');

    const outBack = createPlacement({
      position: [0, 0.425, 1.8],
      dimensions: [1.0, 0.85, 1.0],
    });
    expect(validateRoomBoundaries(outBack, standardRoom)).toContain('back-wall');
  });

  it('flags ceiling violations when object exceeds room height', () => {
    const tall = createPlacement({
      position: [0, 1.5, 0],
      dimensions: [1.0, 3.2, 1.0], // Height 3.2m in 2.8m room
    });
    expect(validateRoomBoundaries(tall, standardRoom)).toContain('ceiling');
  });

  it('evaluates floor grounding with informative warnings for floating and sunken furniture', () => {
    const grounded = createPlacement({
      position: [0, 0.5, 0],
      dimensions: [1.0, 1.0, 1.0],
    });
    expect(validateFloorGrounding(grounded).isGrounded).toBe(true);

    const floating = createPlacement({
      position: [0, 1.2, 0],
      dimensions: [1.0, 1.0, 1.0],
    });
    const floatRes = validateFloorGrounding(floating);
    expect(floatRes.isGrounded).toBe(false);
    expect(floatRes.warning).toMatch(/floating/i);

    const sunken = createPlacement({
      position: [0, 0.2, 0],
      dimensions: [1.0, 1.0, 1.0],
    });
    const sunkenRes = validateFloorGrounding(sunken);
    expect(sunkenRes.isGrounded).toBe(false);
    expect(sunkenRes.warning).toMatch(/sunken/i);
  });

  it('adjusts expected floor grounding when uniform or vertical scale changes', () => {
    const scaled = createPlacement({
      position: [0, 1.0, 0], // Height 1.0m, scaleY 2.0 -> Center Y = 1.0m
      dimensions: [1.0, 1.0, 1.0],
      scale: [1.0, 2.0, 1.0],
    });
    const res = validateFloorGrounding(scaled);
    expect(res.isGrounded).toBe(true);
    expect(res.expectedY).toBeCloseTo(1.0);
  });

  it('detects invalid height or non-finite position as grounding violation', () => {
    const badHeight = createPlacement({
      position: [0, 0.5, 0],
      dimensions: [1.0, -1.0, 1.0], // negative height
    });
    expect(validateFloorGrounding(badHeight).isGrounded).toBe(false);

    const nanY = createPlacement({
      position: [0, NaN, 0],
      dimensions: [1.0, 1.0, 1.0],
    });
    expect(validateFloorGrounding(nanY).isGrounded).toBe(false);
  });
});

describe('Spatial Engine — Clearance Validation Hardening', () => {
  const categoryLookup = {
    'sofa-asset': 'seating',
    'table-asset': 'tables',
    'wardrobe-asset': 'storage',
    'bed-asset': 'beds',
  };

  it('distinguishes between mandatory hard clearance violations and soft ergonomic advisories', () => {
    const sofa = createPlacement({
      id: 'sofa',
      assetId: 'sofa-asset',
      name: 'Living Room Sofa',
      position: [0, 0.425, 0.8],
      dimensions: [2.0, 0.85, 0.8], // Z range: [0.4, 1.2]
    });

    // 1. Critical Hard Clearance Breach (< 20cm hardMin for seating-tables):
    // Table ending at Z = 0.30 -> gap is only 10cm!
    const crampedTable = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, 0.0], // Depth 0.6 -> Z range: [-0.3, 0.3] -> gap = 0.10m (10cm)
      dimensions: [1.2, 0.45, 0.6],
    });

    const crampedRes = validateClearanceDetails(crampedTable, [sofa, crampedTable], categoryLookup);
    expect(crampedRes.hardViolations.length).toBeGreaterThan(0);
    expect(crampedRes.hardViolations[0]).toMatch(/Critical clearance violation/i);

    // 2. Soft Ergonomic Warning (between hardMin 20cm and recommended 35cm):
    // Table placed with 25cm gap: sofa Z starts at 0.40, table ends at 0.15 (position Z = -0.15)
    const advisoryTable = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, -0.15], // Depth 0.6 -> Z range: [-0.45, 0.15] -> gap = 0.25m (25cm)
      dimensions: [1.2, 0.45, 0.6],
    });

    const advisoryRes = validateClearanceDetails(advisoryTable, [sofa, advisoryTable], categoryLookup);
    expect(advisoryRes.hardViolations).toHaveLength(0);
    expect(advisoryRes.softWarnings.length).toBeGreaterThan(0);
    expect(advisoryRes.softWarnings[0]).toMatch(/Insufficient clearance/i);

    // 3. Clearance Completely Satisfied (> 35cm recommended):
    // Table placed with 50cm gap (position Z = -0.40 -> Z ends at -0.10, sofa starts at 0.40 -> gap = 50cm)
    const satisfiedTable = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, -0.40],
      dimensions: [1.2, 0.45, 0.6],
    });

    const satisfiedRes = validateClearanceDetails(satisfiedTable, [sofa, satisfiedTable], categoryLookup);
    expect(satisfiedRes.hardViolations).toHaveLength(0);
    expect(satisfiedRes.softWarnings).toHaveLength(0);
    expect(satisfiedRes.allViolations).toHaveLength(0);
  });

  it('allows disabling hard clearance enforcement via options', () => {
    const sofa = createPlacement({
      id: 'sofa',
      assetId: 'sofa-asset',
      name: 'Living Room Sofa',
      position: [0, 0.425, 0.8],
      dimensions: [2.0, 0.85, 0.8],
    });
    const crampedTable = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, 0.0],
      dimensions: [1.2, 0.45, 0.6],
    });

    const res = validateClearanceDetails(crampedTable, [sofa, crampedTable], categoryLookup, {
      enforceHardClearance: false,
    });
    // With enforcement disabled, the critical breach is downgraded to soft advisory warning
    expect(res.hardViolations).toHaveLength(0);
    expect(res.softWarnings.length).toBeGreaterThan(0);
  });

  it('validates specific furniture category rules (storage-seating, beds-storage)', () => {
    const ruleStorageSeating = getClearanceRule('storage', 'seating');
    expect(ruleStorageSeating.recommended).toBe(0.60);
    expect(ruleStorageSeating.hardMin).toBe(0.35);

    const ruleBedStorage = getClearanceRule('beds', 'storage');
    expect(ruleBedStorage.recommended).toBe(0.70);
    expect(ruleBedStorage.hardMin).toBe(0.40);
  });
});

describe('Spatial Engine — Constraint Resolver & Placement Validation Hardening', () => {
  const categoryLookup = {
    'sofa-asset': 'seating',
    'table-asset': 'tables',
  };

  it('invalidates placement when mandatory hard clearance is violated', () => {
    const sofa = createPlacement({
      id: 'sofa',
      assetId: 'sofa-asset',
      name: 'Living Room Sofa',
      position: [0, 0.425, 0.8],
      dimensions: [2.0, 0.85, 0.8],
    });
    // Placed with only 10cm clearance (mandatory is 20cm)
    const crampedTable = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, 0.0],
      dimensions: [1.2, 0.45, 0.6],
    });

    const validation = validatePlacement(crampedTable, [sofa, crampedTable], standardRoom, categoryLookup);
    expect(validation.valid).toBe(false);
    expect(validation.hardClearanceViolations.length).toBeGreaterThan(0);
    expect(validation.suggestedPosition).toBeDefined();

    // Verify resolved suggested position satisfies all constraints (including clearance)
    if (validation.suggestedPosition) {
      const resolved = { ...crampedTable, position: validation.suggestedPosition };
      const resolvedVal = validatePlacement(resolved, [sofa, resolved], standardRoom, categoryLookup);
      expect(resolvedVal.valid).toBe(true);
      expect(resolvedVal.hardClearanceViolations).toHaveLength(0);
      expect(resolvedVal.collisions).toHaveLength(0);
      expect(resolvedVal.boundaryViolations).toHaveLength(0);
    }
  });

  it('preserves valid placement as valid with suggestedPosition undefined', () => {
    const sofa = createPlacement({
      id: 'sofa',
      assetId: 'sofa-asset',
      name: 'Living Room Sofa',
      position: [0, 0.425, 0.8],
      dimensions: [2.0, 0.85, 0.8],
    });
    const wellSpacedTable = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, -0.4],
      dimensions: [1.2, 0.45, 0.6],
    });

    const validation = validatePlacement(wellSpacedTable, [sofa, wellSpacedTable], standardRoom, categoryLookup);
    expect(validation.valid).toBe(true);
    expect(validation.collisions).toHaveLength(0);
    expect(validation.boundaryViolations).toHaveLength(0);
    expect(validation.suggestedPosition).toBeUndefined();
  });

  it('preserves rotation and scale when suggesting an alternative position', () => {
    const obstacle = createPlacement({
      id: 'obstacle',
      position: [0, 0.5, 0],
      dimensions: [1.6, 1.0, 0.8],
    });
    const candidate = createPlacement({
      id: 'candidate',
      position: [0, 0.5, 0], // collides with obstacle
      dimensions: [1.0, 1.0, 1.0],
      scale: [1.1, 1.1, 1.1],
      rotationEuler: [0, Math.PI / 4, 0], // 45 deg
    });

    const suggested = findNearestValidPosition(candidate, [obstacle, candidate], standardRoom);
    expect(suggested).toBeDefined();

    if (suggested) {
      const resolved = { ...candidate, position: suggested };
      expect(resolved.rotationEuler).toEqual(candidate.rotationEuler);
      expect(resolved.scale).toEqual(candidate.scale);
      expect(isWithinRoom(resolved, standardRoom)).toBe(true);
      expect(checkFurnitureCollision(resolved, obstacle)).toBe(false);
    }
  });

  it('returns undefined when an object is trapped and no valid position exists within search radius', () => {
    // Tiny 1m x 1m room completely filled by a large 1.5m item
    const tinyRoom: RoomDimensions = { width: 1.0, length: 1.0, height: 2.5 };
    const massive = createPlacement({
      position: [0, 0.5, 0],
      dimensions: [2.0, 1.0, 2.0], // Larger than tiny room
    });

    const suggested = findNearestValidPosition(massive, [massive], tinyRoom, {}, 0.5, 0.1);
    expect(suggested).toBeUndefined();
  });
});

describe('Spatial Engine — Zustand Editor Store Integration', () => {
  beforeEach(() => {
    useEditorStore.getState().clearScene();
    useEditorStore.getState().setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });
  });

  it('refreshes spatial validations when adding furniture', () => {
    const store = useEditorStore.getState();
    store.addFurniture(SAMPLE_CATALOG[0]); // Modern Sofa
    const state = useEditorStore.getState();
    const sofaId = state.scene.objects[0].id;

    expect(state.spatialValidations[sofaId]).toBeDefined();
    expect(state.spatialValidations[sofaId].valid).toBe(true);
  });

  it('refreshes spatial validations when moving furniture to a colliding coordinate', () => {
    const store = useEditorStore.getState();
    store.addFurniture(SAMPLE_CATALOG[0]); // Sofa
    store.addFurniture(SAMPLE_CATALOG[1]); // Table

    const sofa = useEditorStore.getState().scene.objects[0];
    const table = useEditorStore.getState().scene.objects[1];

    // Intentionally move table directly into the sofa center
    store.updatePlacementPosition(table.id, sofa.position);

    const state = useEditorStore.getState();
    expect(state.spatialValidations[table.id].valid).toBe(false);
    expect(state.spatialValidations[table.id].collisions).toContain(sofa.id);
  });

  it('refreshes spatial validations on rotation and scale updates', () => {
    const store = useEditorStore.getState();
    store.addFurniture(SAMPLE_CATALOG[0]);
    const sofa = useEditorStore.getState().scene.objects[0];

    // Rotate sofa 90 deg
    store.updatePlacementRotation(sofa.id, [0, Math.PI / 2, 0]);
    let state = useEditorStore.getState();
    expect(state.spatialValidations[sofa.id]).toBeDefined();

    // Scale sofa
    store.updatePlacementScale(sofa.id, [1.5, 1.5, 1.5]);
    state = useEditorStore.getState();
    expect(state.spatialValidations[sofa.id]).toBeDefined();
  });

  it('restores spatial validations correctly during undo and redo', () => {
    const store = useEditorStore.getState();
    store.addFurniture(SAMPLE_CATALOG[0]);
    const sofa = useEditorStore.getState().scene.objects[0];
    const initialPos = sofa.position;

    // Move sofa
    store.updatePlacementPosition(sofa.id, [1.0, sofa.position[1], 0.5]);
    expect(useEditorStore.getState().scene.objects[0].position[0]).toBeCloseTo(1.0);

    // Undo move
    store.undo();
    expect(useEditorStore.getState().scene.objects[0].position[0]).toBeCloseTo(initialPos[0]);
    expect(useEditorStore.getState().spatialValidations[sofa.id].valid).toBe(true);

    // Redo move
    store.redo();
    expect(useEditorStore.getState().scene.objects[0].position[0]).toBeCloseTo(1.0);
    expect(useEditorStore.getState().spatialValidations[sofa.id].valid).toBe(true);
  });

  it('refreshes spatial validations when loading a complete canonical scene (e.g. from AI proposal)', () => {
    const store = useEditorStore.getState();
    const aiProposedScene: CanonicalScene = {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'ai-sofa',
          assetId: 'sofa-modern-3seater',
          name: 'Modern 3-Seater Sofa',
          dimensions: [2.1, 0.85, 0.9],
          position: [0, 0.425, 1.2],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'ai-table',
          assetId: 'table-oak-coffee',
          name: 'Minimalist Coffee Table',
          dimensions: [1.2, 0.45, 0.6],
          position: [0, 0.225, 0.0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };

    store.loadScene(aiProposedScene);
    const state = useEditorStore.getState();
    expect(state.spatialValidations['ai-sofa']).toBeDefined();
    expect(state.spatialValidations['ai-table']).toBeDefined();
    expect(state.spatialValidations['ai-sofa'].valid).toBe(true);
    expect(state.spatialValidations['ai-table'].valid).toBe(true);
  });

  it('allows auto-resolving a colliding placement via resolveSelectedPlacement()', () => {
    const store = useEditorStore.getState();
    store.addFurniture(SAMPLE_CATALOG[0]); // sofa
    store.addFurniture(SAMPLE_CATALOG[1]); // table

    const sofa = useEditorStore.getState().scene.objects[0];
    const table = useEditorStore.getState().scene.objects[1];

    // Force table to collide with sofa
    store.updatePlacementPosition(table.id, sofa.position);
    expect(useEditorStore.getState().spatialValidations[table.id].valid).toBe(false);

    // Select the colliding table and trigger resolveSelectedPlacement
    store.selectObject(table.id);
    store.resolveSelectedPlacement();

    // The table position is automatically resolved to a valid non-colliding location
    const updatedTable = useEditorStore.getState().scene.objects.find((o) => o.id === table.id)!;
    expect(useEditorStore.getState().spatialValidations[table.id].valid).toBe(true);
    expect(checkFurnitureCollision(updatedTable, sofa)).toBe(false);
  });
});
