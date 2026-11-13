import type { 
  Point2D, 
  WallSegment, 
  DerivedWall, 
  FootprintBounds, 
  PolygonValidationResult, 
  ParametricRoom 
} from './parametricTypes';
import type { RoomDimensions } from '../../types/scene';

/**
 * Computes signed polygon area using the Shoelace formula.
 * On the X/Z floor plane (where +X is East and +Z is South):
 * - Negative signed area corresponds to Counter-Clockwise (CCW) winding.
 * - Positive signed area corresponds to Clockwise (CW) winding.
 */
export function computeSignedPolygonArea(vertices: Point2D[]): number {
  const n = vertices.length;
  if (n < 3) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    sum += curr[0] * next[1] - next[0] * curr[1];
  }
  return sum * 0.5;
}

/**
 * Computes absolute polygon area in square metres (m²).
 */
export function computePolygonArea(vertices: Point2D[]): number {
  return Math.abs(computeSignedPolygonArea(vertices));
}

/**
 * Determines polygon vertex winding order.
 */
export function computePolygonWinding(vertices: Point2D[]): 'ccw' | 'cw' | 'collinear' {
  const signed = computeSignedPolygonArea(vertices);
  if (Math.abs(signed) < 1e-6) return 'collinear';
  // With +X right and +Z down, signed area < 0 is Counter-Clockwise (interior on left)
  return signed < 0 ? 'ccw' : 'cw';
}

/**
 * Normalizes polygon vertices to guaranteed Counter-Clockwise (CCW) ordering.
 */
export function ensureCounterClockwise(vertices: Point2D[]): Point2D[] {
  const winding = computePolygonWinding(vertices);
  if (winding === 'cw') {
    return [...vertices].reverse();
  }
  return [...vertices];
}

/**
 * Computes 2D axis-aligned bounding box and dimensions for a footprint polygon.
 */
export function computePolygonBounds(vertices: Point2D[]): FootprintBounds {
  if (vertices.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 0, length: 0, center: [0, 0] };
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of vertices) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const width = Math.max(0, maxX - minX);
  const length = Math.max(0, maxZ - minZ);
  const center: Point2D = [
    Number(((minX + maxX) / 2).toFixed(4)),
    Number(((minZ + maxZ) / 2).toFixed(4)),
  ];

  return {
    minX: Number(minX.toFixed(4)),
    maxX: Number(maxX.toFixed(4)),
    minZ: Number(minZ.toFixed(4)),
    maxZ: Number(maxZ.toFixed(4)),
    width: Number(width.toFixed(4)),
    length: Number(length.toFixed(4)),
    center,
  };
}

/**
 * Helper to test if two line segments [p1, p2] and [p3, p4] properly intersect.
 */
export function doSegmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const ccw = (a: Point2D, b: Point2D, c: Point2D): number =>
    (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);

  const d1 = ccw(p1, p2, p3);
  const d2 = ccw(p1, p2, p4);
  const d3 = ccw(p3, p4, p1);
  const d4 = ccw(p3, p4, p2);

  // General case: segments straddle each other
  if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
      ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) {
    return true;
  }

  return false;
}

/**
 * Detects whether a polygon has self-intersecting boundary edges.
 */
export function detectPolygonSelfIntersection(vertices: Point2D[]): boolean {
  const n = vertices.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];

    // Check non-adjacent edges
    for (let j = i + 2; j < n; j++) {
      // Do not check the wrap-around closing edge against the first edge
      if (i === 0 && j === n - 1) continue;

      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];

      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Comprehensive geometric validation of a room footprint polygon.
 */
export function validateFootprintPolygon(vertices: Point2D[]): PolygonValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(vertices)) {
    return {
      valid: false,
      area: 0,
      winding: 'collinear',
      vertexCount: 0,
      isSelfIntersecting: false,
      errors: ['Footprint vertices must be an array.'],
    };
  }

  if (vertices.length < 3) {
    errors.push(`A room footprint requires at least 3 vertices (received ${vertices.length}).`);
  }

  // Validate finite coordinates and zero-length edges
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (!Array.isArray(v) || v.length !== 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
      errors.push(`Vertex at index ${i} contains non-finite coordinates: ${JSON.stringify(v)}.`);
      continue;
    }

    const next = vertices[(i + 1) % vertices.length];
    if (Array.isArray(next) && next.length === 2 && Number.isFinite(next[0]) && Number.isFinite(next[1])) {
      const dist = Math.hypot(next[0] - v[0], next[1] - v[1]);
      if (dist < 0.05) {
        errors.push(`Zero-length edge detected between vertex ${i} and ${(i + 1) % vertices.length} (${dist.toFixed(3)}m).`);
      }
    }
  }

  const isSelfIntersecting = detectPolygonSelfIntersection(vertices);
  if (isSelfIntersecting) {
    errors.push('Room footprint boundary edges intersect each other (self-intersecting polygon).');
  }

  const area = computePolygonArea(vertices);
  if (area < 1.0) {
    errors.push(`Room footprint area (${area.toFixed(2)}m²) is below the minimum allowed size of 1.00m².`);
  }

  const winding = computePolygonWinding(vertices);
  if (winding === 'collinear') {
    errors.push('Footprint vertices are degenerate or collinear (zero floor area).');
  }

  return {
    valid: errors.length === 0,
    area: Number(area.toFixed(4)),
    winding,
    vertexCount: vertices.length,
    isSelfIntersecting,
    errors,
  };
}

/**
 * Computes pure derived geometric properties of a wall segment on demand.
 */
export function deriveWallProperties(
  wall: WallSegment,
  defaultHeight = 2.8,
  defaultThickness = 0.15
): DerivedWall {
  const [x1, z1] = wall.startPoint;
  const [x2, z2] = wall.endPoint;

  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);

  const safeLength = length > 1e-6 ? length : 1e-6;
  const ux = dx / safeLength;
  const uz = dz / safeLength;

  // In X/Z floor plane (where +X is East and +Z is South, and CCW winding is used):
  // Left-turn normal pointing into the room interior is [uz, -ux].
  const nx = Number(uz.toFixed(6));
  const nz = Number((-ux).toFixed(6));

  const height = wall.height ?? defaultHeight;
  const thickness = wall.thickness ?? defaultThickness;

  const midpoint: Point2D = [
    Number(((x1 + x2) / 2).toFixed(4)),
    Number(((z1 + z2) / 2).toFixed(4)),
  ];

  return {
    id: wall.id,
    startPoint: [Number(x1.toFixed(4)), Number(z1.toFixed(4))],
    endPoint: [Number(x2.toFixed(4)), Number(z2.toFixed(4))],
    length: Number(length.toFixed(4)),
    height,
    thickness,
    direction: [Number(ux.toFixed(6)), Number(uz.toFixed(6))],
    interiorNormal: [nx, nz],
    angleRadians: Math.atan2(dz, dx),
    midpoint,
  };
}

/**
 * Generates canonical 4-vertex CCW rectangular footprint centered at [0, 0].
 */
export function createRectangularFootprint(width: number, length: number): Point2D[] {
  const halfW = width / 2;
  const halfL = length / 2;

  // CCW order: South-West -> South-East -> North-East -> North-West
  return [
    [-halfW, halfL],  // SW
    [halfW, halfL],   // SE
    [halfW, -halfL],  // NE
    [-halfW, -halfL], // NW
  ];
}

/**
 * Generates canonical 4 wall segments for a standard rectangular room.
 */
export function createRectangularWalls(
  width: number,
  length: number,
  height = 2.8,
  thickness = 0.15
): WallSegment[] {
  const halfW = width / 2;
  const halfL = length / 2;

  return [
    {
      id: 'wall-south',
      startPoint: [-halfW, halfL],
      endPoint: [halfW, halfL],
      height,
      thickness,
    },
    {
      id: 'wall-east',
      startPoint: [halfW, halfL],
      endPoint: [halfW, -halfL],
      height,
      thickness,
    },
    {
      id: 'wall-north',
      startPoint: [halfW, -halfL],
      endPoint: [-halfW, -halfL],
      height,
      thickness,
    },
    {
      id: 'wall-west',
      startPoint: [-halfW, -halfL],
      endPoint: [-halfW, halfL],
      height,
      thickness,
    },
  ];
}

/**
 * Deterministically converts a legacy rectangular room into a full ParametricRoom.
 */
export function convertLegacyToParametric(
  legacy: { width: number; length: number; height: number; thickness?: number }
): ParametricRoom {
  const { width, length, height, thickness = 0.15 } = legacy;
  const footprint = createRectangularFootprint(width, length);
  const walls = createRectangularWalls(width, length, height, thickness);

  return {
    footprint,
    walls,
    openings: [],
    height,
    defaultThickness: thickness,
  };
}

/**
 * Returns the authoritative parametric room geometry.
 * If the room already defines valid footprint and walls, uses them.
 * Otherwise, synthesizes them from the legacy rectangular dimensions.
 */
export function getCanonicalRoomGeometry(room: RoomDimensions): ParametricRoom {
  if (
    room.walls &&
    room.walls.length >= 3 &&
    room.footprint &&
    room.footprint.length >= 3
  ) {
    const ccwFootprint = ensureCounterClockwise(room.footprint);
    return {
      footprint: ccwFootprint,
      walls: room.walls,
      openings: room.openings || [],
      height: room.height,
      defaultThickness: 0.15,
    };
  }

  return convertLegacyToParametric(room);
}

/**
 * Computes the minimum Euclidean distance from a 2D point [px, pz] to a line segment [x1, z1] -> [x2, z2].
 */
export function pointToSegmentDistance(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-12) {
    return Math.hypot(px - x1, pz - z1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const projX = x1 + t * dx;
  const projZ = z1 + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

/**
 * Computes the shortest distance from a 2D point [px, pz] to the boundary edges of a polygon.
 */
export function pointToPolygonBoundaryDistance(
  point: Point2D,
  polygon: Point2D[]
): number {
  const n = polygon.length;
  if (n < 2) return Infinity;

  let minDist = Infinity;
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    const d = pointToSegmentDistance(point[0], point[1], p1[0], p1[1], p2[0], p2[1]);
    if (d < minDist) {
      minDist = d;
    }
  }
  return minDist;
}

/**
 * Tests if a 2D point [x, z] is inside, on the boundary of, or outside a simple polygon.
 * Uses ray-casting algorithm (even-odd rule) with explicit boundary segment tolerance.
 * Handles both clockwise and counter-clockwise winding, convex and concave polygons.
 *
 * @param point [x, z] in world coordinates
 * @param polygon Array of 2D polygon vertices in sequential order
 * @param tolerance Optional boundary distance tolerance in metres (default 1e-4)
 * @returns true if inside or on boundary within tolerance, false if outside
 */
export function isPointInPolygon(
  point: Point2D,
  polygon: Point2D[],
  tolerance = 1e-4
): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  const [px, pz] = point;

  // 1. Boundary check: if point is within tolerance of any edge segment, classify as inside
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    if (pointToSegmentDistance(px, pz, p1[0], p1[1], p2[0], p2[1]) <= tolerance) {
      return true;
    }
  }

  // 2. Ray-casting test: cast a horizontal ray along +X direction
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0];
    const zi = polygon[i][1];
    const xj = polygon[j][0];
    const zj = polygon[j][1];

    const crossesY = (zi > pz) !== (zj > pz);
    if (crossesY) {
      const intersectX = ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
      if (px < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}


