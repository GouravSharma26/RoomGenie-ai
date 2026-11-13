import { describe, it, expect } from 'vitest';
import type { FurniturePlacement, RoomDimensions } from '../../types/scene';
import {
  createOBB,
  getOBBCorners,
  computeAABBFromOBB,
} from '../core/geometryEngine';
import {
  computeGroundedY,
  isProperlyGrounded,
  distanceXZ,
  distance3D,
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
  validateClearances,
} from '../constraints/clearanceValidator';
import {
  validatePlacement,
} from '../constraints/constraintResolver';

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

describe('Spatial Engine — Coordinate System & Geometry', () => {
  it('correctly calculates grounded Y position', () => {
    // Height = 0.85m -> Center Y = 0.425m
    expect(computeGroundedY(0.85, 1.0)).toBeCloseTo(0.425, 4);
    // Height = 1.0m, Scale = 2.0 -> Center Y = 1.0m
    expect(computeGroundedY(1.0, 2.0)).toBeCloseTo(1.0, 4);
  });

  it('detects floating and sunken objects', () => {
    expect(isProperlyGrounded(0.425, 0.85, 1.0)).toBe(true);
    expect(isProperlyGrounded(0.70, 0.85, 1.0)).toBe(false); // floating
    expect(isProperlyGrounded(0.10, 0.85, 1.0)).toBe(false); // sunken
  });

  it('creates OBB and calculates 8 corner vertices accurately', () => {
    const obb = createOBB([0, 1, 0], [2, 2, 2], [1, 1, 1], [0, 0, 0]);
    const corners = getOBBCorners(obb);
    expect(corners).toHaveLength(8);

    // Bounding box centered at (0, 1, 0) with half extents (1, 1, 1)
    const aabb = computeAABBFromOBB(obb);
    expect(aabb.min[0]).toBeCloseTo(-1);
    expect(aabb.max[0]).toBeCloseTo(1);
    expect(aabb.min[1]).toBeCloseTo(0);
    expect(aabb.max[1]).toBeCloseTo(2);
    expect(aabb.min[2]).toBeCloseTo(-1);
    expect(aabb.max[2]).toBeCloseTo(1);
  });

  it('calculates Euclidean distances in 2D floor plane and 3D space', () => {
    expect(distanceXZ([0, 0, 0], [3, 10, 4])).toBeCloseTo(5.0);
    expect(distance3D([0, 0, 0], [1, 2, 2])).toBeCloseTo(3.0);
  });
});

describe('Spatial Engine — OBB SAT Collision Detection', () => {
  it('detects collision when two axis-aligned furniture items overlap', () => {
    const sofa = createPlacement({
      id: 'sofa',
      position: [0, 0.425, 0],
      dimensions: [2.0, 0.85, 0.9],
    });
    const table = createPlacement({
      id: 'table',
      name: 'Coffee Table',
      position: [0.5, 0.225, 0], // Overlapping in center
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
      position: [0, 0.225, -1.0], // Well separated along Z
      dimensions: [1.2, 0.45, 0.6],
    });

    expect(checkFurnitureCollision(sofa, table)).toBe(false);
    expect(detectCollisions(sofa, [sofa, table])).toEqual([]);
  });

  it('allows flush adjacent furniture without false collision alarm', () => {
    // Two 1m wide cabinets placed side by side touching at x = 0
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

  it('accurately resolves rotated furniture collision using SAT without false AABB positives', () => {
    // Two long thin boxes: Box A at origin, Box B rotated 45 degrees
    // In pure AABB, bounding boxes would heavily overlap, but with OBB SAT their rotated geometries do not touch.
    const boxA = createPlacement({
      id: 'boxA',
      position: [0, 0.5, 0],
      dimensions: [2.0, 1.0, 0.2], // Long along X
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

describe('Spatial Engine — Boundary & Grounding Validation', () => {
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

    // Place at X = -2.0 (extends to -3.0)
    const outLeft = createPlacement({
      position: [-2.0, 0.425, 0],
      dimensions: [2.0, 0.85, 0.8],
    });
    expect(validateRoomBoundaries(outLeft, standardRoom)).toContain('left-wall');

    // Place past back wall (Z = 2.0)
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

  it('evaluates floor grounding with informative warnings', () => {
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
  });
});

describe('Spatial Engine — Clearance Validation', () => {
  it('identifies clearance violations between adjacent furniture items', () => {
    const sofa = createPlacement({
      id: 'sofa',
      assetId: 'sofa-asset',
      name: 'Living Room Sofa',
      position: [0, 0.425, 0.8],
      dimensions: [2.0, 0.85, 0.8],
    });
    // Table placed 15cm away from sofa (sofa Z starts at 0.4, table ends at 0.25; recommended clearance: 35cm)
    const table = createPlacement({
      id: 'table',
      assetId: 'table-asset',
      name: 'Coffee Table',
      position: [0, 0.225, -0.05],
      dimensions: [1.2, 0.45, 0.6],
    });

    const categoryLookup = {
      'sofa-asset': 'seating',
      'table-asset': 'tables',
    };

    const violations = validateClearances(table, [sofa, table], categoryLookup);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/Insufficient clearance/i);
  });
});

describe('Spatial Engine — Constraint Resolver & Placement Validation', () => {
  it('suggests a valid collision-free position when an item collides', () => {
    const obstacle = createPlacement({
      id: 'obstacle',
      position: [0, 0.5, 0],
      dimensions: [2.0, 1.0, 1.0],
    });

    // Candidate placed directly on top of obstacle
    const candidate = createPlacement({
      id: 'candidate',
      position: [0, 0.5, 0],
      dimensions: [1.0, 1.0, 1.0],
    });

    const validation = validatePlacement(candidate, [obstacle, candidate], standardRoom);
    expect(validation.valid).toBe(false);
    expect(validation.collisions).toContain('obstacle');
    expect(validation.suggestedPosition).toBeDefined();

    // Verify that the suggested position is indeed valid
    if (validation.suggestedPosition) {
      const resolved = { ...candidate, position: validation.suggestedPosition };
      const resolvedValidation = validatePlacement(resolved, [obstacle, resolved], standardRoom);
      expect(resolvedValidation.valid).toBe(true);
      expect(resolvedValidation.collisions).toHaveLength(0);
      expect(resolvedValidation.boundaryViolations).toHaveLength(0);
    }
  });

  it('validates a completely correct placement as valid with 0 violations', () => {
    const existing = createPlacement({
      id: 'existing',
      position: [-1.2, 0.425, 0],
      dimensions: [1.0, 0.85, 0.8],
    });
    const candidate = createPlacement({
      id: 'candidate',
      position: [1.2, 0.425, 0],
      dimensions: [1.0, 0.85, 0.8],
    });

    const result = validatePlacement(candidate, [existing, candidate], standardRoom);
    expect(result.valid).toBe(true);
    expect(result.collisions).toHaveLength(0);
    expect(result.boundaryViolations).toHaveLength(0);
  });
});
