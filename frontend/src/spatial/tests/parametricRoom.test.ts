import { describe, it, expect } from 'vitest';
import type { Point2D, WallOpening, WallSegment } from '../parametric/parametricTypes';
import {
  computePolygonArea,
  computePolygonWinding,
  ensureCounterClockwise,
  computePolygonBounds,
  detectPolygonSelfIntersection,
  validateFootprintPolygon,
  deriveWallProperties,
  createRectangularFootprint,
  createRectangularWalls,
  convertLegacyToParametric,
  getCanonicalRoomGeometry,
} from '../parametric/roomGeometry';
import { validateWallOpenings } from '../parametric/openingValidator';
import { validateRoomDimensions, parseCanonicalScene } from '../../editor3d/validation/sceneValidation';
import type { CanonicalScene } from '../../types/scene';

describe('Phase 5.1: Parametric Room Architecture & Canonical Data Model', () => {
  describe('Footprint Polygon Geometry', () => {
    it('computes exact area and bounds for a standard rectangular room', () => {
      // 5m x 4m rectangle
      const footprint = createRectangularFootprint(5.0, 4.0);
      expect(footprint.length).toBe(4);

      const area = computePolygonArea(footprint);
      expect(area).toBeCloseTo(20.0, 4);

      const bounds = computePolygonBounds(footprint);
      expect(bounds.width).toBeCloseTo(5.0, 4);
      expect(bounds.length).toBeCloseTo(4.0, 4);
      expect(bounds.minX).toBeCloseTo(-2.5, 4);
      expect(bounds.maxX).toBeCloseTo(2.5, 4);
      expect(bounds.minZ).toBeCloseTo(-2.0, 4);
      expect(bounds.maxZ).toBeCloseTo(2.0, 4);
      expect(bounds.center).toEqual([0, 0]);
    });

    it('computes exact area for an L-shaped non-rectangular room', () => {
      // L-shaped footprint composed of 6 vertices:
      // A 6m x 6m bounding box with a 3m x 3m northeast cutout
      const lShaped: Point2D[] = [
        [-3.0, 3.0],   // SW
        [3.0, 3.0],    // SE
        [3.0, 0.0],    // Mid East
        [0.0, 0.0],    // Reflex inner corner
        [0.0, -3.0],   // Mid North
        [-3.0, -3.0],  // NW
      ];

      const validation = validateFootprintPolygon(lShaped);
      expect(validation.valid).toBe(true);
      // Total area = 6x6 - 3x3 = 36 - 9 = 27 m²
      expect(validation.area).toBeCloseTo(27.0, 3);
      expect(validation.isSelfIntersecting).toBe(false);

      const bounds = computePolygonBounds(lShaped);
      expect(bounds.width).toBeCloseTo(6.0, 4);
      expect(bounds.length).toBeCloseTo(6.0, 4);
    });

    it('validates a 5-sided pentagonal room (matching architectural floor plan)', () => {
      // Irregular pentagon room footprint
      const pentagon: Point2D[] = [
        [-1.75, 2.0],  // Bottom left
        [1.75, 2.0],   // Bottom right
        [2.0, -1.0],   // Right angled wall
        [0.0, -2.5],   // Top apex
        [-2.0, -1.0],  // Left angled wall
      ];

      const validation = validateFootprintPolygon(pentagon);
      expect(validation.valid).toBe(true);
      expect(validation.vertexCount).toBe(5);
      expect(validation.area).toBeGreaterThan(5.0);
      expect(validation.isSelfIntersecting).toBe(false);
    });

    it('detects clockwise winding and normalizes to counter-clockwise', () => {
      // Explicitly clockwise rectangle: SW -> NW -> NE -> SE
      const cwFootprint: Point2D[] = [
        [-2.0, 2.0],
        [-2.0, -2.0],
        [2.0, -2.0],
        [2.0, 2.0],
      ];

      expect(computePolygonWinding(cwFootprint)).toBe('cw');

      const ccw = ensureCounterClockwise(cwFootprint);
      expect(computePolygonWinding(ccw)).toBe('ccw');
      expect(computePolygonArea(ccw)).toBeCloseTo(16.0, 4);
    });

    it('detects self-intersecting polygon (figure-8 / bowtie) and rejects it', () => {
      // Bowtie self-intersecting polygon
      const bowtie: Point2D[] = [
        [-2.0, -2.0],
        [2.0, 2.0],
        [-2.0, 2.0],
        [2.0, -2.0],
      ];

      const isSelf = detectPolygonSelfIntersection(bowtie);
      expect(isSelf).toBe(true);

      const validation = validateFootprintPolygon(bowtie);
      expect(validation.valid).toBe(false);
      expect(validation.isSelfIntersecting).toBe(true);
      expect(validation.errors.some((e) => e.includes('self-intersecting'))).toBe(true);
    });

    it('rejects footprint with near-zero length edge', () => {
      const degenerate: Point2D[] = [
        [0.0, 0.0],
        [0.01, 0.01], // 1.4cm edge (below 5cm limit)
        [4.0, 0.0],
        [4.0, 3.0],
      ];

      const validation = validateFootprintPolygon(degenerate);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Zero-length edge'))).toBe(true);
    });
  });

  describe('Wall Segment Properties & Normals', () => {
    it('computes exact length, direction, and interior normal for wall segments', () => {
      const southWall: WallSegment = {
        id: 'wall-south',
        startPoint: [-2.5, 2.0],
        endPoint: [2.5, 2.0],
        height: 3.0,
        thickness: 0.20,
      };

      const derived = deriveWallProperties(southWall);
      expect(derived.length).toBeCloseTo(5.0, 4);
      expect(derived.height).toBe(3.0);
      expect(derived.thickness).toBe(0.20);
      expect(derived.direction).toEqual([1.0, 0.0]); // East
      // In X/Z floor plane with CCW winding, left turn from East [1, 0] is North [0, -1]
      expect(derived.interiorNormal).toEqual([0.0, -1.0]);
      expect(derived.midpoint).toEqual([0.0, 2.0]);
    });

    it('computes accurate interior normals for all four canonical rectangular walls', () => {
      const walls = createRectangularWalls(6.0, 4.0, 2.8, 0.15);
      expect(walls.length).toBe(4);

      const [south, east, north, west] = walls.map((w) => deriveWallProperties(w));

      // South wall: direction East [1, 0] -> interior normal North [0, -1]
      expect(south.interiorNormal).toEqual([0.0, -1.0]);

      // East wall: direction North [0, -1] -> interior normal West [-1, 0]
      expect(east.interiorNormal).toEqual([-1.0, 0.0]);

      // North wall: direction West [-1, 0] -> interior normal South [0, 1]
      expect(north.interiorNormal).toEqual([0.0, 1.0]);

      // West wall: direction South [0, 1] -> interior normal East [1, 0]
      expect(west.interiorNormal).toEqual([1.0, 0.0]);
    });
  });

  describe('Architectural Openings Validation (Doors & Windows)', () => {
    const testWalls: WallSegment[] = createRectangularWalls(6.0, 4.0, 2.8, 0.15);

    it('accepts valid door and window on host walls', () => {
      const openings: WallOpening[] = [
        {
          id: 'main-entry-door',
          wallId: 'wall-south',
          type: 'door',
          distanceAlongWall: 2.5,
          width: 0.90,
          height: 2.10,
          sillHeight: 0.0,
          swing: 'inward',
        },
        {
          id: 'living-room-window',
          wallId: 'wall-east',
          type: 'window',
          distanceAlongWall: 1.0,
          width: 1.50,
          height: 1.20,
          sillHeight: 0.90,
        },
      ];

      const result = validateWallOpenings(openings, testWalls);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.validatedOpenings.length).toBe(2);
    });

    it('rejects opening that extends beyond the host wall length', () => {
      // East wall length is 4.0m
      const outOfBoundsOpening: WallOpening = {
        id: 'bad-door',
        wallId: 'wall-east',
        type: 'door',
        distanceAlongWall: 3.5,
        width: 1.0, // 3.5 + 1.0 = 4.5m > 4.0m
        height: 2.10,
      };

      const result = validateWallOpenings([outOfBoundsOpening], testWalls);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds host wall'))).toBe(true);
    });

    it('rejects overlapping openings on the same wall segment', () => {
      const overlapping: WallOpening[] = [
        {
          id: 'door-1',
          wallId: 'wall-south',
          type: 'door',
          distanceAlongWall: 1.0,
          width: 1.2, // Span [1.0, 2.2]
          height: 2.1,
        },
        {
          id: 'window-1',
          wallId: 'wall-south',
          type: 'window',
          distanceAlongWall: 1.8, // Span [1.8, 3.0] overlaps [1.0, 2.2]
          width: 1.2,
          height: 1.2,
        },
      ];

      const result = validateWallOpenings(overlapping, testWalls);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('overlaps with existing opening'))).toBe(true);
    });

    it('rejects opening referencing non-existent host wall ID', () => {
      const orphanOpening: WallOpening = {
        id: 'orphan-window',
        wallId: 'wall-non-existent-99',
        type: 'window',
        distanceAlongWall: 1.0,
        width: 1.0,
        height: 1.0,
      };

      const result = validateWallOpenings([orphanOpening], testWalls);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('non-existent host wall'))).toBe(true);
    });
  });

  describe('Backward Compatibility & Schema Migration', () => {
    it('converts legacy rectangular room dimensions to canonical parametric model', () => {
      const legacy = { width: 5.0, length: 4.0, height: 2.8 };
      const parametric = convertLegacyToParametric(legacy);

      expect(parametric.footprint.length).toBe(4);
      expect(parametric.walls.length).toBe(4);
      expect(parametric.height).toBe(2.8);
      expect(computePolygonArea(parametric.footprint)).toBeCloseTo(20.0, 4);

      const bounds = computePolygonBounds(parametric.footprint);
      expect(bounds.width).toBeCloseTo(5.0, 4);
      expect(bounds.length).toBeCloseTo(4.0, 4);
    });

    it('getCanonicalRoomGeometry dynamically synthesizes parametric walls for legacy scene', () => {
      const legacyRoom = { width: 7.0, length: 5.0, height: 2.9 };
      const geom = getCanonicalRoomGeometry(legacyRoom);

      expect(geom.walls.length).toBe(4);
      expect(geom.footprint.length).toBe(4);
      expect(geom.height).toBe(2.9);
      expect(geom.walls[0].id).toBe('wall-south');
    });

    it('validateRoomDimensions preserves existing dimensions while safely adopting parametric extensions', () => {
      const parametricInput = {
        width: 6.0,
        length: 6.0,
        height: 2.8,
        footprint: createRectangularFootprint(6.0, 6.0),
        walls: createRectangularWalls(6.0, 6.0, 2.8),
        isParametric: true,
      };

      const validated = validateRoomDimensions(parametricInput);
      expect(validated.width).toBe(6.0);
      expect(validated.length).toBe(6.0);
      expect(validated.height).toBe(2.8);
      expect(validated.isParametric).toBe(true);
      expect(validated.footprint?.length).toBe(4);
      expect(validated.walls?.length).toBe(4);
    });

    it('validateCanonicalScene roundtrips legacy and parametric payloads without data loss', () => {
      const legacyScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'sofa-1',
            assetId: 'sofa-modern-3seater',
            name: 'Sofa',
            dimensions: [2.0, 0.85, 0.9],
            position: [0, 0.425, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      };

      const serialized = JSON.stringify(legacyScene);
      const parsed = parseCanonicalScene(serialized);
      expect(parsed).not.toBeNull();
      expect(parsed!.room.width).toBe(5.0);
      expect(parsed!.room.length).toBe(4.0);
      expect(parsed!.objects.length).toBe(1);
    });
  });
});
