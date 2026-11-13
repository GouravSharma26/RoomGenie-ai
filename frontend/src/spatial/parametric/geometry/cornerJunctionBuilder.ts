import * as THREE from 'three';
import type { DerivedWall, Point2D } from '../parametricTypes';

export interface CornerJunctionResult {
  junctionGeometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  cornerCount: number;
}

/**
 * Builds clean, watertight corner junction geometry between adjacent wall segments
 * using a bounded miter and wedge-fill algorithm.
 * 
 * Supports:
 * - 90-degree orthogonal corners (convex & concave)
 * - Obtuse corners (e.g. pentagonal & hexagonal rooms)
 * - Acute corners (bounded miter prevents infinite spires)
 * - Near-collinear wall segments (smoothly bypassed)
 */
export function buildCornerJunctions(
  derivedWalls: DerivedWall[],
  defaultHeight = 2.8,
  maxMiterRatio = 1.5
): CornerJunctionResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  let triangleCount = 0;
  let cornerCount = 0;

  const N = derivedWalls.length;
  if (N < 3) {
    return {
      junctionGeometry: new THREE.BufferGeometry(),
      vertexCount: 0,
      triangleCount: 0,
      cornerCount: 0,
    };
  }

  const addTriangle = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    norm: [number, number, number]
  ) => {
    const base = vertexCount;
    positions.push(...p0, ...p1, ...p2);
    normals.push(...norm, ...norm, ...norm);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    indices.push(base, base + 1, base + 2);
    vertexCount += 3;
    triangleCount += 1;
  };

  const addQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    norm: [number, number, number]
  ) => {
    const base = vertexCount;
    positions.push(...p0, ...p1, ...p2, ...p3);
    normals.push(...norm, ...norm, ...norm);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    vertexCount += 4;
    triangleCount += 2;
  };

  for (let i = 0; i < N; i++) {
    const wCurr = derivedWalls[i];
    const wNext = derivedWalls[(i + 1) % N];

    const H = Math.min(wCurr.height, wNext.height) || defaultHeight;
    const T = (wCurr.thickness + wNext.thickness) / 2;
    const halfT = T / 2;

    const [ux1, uz1] = wCurr.direction;
    const [ux2, uz2] = wNext.direction;
    const [nx1, nz1] = wCurr.interiorNormal;
    const [nx2, nz2] = wNext.interiorNormal;

    // The junction vertex V is wCurr.endPoint (which is also wNext.startPoint)
    const [vx, vz] = wCurr.endPoint;

    // Cross product in floor plane to determine turn direction
    // On X/Z plane (with +X East and +Z South):
    // crossY = uz1 * ux2 - ux1 * uz2
    const crossY = uz1 * ux2 - ux1 * uz2;

    // Near collinear walls (less than ~0.5 degree bend) don't need a junction wedge
    if (Math.abs(crossY) < 1e-4) {
      continue;
    }

    cornerCount++;

    if (crossY > 0) {
      // Convex corner (turns left into room interior)
      // The wedge gap is on the EXTERIOR side: between E1 and E2
      // E1 = V - halfT * n1
      // E2 = V - halfT * n2
      const e1: Point2D = [vx - halfT * nx1, vz - halfT * nz1];
      const e2: Point2D = [vx - halfT * nx2, vz - halfT * nz2];

      // Bisector vector on exterior: -(n1 + n2)
      let bx = -(nx1 + nx2);
      let bz = -(nz1 + nz2);
      const bLen = Math.hypot(bx, bz);

      let miterPoint: Point2D;
      if (bLen > 1e-4) {
        bx /= bLen;
        bz /= bLen;

        // cos(theta/2) = dot(n1, (n1+n2)/bLen)
        const cosHalf = Math.max(0.1, (nx1 * (nx1 + nx2) + nz1 * (nz1 + nz2)) / bLen);
        const miterDist = Math.min(halfT / cosHalf, halfT * maxMiterRatio);

        miterPoint = [vx + bx * miterDist, vz + bz * miterDist];
      } else {
        // Fallback: acute 180 flip
        miterPoint = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2];
      }

      // Exterior junction face (vertical quad or two quads to miter point)
      // 1. Face from E1 to Miter
      addQuad(
        [e1[0], 0, e1[1]],
        [miterPoint[0], 0, miterPoint[1]],
        [miterPoint[0], H, miterPoint[1]],
        [e1[0], H, e1[1]],
        [-nx1, 0, -nz1]
      );

      // 2. Face from Miter to E2
      addQuad(
        [miterPoint[0], 0, miterPoint[1]],
        [e2[0], 0, e2[1]],
        [e2[0], H, e2[1]],
        [miterPoint[0], H, miterPoint[1]],
        [-nx2, 0, -nz2]
      );

      // 3. Top cap (y = H, normal +Y)
      addTriangle(
        [vx, H, vz],
        [e1[0], H, e1[1]],
        [miterPoint[0], H, miterPoint[1]],
        [0, 1, 0]
      );
      addTriangle(
        [vx, H, vz],
        [miterPoint[0], H, miterPoint[1]],
        [e2[0], H, e2[1]],
        [0, 1, 0]
      );

      // 4. Bottom cap (y = 0, normal -Y)
      addTriangle(
        [vx, 0, vz],
        [miterPoint[0], 0, miterPoint[1]],
        [e1[0], 0, e1[1]],
        [0, -1, 0]
      );
      addTriangle(
        [vx, 0, vz],
        [e2[0], 0, e2[1]],
        [miterPoint[0], 0, miterPoint[1]],
        [0, -1, 0]
      );
    } else {
      // Concave corner (turns right away from room interior)
      // The wedge gap is on the INTERIOR side: between I1 and I2
      // I1 = V + halfT * n1
      // I2 = V + halfT * n2
      const i1: Point2D = [vx + halfT * nx1, vz + halfT * nz1];
      const i2: Point2D = [vx + halfT * nx2, vz + halfT * nz2];

      // Bisector vector on interior: (n1 + n2)
      let bx = nx1 + nx2;
      let bz = nz1 + nz2;
      const bLen = Math.hypot(bx, bz);

      let miterPoint: Point2D;
      if (bLen > 1e-4) {
        bx /= bLen;
        bz /= bLen;
        const cosHalf = Math.max(0.1, (nx1 * (nx1 + nx2) + nz1 * (nz1 + nz2)) / bLen);
        const miterDist = Math.min(halfT / cosHalf, halfT * maxMiterRatio);
        miterPoint = [vx + bx * miterDist, vz + bz * miterDist];
      } else {
        miterPoint = [(i1[0] + i2[0]) / 2, (i1[1] + i2[1]) / 2];
      }

      // Interior junction face
      addQuad(
        [i2[0], 0, i2[1]],
        [miterPoint[0], 0, miterPoint[1]],
        [miterPoint[0], H, miterPoint[1]],
        [i2[0], H, i2[1]],
        [nx2, 0, nz2]
      );
      addQuad(
        [miterPoint[0], 0, miterPoint[1]],
        [i1[0], 0, i1[1]],
        [i1[0], H, i1[1]],
        [miterPoint[0], H, miterPoint[1]],
        [nx1, 0, nz1]
      );

      // Top cap (y = H, normal +Y)
      addTriangle(
        [vx, H, vz],
        [i2[0], H, i2[1]],
        [miterPoint[0], H, miterPoint[1]],
        [0, 1, 0]
      );
      addTriangle(
        [vx, H, vz],
        [miterPoint[0], H, miterPoint[1]],
        [i1[0], H, i1[1]],
        [0, 1, 0]
      );

      // Bottom cap (y = 0, normal -Y)
      addTriangle(
        [vx, 0, vz],
        [miterPoint[0], 0, miterPoint[1]],
        [i2[0], 0, i2[1]],
        [0, -1, 0]
      );
      addTriangle(
        [vx, 0, vz],
        [i1[0], 0, i1[1]],
        [miterPoint[0], 0, miterPoint[1]],
        [0, -1, 0]
      );
    }
  }

  const junctionGeo = new THREE.BufferGeometry();
  if (positions.length > 0) {
    junctionGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    junctionGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    junctionGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    junctionGeo.setIndex(indices);
    junctionGeo.computeBoundingBox();
    junctionGeo.computeBoundingSphere();
  }

  return {
    junctionGeometry: junctionGeo,
    vertexCount,
    triangleCount,
    cornerCount,
  };
}
