import * as THREE from 'three';
import type { Point2D } from '../parametricTypes';
import {
  computePolygonArea,
  computePolygonBounds,
  ensureCounterClockwise,
  validateFootprintPolygon,
} from '../roomGeometry';
import type { FloorGeometryResult } from './geometryTypes';

/**
 * Builds procedural triangulated floor geometry for arbitrary convex or concave CCW polygons.
 */
export function buildFloorGeometry(
  rawFootprint: Point2D[],
  roomHeight = 2.8
): FloorGeometryResult {
  const diagnostics: string[] = [];

  // 1. Validate polygon integrity
  const validation = validateFootprintPolygon(rawFootprint);
  if (!validation.valid) {
    diagnostics.push(...validation.errors);
  }

  // 2. Ensure Counter-Clockwise (CCW) winding
  const footprint = ensureCounterClockwise(rawFootprint);
  const bounds = computePolygonBounds(footprint);
  const area = computePolygonArea(footprint);

  if (footprint.length < 3) {
    return {
      floorGeometry: new THREE.BufferGeometry(),
      outlineGeometry: new THREE.BufferGeometry(),
      area: 0,
      triangleCount: 0,
      bounds,
      diagnostics: ['Floor polygon requires at least 3 vertices.'],
    };
  }

  // 3. Map to 2D Vector2 array for Earcut triangulation
  // Mapping [x, z] -> (x, -z) ensures standard Cartesian 2D orientation
  const contour = footprint.map(([x, z]) => new THREE.Vector2(x, -z));

  // Perform robust Earcut triangulation using Three.js ShapeUtils
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);

  // 4. Build vertex attributes at Y = 0
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const { minX, minZ, width, length } = bounds;
  const safeW = width > 0.01 ? width : 1.0;
  const safeL = length > 0.01 ? length : 1.0;

  for (const [x, z] of footprint) {
    // 3D position on floor plane (Y = 0)
    positions.push(x, 0, z);
    // Upward-facing normal
    normals.push(0, 1, 0);
    // Texture coordinates normalized across room bounds
    const u = (x - minX) / safeW;
    const v = (z - minZ) / safeL;
    uvs.push(u, v);
  }

  // 5. Build triangle indices and ensure consistent +Y normal winding
  const indices: number[] = [];
  for (const tri of triangles) {
    let [i0, i1, i2] = tri;
    const p0 = footprint[i0];
    const p1 = footprint[i1];
    const p2 = footprint[i2];

    // Compute Y component of triangle normal: (p1 - p0) x (p2 - p0)
    // On X/Z plane: (z1 - z0)*(x2 - x0) - (x1 - x0)*(z2 - z0)
    const crossY = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]);

    if (crossY < 0) {
      // Normal points downward (-Y); reverse winding to guarantee +Y normal
      indices.push(i0, i2, i1);
    } else {
      indices.push(i0, i1, i2);
    }
  }

  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  floorGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  floorGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  floorGeometry.setIndex(indices);
  floorGeometry.computeBoundingBox();
  floorGeometry.computeBoundingSphere();

  // 6. Build optional ceiling geometry (Y = roomHeight, facing downward)
  const ceilingPositions: number[] = [];
  const ceilingNormals: number[] = [];
  const ceilingUvs: number[] = [];
  for (const [x, z] of footprint) {
    ceilingPositions.push(x, roomHeight, z);
    ceilingNormals.push(0, -1, 0);
    ceilingUvs.push((x - minX) / safeW, (z - minZ) / safeL);
  }
  const ceilingIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    // Reverse winding for downward-facing ceiling
    ceilingIndices.push(indices[i], indices[i + 2], indices[i + 1]);
  }

  const ceilingGeometry = new THREE.BufferGeometry();
  ceilingGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ceilingPositions, 3));
  ceilingGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(ceilingNormals, 3));
  ceilingGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(ceilingUvs, 2));
  ceilingGeometry.setIndex(ceilingIndices);
  ceilingGeometry.computeBoundingBox();
  ceilingGeometry.computeBoundingSphere();

  // 7. Build floor perimeter outline line segments
  const outlinePositions: number[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const curr = footprint[i];
    const next = footprint[(i + 1) % footprint.length];
    outlinePositions.push(curr[0], 0.005, curr[1]);
    outlinePositions.push(next[0], 0.005, next[1]);
  }

  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
  outlineGeometry.computeBoundingBox();
  outlineGeometry.computeBoundingSphere();

  return {
    floorGeometry,
    ceilingGeometry,
    outlineGeometry,
    area: Number(area.toFixed(4)),
    triangleCount: triangles.length,
    bounds,
    diagnostics,
  };
}

