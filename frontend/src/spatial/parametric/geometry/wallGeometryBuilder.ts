import * as THREE from 'three';
import type { DerivedWall, WallOpening, WallSegment } from '../parametricTypes';
import { deriveWallProperties } from '../roomGeometry';
import { validateWallOpenings } from '../openingValidator';
import { WallSectionBuilder } from './wallSectionBuilder';
import type { WallGeometryResult } from './geometryTypes';

/**
 * Builds subtle decorative/structural frame casing for door and window openings.
 */
function buildOpeningFrames(
  derived: DerivedWall,
  openings: WallOpening[]
): THREE.BufferGeometry | undefined {
  const validOpenings = openings.filter((op) => op.wallId === derived.id);
  if (validOpenings.length === 0) return undefined;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const [x1, z1] = derived.startPoint;
  const [ux, uz] = derived.direction;
  const [nx, nz] = derived.interiorNormal;
  const halfT = derived.thickness / 2;
  const casingWidth = 0.05; // 5cm frame border
  const casingDepth = 0.015; // 1.5cm projection beyond wall face

  const localToWorld = (s: number, y: number, t: number): [number, number, number] => [
    x1 + s * ux + t * nx,
    y,
    z1 + s * uz + t * nz,
  ];

  const addBox = (
    sMin: number,
    sMax: number,
    yMin: number,
    yMax: number,
    tMin: number,
    tMax: number
  ) => {
    // 6 faces of the box
    const quads: Array<{
      pts: [number, number, number][];
      norm: [number, number, number];
    }> = [
      // Front (+t, towards interior)
      {
        pts: [
          localToWorld(sMax, yMin, tMax),
          localToWorld(sMin, yMin, tMax),
          localToWorld(sMin, yMax, tMax),
          localToWorld(sMax, yMax, tMax),
        ],
        norm: [nx, 0, nz],
      },
      // Back (-t, towards exterior)
      {
        pts: [
          localToWorld(sMin, yMin, tMin),
          localToWorld(sMax, yMin, tMin),
          localToWorld(sMax, yMax, tMin),
          localToWorld(sMin, yMax, tMin),
        ],
        norm: [-nx, 0, -nz],
      },
      // Top (+y)
      {
        pts: [
          localToWorld(sMin, yMax, tMin),
          localToWorld(sMax, yMax, tMin),
          localToWorld(sMax, yMax, tMax),
          localToWorld(sMin, yMax, tMax),
        ],
        norm: [0, 1, 0],
      },
      // Bottom (-y)
      {
        pts: [
          localToWorld(sMax, yMin, tMin),
          localToWorld(sMin, yMin, tMin),
          localToWorld(sMin, yMin, tMax),
          localToWorld(sMax, yMin, tMax),
        ],
        norm: [0, -1, 0],
      },
      // Left (-s)
      {
        pts: [
          localToWorld(sMin, yMin, tMax),
          localToWorld(sMin, yMin, tMin),
          localToWorld(sMin, yMax, tMin),
          localToWorld(sMin, yMax, tMax),
        ],
        norm: [-ux, 0, -uz],
      },
      // Right (+s)
      {
        pts: [
          localToWorld(sMax, yMin, tMin),
          localToWorld(sMax, yMin, tMax),
          localToWorld(sMax, yMax, tMax),
          localToWorld(sMax, yMax, tMin),
        ],
        norm: [ux, 0, uz],
      },
    ];

    for (const q of quads) {
      const base = vertexCount;
      positions.push(...q.pts[0], ...q.pts[1], ...q.pts[2], ...q.pts[3]);
      normals.push(...q.norm, ...q.norm, ...q.norm, ...q.norm);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      vertexCount += 4;
    }
  };

  for (const op of validOpenings) {
    const sStart = Math.max(0, op.distanceAlongWall);
    const sEnd = Math.min(derived.length, op.distanceAlongWall + op.width);
    const ySill = Math.max(0, op.sillHeight ?? 0);
    const yTop = Math.min(derived.height, ySill + op.height);

    // Left casing architrave
    addBox(
      Math.max(0, sStart - casingWidth),
      sStart,
      ySill,
      yTop + casingWidth,
      halfT,
      halfT + casingDepth
    );

    // Right casing architrave
    addBox(
      sEnd,
      Math.min(derived.length, sEnd + casingWidth),
      ySill,
      yTop + casingWidth,
      halfT,
      halfT + casingDepth
    );

    // Top lintel casing architrave
    addBox(
      Math.max(0, sStart - casingWidth),
      Math.min(derived.length, sEnd + casingWidth),
      yTop,
      yTop + casingWidth,
      halfT,
      halfT + casingDepth
    );

    // Window sill projection plate
    if (op.type === 'window' && ySill > 0.01) {
      addBox(
        Math.max(0, sStart - casingWidth * 1.5),
        Math.min(derived.length, sEnd + casingWidth * 1.5),
        Math.max(0, ySill - 0.03),
        ySill,
        -halfT,
        halfT + casingDepth * 2.0
      );
    }
  }

  if (positions.length === 0) return undefined;

  const frameGeo = new THREE.BufferGeometry();
  frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  frameGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  frameGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  frameGeo.setIndex(indices);
  frameGeo.computeBoundingBox();
  frameGeo.computeBoundingSphere();

  return frameGeo;
}

/**
 * Procedural geometry builder for canonical wall segments.
 */
export function buildWallGeometry(
  wall: WallSegment,
  openings: WallOpening[] = [],
  defaultHeight = 2.8,
  defaultThickness = 0.15
): WallGeometryResult {
  const derived = deriveWallProperties(wall, defaultHeight, defaultThickness);
  const wallOpenings = openings.filter((op) => op.wallId === wall.id);

  // Validate openings for diagnostics
  const validation = validateWallOpenings(
    wallOpenings,
    [wall]
  );

  const builder = new WallSectionBuilder(derived, wallOpenings);
  const { geometry, solidSections, diagnostics } = builder.build();

  const allDiagnostics = [...validation.errors, ...diagnostics];

  // Build subtle frame casing if openings exist
  const frameGeometry = buildOpeningFrames(derived, wallOpenings);

  return {
    wallId: wall.id,
    wallGeometry: geometry,
    frameGeometry,
    derived,
    solidSections,
    openings: wallOpenings,
    diagnostics: allDiagnostics,
  };
}

/**
 * Builds procedural geometry for an array of canonical wall segments.
 */
export function buildAllWallsGeometry(
  walls: WallSegment[],
  openings: WallOpening[] = [],
  defaultHeight = 2.8,
  defaultThickness = 0.15
): WallGeometryResult[] {
  return walls.map((wall) =>
    buildWallGeometry(wall, openings, defaultHeight, defaultThickness)
  );
}

