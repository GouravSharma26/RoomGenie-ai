import { describe, it, expect } from 'vitest';
import {
  buildWallGeometry,
  buildFloorGeometry,
  buildProceduralRoomGeometries,
} from '../parametric/geometry';
import type { WallSegment, WallOpening, Point2D } from '../parametric/parametricTypes';

describe('Phase 5.2: Procedural Wall & Floor Geometry Engine', () => {
  describe('Stage 3 — Procedural Wall Mesh Generation', () => {
    it('generates a standard rectangular wall with correct dimensions, normals, and bounds', () => {
      const wall: WallSegment = {
        id: 'wall-south',
        startPoint: [-2.5, 3.0],
        endPoint: [2.5, 3.0],
        height: 2.8,
        thickness: 0.15,
      };

      const result = buildWallGeometry(wall);
      expect(result.wallId).toBe('wall-south');
      expect(result.solidSections.length).toBe(1);
      expect(result.solidSections[0].type).toBe('full');

      const geo = result.wallGeometry;
      expect(geo.getAttribute('position')).toBeDefined();
      expect(geo.getAttribute('normal')).toBeDefined();
      expect(geo.getAttribute('uv')).toBeDefined();
      expect(geo.getIndex()).toBeDefined();

      const box = geo.boundingBox!;
      expect(box).toBeDefined();
      // Length along X is 5.0m (-2.5 to 2.5)
      expect(box.min.x).toBeCloseTo(-2.5, 2);
      expect(box.max.x).toBeCloseTo(2.5, 2);
      // Height along Y is 2.8m (0 to 2.8)
      expect(box.min.y).toBeCloseTo(0.0, 2);
      expect(box.max.y).toBeCloseTo(2.8, 2);
      // Thickness around Z=3.0 with thickness=0.15 is 3.0 +- 0.075 -> [2.925, 3.075]
      expect(box.min.z).toBeCloseTo(2.925, 2);
      expect(box.max.z).toBeCloseTo(3.075, 2);

      // Verify normal vectors: position attribute count equals normal attribute count
      const posCount = geo.getAttribute('position').count;
      const normCount = geo.getAttribute('normal').count;
      expect(posCount).toBe(normCount);

      // All normals must have unit length approx 1.0
      const normArray = geo.getAttribute('normal').array;
      for (let i = 0; i < normArray.length; i += 3) {
        const nx = normArray[i];
        const ny = normArray[i + 1];
        const nz = normArray[i + 2];
        const len = Math.hypot(nx, ny, nz);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });

    it('generates a diagonal wall at 45 degrees correctly', () => {
      const wall: WallSegment = {
        id: 'wall-diagonal-45',
        startPoint: [0, 0],
        endPoint: [3, 3], // dx=3, dz=3, length ~ 4.2426m
        height: 3.0,
        thickness: 0.2,
      };

      const result = buildWallGeometry(wall);
      expect(result.derived.length).toBeCloseTo(Math.SQRT2 * 3, 3);
      expect(result.derived.angleRadians).toBeCloseTo(Math.PI / 4, 3);

      const box = result.wallGeometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0.0, 2);
      expect(box.max.y).toBeCloseTo(3.0, 2);

      // Direction unit vector is [1/sqrt2, 1/sqrt2]
      expect(result.derived.direction[0]).toBeCloseTo(Math.SQRT1_2, 3);
      expect(result.derived.direction[1]).toBeCloseTo(Math.SQRT1_2, 3);
      // Interior normal is [1/sqrt2, -1/sqrt2]
      expect(result.derived.interiorNormal[0]).toBeCloseTo(Math.SQRT1_2, 3);
      expect(result.derived.interiorNormal[1]).toBeCloseTo(-Math.SQRT1_2, 3);
    });

    it('generates a wall at an arbitrary non-orthogonal angle (pentagonal edge)', () => {
      const wall: WallSegment = {
        id: 'wall-penta',
        startPoint: [2.5, 3.0],
        endPoint: [3.8, -1.2], // dx=1.3, dz=-4.2
        height: 2.5,
        thickness: 0.18,
      };

      const result = buildWallGeometry(wall);
      expect(result.derived.length).toBeCloseTo(Math.hypot(1.3, -4.2), 3);
      expect(result.wallGeometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(result.diagnostics).toEqual([]);
    });

    it('respects custom wall thickness and height', () => {
      const wall: WallSegment = {
        id: 'thick-tall-wall',
        startPoint: [-2, 0],
        endPoint: [2, 0],
        height: 4.5,
        thickness: 0.4, // Heavy 40cm structural wall
      };

      const result = buildWallGeometry(wall);
      expect(result.derived.thickness).toBe(0.4);
      expect(result.derived.height).toBe(4.5);

      const box = result.wallGeometry.boundingBox!;
      expect(box.max.y - box.min.y).toBeCloseTo(4.5, 2);
      expect(box.max.z - box.min.z).toBeCloseTo(0.4, 2);
    });

    it('verifies interior and exterior orientation and top/bottom surfaces', () => {
      const wall: WallSegment = {
        id: 'orient-wall',
        startPoint: [-2, 0],
        endPoint: [2, 0],
        height: 2.5,
        thickness: 0.2,
      };

      const result = buildWallGeometry(wall);
      const normArray = result.wallGeometry.getAttribute('normal').array;

      let hasUp = false;
      let hasDown = false;
      let hasInterior = false;
      let hasExterior = false;

      const [nx, nz] = result.derived.interiorNormal;

      for (let i = 0; i < normArray.length; i += 3) {
        const x = normArray[i];
        const y = normArray[i + 1];
        const z = normArray[i + 2];

        if (y > 0.99) hasUp = true;
        if (y < -0.99) hasDown = true;
        if (Math.abs(x - nx) < 0.01 && Math.abs(z - nz) < 0.01) hasInterior = true;
        if (Math.abs(x - (-nx)) < 0.01 && Math.abs(z - (-nz)) < 0.01) hasExterior = true;
      }

      expect(hasUp).toBe(true);
      expect(hasDown).toBe(true);
      expect(hasInterior).toBe(true);
      expect(hasExterior).toBe(true);
    });

    it('handles degenerate zero-length wall with warning diagnostic', () => {
      const wall: WallSegment = {
        id: 'wall-degenerate',
        startPoint: [1.0, 1.0],
        endPoint: [1.0, 1.0],
        height: 2.8,
      };

      const result = buildWallGeometry(wall);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).toContain('Degenerate wall segment');
      expect(result.solidSections).toHaveLength(0);
    });
  });

  describe('Stage 4 — Opening-Aware Wall Geometry (Doors & Windows)', () => {
    const hostWall: WallSegment = {
      id: 'wall-host',
      startPoint: [-3.0, 0],
      endPoint: [3.0, 0], // Length 6.0m
      height: 2.8,
      thickness: 0.15,
    };

    it('cuts out a door opening at the wall centre with floor clearance and lintel section', () => {
      const door: WallOpening = {
        id: 'door-main',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 2.5, // Center from 2.5m to 3.5m (width 1.0m)
        width: 1.0,
        height: 2.1,
        sillHeight: 0.0,
      };

      const result = buildWallGeometry(hostWall, [door]);
      expect(result.openings).toHaveLength(1);

      // Should have 3 solid sections: Left wall (0 to 2.5), Lintel above door (2.5 to 3.5, y 2.1 to 2.8), Right wall (3.5 to 6.0)
      expect(result.solidSections).toHaveLength(3);

      const leftSection = result.solidSections.find((s) => s.sMax === 2.5);
      expect(leftSection).toBeDefined();
      expect(leftSection?.type).toBe('full');
      expect(leftSection?.yMin).toBe(0);
      expect(leftSection?.yMax).toBe(2.8);

      const lintelSection = result.solidSections.find((s) => s.type === 'lintel');
      expect(lintelSection).toBeDefined();
      expect(lintelSection?.sMin).toBe(2.5);
      expect(lintelSection?.sMax).toBe(3.5);
      expect(lintelSection?.yMin).toBe(2.1);
      expect(lintelSection?.yMax).toBe(2.8);

      const rightSection = result.solidSections.find((s) => s.sMin === 3.5);
      expect(rightSection).toBeDefined();
      expect(rightSection?.type).toBe('full');
      expect(rightSection?.yMax).toBe(2.8);

      // Verify frame geometry was generated for the door
      expect(result.frameGeometry).toBeDefined();
      expect(result.frameGeometry?.getAttribute('position').count).toBeGreaterThan(0);
    });

    it('places door near one end (distanceAlongWall = 0.2m) with correct clearance and sections', () => {
      const door: WallOpening = {
        id: 'door-corner',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 0.2,
        width: 0.9, // 0.2 to 1.1m
        height: 2.1,
      };

      const result = buildWallGeometry(hostWall, [door]);
      expect(result.solidSections).toHaveLength(3);
      // Small stub at wall start: [0, 0.2]
      const stub = result.solidSections.find((s) => s.sMax === 0.2);
      expect(stub).toBeDefined();
      expect(stub?.yMax).toBe(2.8);
      // Long right wall: [1.1, 6.0]
      const right = result.solidSections.find((s) => s.sMin === 1.1);
      expect(right).toBeDefined();
    });

    it('cuts out a window with sill wall below, lintel above, and side sections', () => {
      const window: WallOpening = {
        id: 'window-bay',
        wallId: 'wall-host',
        type: 'window',
        distanceAlongWall: 1.5,
        width: 1.8, // 1.5m to 3.3m
        height: 1.2,
        sillHeight: 0.9, // Window from 0.9m to 2.1m
      };

      const result = buildWallGeometry(hostWall, [window]);
      expect(result.openings).toHaveLength(1);

      // Solid sections: Left (0-1.5 full), Sill (1.5-3.3, y 0-0.9), Lintel (1.5-3.3, y 2.1-2.8), Right (3.3-6.0 full)
      expect(result.solidSections).toHaveLength(4);

      const sill = result.solidSections.find((s) => s.type === 'sill');
      expect(sill).toBeDefined();
      expect(sill?.sMin).toBe(1.5);
      expect(sill?.sMax).toBe(3.3);
      expect(sill?.yMin).toBe(0);
      expect(sill?.yMax).toBe(0.9);

      const lintel = result.solidSections.find((s) => s.type === 'lintel');
      expect(lintel).toBeDefined();
      expect(lintel?.sMin).toBe(1.5);
      expect(lintel?.sMax).toBe(3.3);
      expect(lintel?.yMin).toBe(2.1);
      expect(lintel?.yMax).toBe(2.8);

      // Verify window sill projection plate exists in frame geometry
      expect(result.frameGeometry).toBeDefined();
    });

    it('handles multiple openings on the same wall (door and window)', () => {
      const door: WallOpening = {
        id: 'door-1',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 0.5,
        width: 0.9, // 0.5 to 1.4m
        height: 2.1,
      };

      const window: WallOpening = {
        id: 'win-1',
        wallId: 'wall-host',
        type: 'window',
        distanceAlongWall: 3.0,
        width: 1.5, // 3.0 to 4.5m
        height: 1.2,
        sillHeight: 0.9,
      };

      const result = buildWallGeometry(hostWall, [door, window]);
      expect(result.openings).toHaveLength(2);

      // Wall sections:
      // 1. [0, 0.5] full
      // 2. [0.5, 1.4] door lintel
      // 3. [1.4, 3.0] intermediate full wall
      // 4. [3.0, 4.5] window sill
      // 5. [3.0, 4.5] window lintel
      // 6. [4.5, 6.0] right full wall
      expect(result.solidSections).toHaveLength(6);

      const intermediate = result.solidSections.find(
        (s) => s.type === 'full' && s.sMin === 1.4 && s.sMax === 3.0
      );
      expect(intermediate).toBeDefined();
      expect(intermediate?.yMax).toBe(2.8);
    });

    it('handles two non-overlapping doors near opposite ends of a long wall', () => {
      const door1: WallOpening = {
        id: 'door-left',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 0.3,
        width: 0.8,
        height: 2.1,
      };

      const door2: WallOpening = {
        id: 'door-right',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 4.8,
        width: 0.8,
        height: 2.1,
      };

      const result = buildWallGeometry(hostWall, [door1, door2]);
      expect(result.solidSections).toHaveLength(5);
      // Intermediate wall between the two doors from 1.1m to 4.8m
      const middleWall = result.solidSections.find((s) => s.sMin === 1.1 && s.sMax === 4.8);
      expect(middleWall).toBeDefined();
      expect(middleWall?.type).toBe('full');
    });

    it('handles multiple windows along a long wall with piers between them', () => {
      const win1: WallOpening = {
        id: 'win-1',
        wallId: 'wall-host',
        type: 'window',
        distanceAlongWall: 1.0,
        width: 1.2,
        height: 1.2,
        sillHeight: 0.9,
      };

      const win2: WallOpening = {
        id: 'win-2',
        wallId: 'wall-host',
        type: 'window',
        distanceAlongWall: 3.5,
        width: 1.2,
        height: 1.2,
        sillHeight: 0.9,
      };

      const result = buildWallGeometry(hostWall, [win1, win2]);
      // Pier between windows from 2.2m to 3.5m is full height
      const pier = result.solidSections.find((s) => s.sMin === 2.2 && s.sMax === 3.5);
      expect(pier).toBeDefined();
      expect(pier?.type).toBe('full');
      expect(pier?.yMax).toBe(2.8);
    });

    it('flags diagnostic when window exceeds wall height (sill + height > wall height)', () => {
      const tallWindow: WallOpening = {
        id: 'tall-win',
        wallId: 'wall-host',
        type: 'window',
        distanceAlongWall: 2.0,
        width: 1.0,
        height: 2.5,
        sillHeight: 1.0, // 1.0 + 2.5 = 3.5m on a 2.8m wall!
      };

      const result = buildWallGeometry(hostWall, [tallWindow]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).toContain('exceeds wall height');
    });

    it('discards invalid opening that extends beyond wall length with diagnostic', () => {
      const invalidOpening: WallOpening = {
        id: 'overflow-door',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 5.8,
        width: 1.2, // Extends to 7.0m on a 6.0m wall!
        height: 2.1,
      };

      const result = buildWallGeometry(hostWall, [invalidOpening]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).toContain('exceeds host wall');
    });

    it('flags diagnostic for overlapping openings on the same wall', () => {
      const op1: WallOpening = {
        id: 'op-1',
        wallId: 'wall-host',
        type: 'door',
        distanceAlongWall: 2.0,
        width: 1.0,
        height: 2.1,
      };

      const op2: WallOpening = {
        id: 'op-2',
        wallId: 'wall-host',
        type: 'window',
        distanceAlongWall: 2.5, // Overlaps op1 by 0.5m!
        width: 1.0,
        height: 1.2,
        sillHeight: 0.9,
      };

      const result = buildWallGeometry(hostWall, [op1, op2]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics.some((d) => d.includes('overlap'))).toBe(true);
    });

    it('ignores opening with wallId belonging to another wall', () => {
      const otherWallOpening: WallOpening = {
        id: 'other-wall-door',
        wallId: 'some-other-wall',
        type: 'door',
        distanceAlongWall: 1.0,
        width: 1.0,
        height: 2.1,
      };

      const result = buildWallGeometry(hostWall, [otherWallOpening]);
      expect(result.openings).toHaveLength(0);
      expect(result.solidSections).toHaveLength(1);
      expect(result.solidSections[0].type).toBe('full');
    });
  });

  describe('Stage 5 — Arbitrary Polygon Floor Generation', () => {
    it('triangulates a standard rectangular floor footprint into 2 triangles', () => {
      const rectFootprint: Point2D[] = [
        [-2.5, 3.0],
        [2.5, 3.0],
        [2.5, -3.0],
        [-2.5, -3.0],
      ];

      const result = buildFloorGeometry(rectFootprint, 2.8);
      expect(result.area).toBeCloseTo(30.0, 2);
      expect(result.triangleCount).toBe(2);
      expect(result.diagnostics).toHaveLength(0);

      const geo = result.floorGeometry;
      expect(geo.getAttribute('position').count).toBe(4);
      expect(geo.getIndex()?.count).toBe(6); // 2 triangles * 3 indices

      // Verify all floor vertices are at Y = 0
      const posArray = geo.getAttribute('position').array;
      for (let i = 1; i < posArray.length; i += 3) {
        expect(posArray[i]).toBeCloseTo(0.0, 4);
      }

      // Verify all normals point straight up (+Y)
      const normArray = geo.getAttribute('normal').array;
      for (let i = 0; i < normArray.length; i += 3) {
        expect(normArray[i]).toBeCloseTo(0.0, 4);     // X
        expect(normArray[i + 1]).toBeCloseTo(1.0, 4); // Y = +1
        expect(normArray[i + 2]).toBeCloseTo(0.0, 4); // Z
      }
    });

    it('triangulates a square room correctly', () => {
      const square: Point2D[] = [
        [-2, 2],
        [2, 2],
        [2, -2],
        [-2, -2],
      ];
      const result = buildFloorGeometry(square);
      expect(result.area).toBeCloseTo(16.0, 2);
      expect(result.triangleCount).toBe(2);
    });

    it('triangulates a convex pentagonal room (5 vertices) into 3 triangles', () => {
      const pentagon: Point2D[] = [
        [-2.0, 2.0],
        [2.0, 2.0],
        [3.0, -1.0],
        [0.0, -3.0],
        [-3.0, -1.0],
      ];

      const result = buildFloorGeometry(pentagon);
      expect(result.triangleCount).toBe(3);
      expect(result.area).toBeGreaterThan(15.0);
      expect(result.diagnostics).toHaveLength(0);
      expect(result.floorGeometry.boundingBox).toBeDefined();
    });

    it('triangulates a concave L-shaped footprint (6 vertices) into 4 triangles without artifacts', () => {
      // CCW L-shape
      const lShape: Point2D[] = [
        [-2.0, 2.0],
        [2.0, 2.0],
        [2.0, 0.0],
        [0.0, 0.0],
        [0.0, -2.0],
        [-2.0, -2.0],
      ];

      const result = buildFloorGeometry(lShape);
      expect(result.triangleCount).toBe(4); // 6 vertices - 2 = 4 triangles
      expect(result.area).toBeCloseTo(12.0, 2);
      expect(result.diagnostics).toHaveLength(0);

      // Verify bounding box matches L-shape extents
      const box = result.floorGeometry.boundingBox!;
      expect(box.min.x).toBeCloseTo(-2.0, 2);
      expect(box.max.x).toBeCloseTo(2.0, 2);
      expect(box.min.z).toBeCloseTo(-2.0, 2);
      expect(box.max.z).toBeCloseTo(2.0, 2);
    });

    it('triangulates an irregular 7-sided footprint without self-intersection cleanly', () => {
      const irregular: Point2D[] = [
        [-3.0, 2.0],
        [0.0, 3.0],
        [3.0, 2.0],
        [3.5, 0.0],
        [2.0, -2.5],
        [-2.0, -2.5],
        [-3.5, 0.0],
      ];
      const result = buildFloorGeometry(irregular);
      expect(result.triangleCount).toBe(5); // 7 - 2 = 5 triangles
      expect(result.diagnostics).toHaveLength(0);
    });

    it('normalizes clockwise footprint to counter-clockwise and triangulates cleanly', () => {
      // Explicitly Clockwise rectangle
      const cwRect: Point2D[] = [
        [-2.0, -2.0],
        [0.0, -2.0],
        [0.0, 2.0],
        [-2.0, 2.0],
      ];

      const result = buildFloorGeometry(cwRect);
      expect(result.area).toBeCloseTo(8.0, 2);
      expect(result.triangleCount).toBe(2);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('generates ceiling and outline geometry matching the floor footprint', () => {
      const footprint: Point2D[] = [
        [-2, 2],
        [2, 2],
        [2, -2],
        [-2, -2],
      ];

      const result = buildFloorGeometry(footprint, 3.2);
      expect(result.ceilingGeometry).toBeDefined();
      expect(result.outlineGeometry).toBeDefined();

      // Ceiling should be at Y = 3.2
      const ceilPos = result.ceilingGeometry!.getAttribute('position').array;
      for (let i = 1; i < ceilPos.length; i += 3) {
        expect(ceilPos[i]).toBeCloseTo(3.2, 4);
      }

      // Ceiling normals should point downwards (-Y)
      const ceilNorm = result.ceilingGeometry!.getAttribute('normal').array;
      for (let i = 1; i < ceilNorm.length; i += 3) {
        expect(ceilNorm[i]).toBeCloseTo(-1.0, 4);
      }
    });

    it('rejects degenerate footprint with fewer than 3 vertices', () => {
      const degenerate: Point2D[] = [
        [0, 0],
        [1, 1],
      ];

      const result = buildFloorGeometry(degenerate);
      expect(result.triangleCount).toBe(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('Stage 6 & 7 — Composite Room Geometry Suite & Legacy Rectangular Fallback', () => {
    it('builds complete procedural geometry suite for a legacy rectangular room', () => {
      const legacyRoom = {
        width: 5.0,
        length: 4.0,
        height: 2.8,
      };

      const result = buildProceduralRoomGeometries(legacyRoom);
      expect(result.floor.triangleCount).toBe(2);
      expect(result.floor.area).toBeCloseTo(20.0, 2);
      expect(result.walls).toHaveLength(4);

      const wallIds = result.walls.map((w) => w.wallId);
      expect(wallIds).toContain('wall-south');
      expect(wallIds).toContain('wall-east');
      expect(wallIds).toContain('wall-north');
      expect(wallIds).toContain('wall-west');

      // Verify each wall has generated BufferGeometry
      for (const w of result.walls) {
        expect(w.wallGeometry.getAttribute('position').count).toBeGreaterThan(0);
      }
    });

    it('builds complete procedural geometry suite for a parametric room with doors and windows', () => {
      const parametricRoom = {
        width: 6.0,
        length: 5.0,
        height: 2.8,
        isParametric: true,
        footprint: [
          [-3.0, 2.5] as Point2D,
          [3.0, 2.5] as Point2D,
          [3.0, -2.5] as Point2D,
          [-3.0, -2.5] as Point2D,
        ],
        walls: [
          { id: 'w-south', startPoint: [-3.0, 2.5] as Point2D, endPoint: [3.0, 2.5] as Point2D, height: 2.8, thickness: 0.15 },
          { id: 'w-east',  startPoint: [3.0, 2.5] as Point2D,  endPoint: [3.0, -2.5] as Point2D, height: 2.8, thickness: 0.15 },
          { id: 'w-north', startPoint: [3.0, -2.5] as Point2D, endPoint: [-3.0, -2.5] as Point2D, height: 2.8, thickness: 0.15 },
          { id: 'w-west',  startPoint: [-3.0, -2.5] as Point2D, endPoint: [-3.0, 2.5] as Point2D, height: 2.8, thickness: 0.15 },
        ],
        openings: [
          { id: 'door-front', wallId: 'w-south', type: 'door' as const, distanceAlongWall: 2.5, width: 1.0, height: 2.1 },
          { id: 'win-garden', wallId: 'w-north', type: 'window' as const, distanceAlongWall: 1.5, width: 1.8, height: 1.2, sillHeight: 0.9 },
        ],
      };

      const result = buildProceduralRoomGeometries(parametricRoom);
      expect(result.walls).toHaveLength(4);

      // w-south has a door -> 3 solid sections
      const southResult = result.walls.find((w) => w.wallId === 'w-south')!;
      expect(southResult.solidSections).toHaveLength(3);
      expect(southResult.frameGeometry).toBeDefined();

      // w-north has a window -> 4 solid sections
      const northResult = result.walls.find((w) => w.wallId === 'w-north')!;
      expect(northResult.solidSections).toHaveLength(4);
      expect(northResult.frameGeometry).toBeDefined();

      // w-east has no openings -> 1 full section
      const eastResult = result.walls.find((w) => w.wallId === 'w-east')!;
      expect(eastResult.solidSections).toHaveLength(1);
      expect(eastResult.frameGeometry).toBeUndefined();
    });
  });
});
