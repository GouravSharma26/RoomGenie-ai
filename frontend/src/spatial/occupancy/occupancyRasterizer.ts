import type { FurniturePlacement, Vector3Tuple } from '../../types/scene';
import { createOBBFromPlacement, getOBBCorners } from '../core/geometryEngine';
import type { 
  CellCoordinate, 
  GridCell, 
  GridDimensions, 
  IgnoredObjectDiagnostic 
} from './occupancyTypes';
import { cellIndex } from './gridCoordinates';

/**
 * 2D point representation on the X/Z floor plane.
 */
export type Point2D = [number, number];

/**
 * Validates whether a furniture placement has physically valid dimensions, scale, and position.
 */
export function validatePlacementGeometry(
  placement: FurniturePlacement
): { valid: boolean; reason?: string } {
  if (!placement || typeof placement !== 'object') {
    return { valid: false, reason: 'Placement is not an object.' };
  }

  const { position, dimensions, scale, rotationEuler } = placement;

  if (!Array.isArray(position) || position.length !== 3 || position.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return { valid: false, reason: 'Placement position contains non-finite values.' };
  }

  if (!Array.isArray(dimensions) || dimensions.length !== 3 || dimensions.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
    return { valid: false, reason: 'Placement dimensions must be positive finite numbers.' };
  }

  const safeScale = Array.isArray(scale) && scale.length === 3 ? scale : [1, 1, 1];
  if (safeScale.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
    return { valid: false, reason: 'Placement scale contains invalid non-positive numbers.' };
  }

  const safeRot = Array.isArray(rotationEuler) && rotationEuler.length === 3 ? rotationEuler : [0, 0, 0];
  if (safeRot.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return { valid: false, reason: 'Placement rotationEuler contains non-finite values.' };
  }

  return { valid: true };
}

/**
 * Computes 2D convex hull of points on the X/Z plane using Monotone Chain algorithm.
 * Returns counter-clockwise ordered convex polygon vertices.
 */
export function computeConvexHull2D(points: Point2D[]): Point2D[] {
  if (points.length <= 3) {
    return points;
  }

  // Sort points lexicographically by X, then by Z
  const sorted = [...points].sort((a, b) => {
    if (Math.abs(a[0] - b[0]) > 1e-6) return a[0] - b[0];
    return a[1] - b[1];
  });

  const cross = (o: Point2D, a: Point2D, b: Point2D): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // Lower hull
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove the last point of each half because it is repeated
  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

/**
 * Extracts the 2D floor footprint polygon (X/Z coordinates) from an arbitrary 3D furniture placement.
 * Uses exact OBB geometry transformed by position, rotation, and non-uniform scale.
 */
export function getFurnitureFootprint2D(placement: FurniturePlacement): Point2D[] {
  const obb = createOBBFromPlacement(placement);
  const corners3D: Vector3Tuple[] = getOBBCorners(obb);

  // Project all 8 3D OBB corners onto the horizontal X/Z floor plane
  const projected2D: Point2D[] = corners3D.map(([x, , z]) => [x, z]);

  // Compute convex hull to get the exact 2D footprint boundary polygon
  return computeConvexHull2D(projected2D);
}

/**
 * Tests intersection between an axis-aligned cell rectangle and a convex 2D polygon
 * using the 2D Separating Axis Theorem (SAT).
 * 
 * @param cellBounds Bounding box of the grid cell [minX, maxX, minZ, maxZ]
 * @param polygon Convex polygon vertices ordered in sequence
 * @returns true if the cell intersects or touches the polygon
 */
export function testAABBPolygonIntersection(
  cellBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  polygon: Point2D[]
): boolean {
  if (polygon.length === 0) return false;

  const { minX, maxX, minZ, maxZ } = cellBounds;

  // 1. Test AABB X-axis: [minX, maxX] vs polygon X extent
  let polyMinX = Infinity;
  let polyMaxX = -Infinity;
  let polyMinZ = Infinity;
  let polyMaxZ = -Infinity;

  for (const [px, pz] of polygon) {
    if (px < polyMinX) polyMinX = px;
    if (px > polyMaxX) polyMaxX = px;
    if (pz < polyMinZ) polyMinZ = pz;
    if (pz > polyMaxZ) polyMaxZ = pz;
  }

  if (maxX < polyMinX || minX > polyMaxX) return false;
  if (maxZ < polyMinZ || minZ > polyMaxZ) return false;

  // Cell rectangle corners:
  const cellCorners: Point2D[] = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];

  // 2. Test edge normals of the polygon
  const numVerts = polygon.length;
  for (let i = 0; i < numVerts; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % numVerts];

    // Edge normal (unnormalized is sufficient for SAT interval overlap)
    const nx = -(p2[1] - p1[1]);
    const nz = p2[0] - p1[0];

    // Degenerate edge check
    if (Math.abs(nx) < 1e-9 && Math.abs(nz) < 1e-9) continue;

    // Project cell corners onto normal
    let minCell = Infinity;
    let maxCell = -Infinity;
    for (const [cx, cz] of cellCorners) {
      const proj = cx * nx + cz * nz;
      if (proj < minCell) minCell = proj;
      if (proj > maxCell) maxCell = proj;
    }

    // Project polygon vertices onto normal
    let minPoly = Infinity;
    let maxPoly = -Infinity;
    for (const [px, pz] of polygon) {
      const proj = px * nx + pz * nz;
      if (proj < minPoly) minPoly = proj;
      if (proj > maxPoly) maxPoly = proj;
    }

    // Check separating interval (allow touching within tolerance)
    if (maxCell < minPoly - 1e-6 || minCell > maxPoly + 1e-6) {
      return false; // Separating axis found
    }
  }

  return true; // Overlaps on all separating axes
}

/**
 * Rasterizes furniture placements onto an array of grid cells.
 * Correctly handles rotated footprints, non-uniform scale, and overlapping furniture.
 */
export function rasterizePlacements(
  placements: FurniturePlacement[],
  cells: GridCell[],
  dimensions: GridDimensions
): {
  objectOccupancyMap: Record<string, CellCoordinate[]>;
  ignoredObjects: IgnoredObjectDiagnostic[];
  totalOccupiedCells: number;
} {
  const objectOccupancyMap: Record<string, CellCoordinate[]> = {};
  const ignoredObjects: IgnoredObjectDiagnostic[] = [];

  for (const placement of placements) {
    // 1. Validate placement geometry
    const validation = validatePlacementGeometry(placement);
    if (!validation.valid) {
      ignoredObjects.push({
        id: placement.id || 'unknown',
        name: placement.name || 'Unnamed',
        reason: validation.reason || 'Invalid geometry',
      });
      continue;
    }

    // 2. Obtain exact 2D convex footprint
    const footprint = getFurnitureFootprint2D(placement);
    if (footprint.length === 0) continue;

    // 3. Compute AABB bounds of the footprint to limit cell evaluation range
    let fpMinX = Infinity, fpMaxX = -Infinity;
    let fpMinZ = Infinity, fpMaxZ = -Infinity;
    for (const [x, z] of footprint) {
      if (x < fpMinX) fpMinX = x;
      if (x > fpMaxX) fpMaxX = x;
      if (z < fpMinZ) fpMinZ = z;
      if (z > fpMaxZ) fpMaxZ = z;
    }

    // 4. Calculate candidate grid column and row ranges
    const minCol = Math.max(0, Math.floor((fpMinX - dimensions.minX) / dimensions.resolution));
    const maxCol = Math.min(dimensions.numCols - 1, Math.floor((fpMaxX - dimensions.minX) / dimensions.resolution));
    const minRow = Math.max(0, Math.floor((fpMinZ - dimensions.minZ) / dimensions.resolution));
    const maxRow = Math.min(dimensions.numRows - 1, Math.floor((fpMaxZ - dimensions.minZ) / dimensions.resolution));

    // If completely outside the grid, skip
    if (minCol > maxCol || minRow > maxRow) {
      objectOccupancyMap[placement.id] = [];
      continue;
    }

    const occupiedCoords: CellCoordinate[] = [];

    // 5. Test intersection only for candidate cells
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const idx = cellIndex(c, r, dimensions.numCols);
        const cell = cells[idx];
        if (!cell) continue;

        if (testAABBPolygonIntersection(cell.bounds, footprint)) {
          cell.isOccupied = true;
          if (!cell.occupyingObjectIds.includes(placement.id)) {
            cell.occupyingObjectIds.push(placement.id);
          }
          occupiedCoords.push({ col: c, row: r });
        }
      }
    }

    objectOccupancyMap[placement.id] = occupiedCoords;
  }

  // Count total occupied cells
  let totalOccupiedCells = 0;
  for (const cell of cells) {
    if (cell.isOccupied) {
      totalOccupiedCells++;
    }
  }

  return {
    objectOccupancyMap,
    ignoredObjects,
    totalOccupiedCells,
  };
}

