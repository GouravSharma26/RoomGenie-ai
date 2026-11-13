import * as THREE from 'three';
import type { DerivedWall, WallOpening } from '../parametricTypes';
import type { SolidWallSection, LocalOpeningBounds } from './geometryTypes';

/**
 * Procedural mesh builder for an individual wall segment with zero-CSG opening cutouts.
 */
export class WallSectionBuilder {
  private derived: DerivedWall;
  private openings: WallOpening[];
  private thickness: number;
  private height: number;
  private length: number;

  // Vertex buffer accumulators
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  private vertexCount = 0;

  // Track solid sections for diagnostics/metadata
  private solidSections: SolidWallSection[] = [];
  private diagnostics: string[] = [];

  constructor(derived: DerivedWall, openings: WallOpening[] = []) {
    this.derived = derived;
    this.openings = openings;
    this.thickness = derived.thickness;
    this.height = derived.height;
    this.length = derived.length;
  }

  /**
   * Transforms wall-local coordinates (s, y, t) into 3D world space [X, Y, Z].
   * - s: Distance in metres along wall direction vector from startPoint (0 to L)
   * - y: Vertical height in metres from floor plane (0 to H)
   * - t: Distance in metres along interior normal vector (-T/2 to +T/2)
   */
  private localToWorld(s: number, y: number, t: number): [number, number, number] {
    const [x1, z1] = this.derived.startPoint;
    const [ux, uz] = this.derived.direction;
    const [nx, nz] = this.derived.interiorNormal;

    const wx = x1 + s * ux + t * nx;
    const wy = y;
    const wz = z1 + s * uz + t * nz;

    return [wx, wy, wz];
  }

  /**
   * Appends a planar quad (two triangles) with consistent CCW winding and normal.
   */
  private addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    normal: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    uv3: [number, number]
  ): void {
    const baseIdx = this.vertexCount;

    // Push positions
    this.positions.push(...p0, ...p1, ...p2, ...p3);
    // Push normals
    this.normals.push(...normal, ...normal, ...normal, ...normal);
    // Push UVs
    this.uvs.push(...uv0, ...uv1, ...uv2, ...uv3);

    // Two CCW triangles: (0, 1, 2) and (0, 2, 3)
    this.indices.push(
      baseIdx, baseIdx + 1, baseIdx + 2,
      baseIdx, baseIdx + 2, baseIdx + 3
    );

    this.vertexCount += 4;
  }

  /**
   * Subdivides the wall horizontally and vertically around valid openings and builds geometry.
   */
  public build(): {
    geometry: THREE.BufferGeometry;
    solidSections: SolidWallSection[];
    diagnostics: string[];
  } {
    const L = this.length;
    const H = this.height;
    const T = this.thickness;
    const halfT = T / 2;

    if (L < 0.01 || H < 0.01) {
      this.diagnostics.push(`Degenerate wall segment '${this.derived.id}' with length ${L}m, height ${H}m.`);
      return {
        geometry: new THREE.BufferGeometry(),
        solidSections: [],
        diagnostics: this.diagnostics,
      };
    }

    // 1. Process and sanitize openings for this wall
    const validOpenings: LocalOpeningBounds[] = [];
    for (const op of this.openings) {
      if (op.wallId !== this.derived.id) continue;

      const sStart = Math.max(0, op.distanceAlongWall);
      const sEnd = Math.min(L, op.distanceAlongWall + op.width);
      const ySill = Math.max(0, op.sillHeight ?? 0);
      const yTop = Math.min(H, ySill + op.height);

      if (sEnd - sStart < 0.05) {
        this.diagnostics.push(`Opening '${op.id}' discarded: effective width on wall '${this.derived.id}' is under 0.05m.`);
        continue;
      }
      if (yTop - ySill < 0.05) {
        this.diagnostics.push(`Opening '${op.id}' discarded: effective height on wall '${this.derived.id}' is under 0.05m.`);
        continue;
      }

      validOpenings.push({
        openingId: op.id,
        type: op.type,
        sStart: Number(sStart.toFixed(4)),
        sEnd: Number(sEnd.toFixed(4)),
        ySill: Number(ySill.toFixed(4)),
        yTop: Number(yTop.toFixed(4)),
        width: Number((sEnd - sStart).toFixed(4)),
        height: Number((yTop - ySill).toFixed(4)),
      });
    }

    // Sort openings by distance along wall
    validOpenings.sort((a, b) => a.sStart - b.sStart);

    // 2. Collect critical horizontal division points along the wall
    const splitPoints = new Set<number>([0, L]);
    for (const op of validOpenings) {
      splitPoints.add(op.sStart);
      splitPoints.add(op.sEnd);
    }
    const sortedSplits = Array.from(splitPoints).sort((a, b) => a - b);

    // 3. For each horizontal interval, determine solid vertical subdivisions
    for (let i = 0; i < sortedSplits.length - 1; i++) {
      const sA = sortedSplits[i];
      const sB = sortedSplits[i + 1];
      if (sB - sA < 0.001) continue;

      const midS = (sA + sB) / 2;
      const hostOpening = validOpenings.find((op) => midS >= op.sStart && midS <= op.sEnd);

      if (!hostOpening) {
        // Uninterrupted wall segment: full height from 0 to H
        this.solidSections.push({
          sMin: sA,
          sMax: sB,
          yMin: 0,
          yMax: H,
          type: 'full',
        });
      } else {
        // Interval has an opening:
        // A. Sill section below the opening (if sill > 0)
        if (hostOpening.ySill > 0.02) {
          this.solidSections.push({
            sMin: sA,
            sMax: sB,
            yMin: 0,
            yMax: hostOpening.ySill,
            type: 'sill',
          });
        }

        // B. Lintel section above the opening (if opening doesn't touch ceiling)
        if (H - hostOpening.yTop > 0.02) {
          this.solidSections.push({
            sMin: sA,
            sMax: sB,
            yMin: hostOpening.yTop,
            yMax: H,
            type: 'lintel',
          });
        }
      }
    }

    const [nx, nz] = this.derived.interiorNormal;
    const [ux, uz] = this.derived.direction;

    // Precomputed unit normals
    const intNormal: [number, number, number] = [nx, 0, nz];
    const extNormal: [number, number, number] = [-nx, 0, -nz];
    const upNormal: [number, number, number] = [0, 1, 0];
    const downNormal: [number, number, number] = [0, -1, 0];
    const forwardNormal: [number, number, number] = [ux, 0, uz];
    const backwardNormal: [number, number, number] = [-ux, 0, -uz];

    // 4. Generate Interior & Exterior Quads for all solid sections
    for (const sec of this.solidSections) {
      const { sMin, sMax, yMin, yMax } = sec;

      // Interior Face (+interiorNormal)
      // Viewing toward wall interior: normal faces room (+n)
      const pInt0 = this.localToWorld(sMax, yMin, halfT);
      const pInt1 = this.localToWorld(sMin, yMin, halfT);
      const pInt2 = this.localToWorld(sMin, yMax, halfT);
      const pInt3 = this.localToWorld(sMax, yMax, halfT);
      this.addQuad(
        pInt0, pInt1, pInt2, pInt3,
        intNormal,
        [sMax, yMin], [sMin, yMin], [sMin, yMax], [sMax, yMax]
      );

      // Exterior Face (-interiorNormal)
      // Viewing toward wall exterior: normal faces outside (-n)
      const pExt0 = this.localToWorld(sMin, yMin, -halfT);
      const pExt1 = this.localToWorld(sMax, yMin, -halfT);
      const pExt2 = this.localToWorld(sMax, yMax, -halfT);
      const pExt3 = this.localToWorld(sMin, yMax, -halfT);
      this.addQuad(
        pExt0, pExt1, pExt2, pExt3,
        extNormal,
        [sMin, yMin], [sMax, yMin], [sMax, yMax], [sMin, yMax]
      );
    }

    // 5. Generate Top and Bottom Wall Surfaces
    // Top surface at y = H
    for (let i = 0; i < sortedSplits.length - 1; i++) {
      const sA = sortedSplits[i];
      const sB = sortedSplits[i + 1];
      if (sB - sA < 0.001) continue;

      // Check if this horizontal slice has solid wall at y = H
      const hasTop = this.solidSections.some(
        (sec) => sec.sMin <= sA + 0.001 && sec.sMax >= sB - 0.001 && Math.abs(sec.yMax - H) < 0.01
      );

      if (hasTop) {
        const pTop0 = this.localToWorld(sA, H, -halfT);
        const pTop1 = this.localToWorld(sB, H, -halfT);
        const pTop2 = this.localToWorld(sB, H, halfT);
        const pTop3 = this.localToWorld(sA, H, halfT);
        this.addQuad(
          pTop0, pTop1, pTop2, pTop3,
          upNormal,
          [sA, 0], [sB, 0], [sB, T], [sA, T]
        );
      }
    }

    // Bottom surface at y = 0
    for (let i = 0; i < sortedSplits.length - 1; i++) {
      const sA = sortedSplits[i];
      const sB = sortedSplits[i + 1];
      if (sB - sA < 0.001) continue;

      // Check if this horizontal slice has solid wall at y = 0 (doors do NOT have wall bottom)
      const hasBottom = this.solidSections.some(
        (sec) => sec.sMin <= sA + 0.001 && sec.sMax >= sB - 0.001 && Math.abs(sec.yMin) < 0.01
      );

      if (hasBottom) {
        const pBot0 = this.localToWorld(sB, 0, -halfT);
        const pBot1 = this.localToWorld(sA, 0, -halfT);
        const pBot2 = this.localToWorld(sA, 0, halfT);
        const pBot3 = this.localToWorld(sB, 0, halfT);
        this.addQuad(
          pBot0, pBot1, pBot2, pBot3,
          downNormal,
          [sB, 0], [sA, 0], [sA, T], [sB, T]
        );
      }
    }

    // 6. Generate Wall End-Caps at s = 0 and s = L
    // Start End-Cap at s = 0 (facing -u)
    const pStart0 = this.localToWorld(0, 0, halfT);
    const pStart1 = this.localToWorld(0, 0, -halfT);
    const pStart2 = this.localToWorld(0, H, -halfT);
    const pStart3 = this.localToWorld(0, H, halfT);
    this.addQuad(
      pStart0, pStart1, pStart2, pStart3,
      backwardNormal,
      [0, 0], [T, 0], [T, H], [0, H]
    );

    // End End-Cap at s = L (facing +u)
    const pEnd0 = this.localToWorld(L, 0, -halfT);
    const pEnd1 = this.localToWorld(L, 0, halfT);
    const pEnd2 = this.localToWorld(L, H, halfT);
    const pEnd3 = this.localToWorld(L, H, -halfT);
    this.addQuad(
      pEnd0, pEnd1, pEnd2, pEnd3,
      forwardNormal,
      [0, 0], [T, 0], [T, H], [0, H]
    );

    // 7. Generate Opening Reveals (Jambs, Lintel Underside, Sill Top)
    for (const op of validOpenings) {
      const { sStart, sEnd, ySill, yTop } = op;

      // Left Jamb at s = sStart (facing into opening: +u)
      const pJambL0 = this.localToWorld(sStart, ySill, -halfT);
      const pJambL1 = this.localToWorld(sStart, ySill, halfT);
      const pJambL2 = this.localToWorld(sStart, yTop, halfT);
      const pJambL3 = this.localToWorld(sStart, yTop, -halfT);
      this.addQuad(
        pJambL0, pJambL1, pJambL2, pJambL3,
        forwardNormal,
        [0, ySill], [T, ySill], [T, yTop], [0, yTop]
      );

      // Right Jamb at s = sEnd (facing into opening: -u)
      const pJambR0 = this.localToWorld(sEnd, ySill, halfT);
      const pJambR1 = this.localToWorld(sEnd, ySill, -halfT);
      const pJambR2 = this.localToWorld(sEnd, yTop, -halfT);
      const pJambR3 = this.localToWorld(sEnd, yTop, halfT);
      this.addQuad(
        pJambR0, pJambR1, pJambR2, pJambR3,
        backwardNormal,
        [0, ySill], [T, ySill], [T, yTop], [0, yTop]
      );

      // Lintel Underside at y = yTop (facing down: -Y)
      if (H - yTop > 0.01) {
        const pLintel0 = this.localToWorld(sEnd, yTop, -halfT);
        const pLintel1 = this.localToWorld(sStart, yTop, -halfT);
        const pLintel2 = this.localToWorld(sStart, yTop, halfT);
        const pLintel3 = this.localToWorld(sEnd, yTop, halfT);
        this.addQuad(
          pLintel0, pLintel1, pLintel2, pLintel3,
          downNormal,
          [sEnd, 0], [sStart, 0], [sStart, T], [sEnd, T]
        );
      }

      // Sill Top at y = ySill (for windows, facing up: +Y)
      if (ySill > 0.01) {
        const pSill0 = this.localToWorld(sStart, ySill, -halfT);
        const pSill1 = this.localToWorld(sEnd, ySill, -halfT);
        const pSill2 = this.localToWorld(sEnd, ySill, halfT);
        const pSill3 = this.localToWorld(sStart, ySill, halfT);
        this.addQuad(
          pSill0, pSill1, pSill2, pSill3,
          upNormal,
          [sStart, 0], [sEnd, 0], [sEnd, T], [sStart, T]
        );
      }
    }

    // 8. Assemble BufferGeometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return {
      geometry,
      solidSections: this.solidSections,
      diagnostics: this.diagnostics,
    };
  }
}

