import { describe, it, expect } from 'vitest';
import type { CanonicalScene } from '../../types/scene';
import { buildSpatialContext } from '../ai/spatialContextBuilder';
import { SPATIAL_CONTEXT_SCHEMA_VERSION } from '../ai/aiSpatialTypes';
import { analyzeWalkability } from '../occupancy/walkabilityManager';

describe('Phase 6.1: Spatial Context Engine', () => {
  const sampleScene: CanonicalScene = {
    schemaVersion: 1,
    unit: 'm',
    room: {
      width: 6,
      length: 5,
      height: 2.8,
      isParametric: true,
      footprint: [
        [-3, 2.5],
        [3, 2.5],
        [3, -2.5],
        [-3, -2.5],
      ],
      walls: [
        { id: 'wall-south', startPoint: [-3, 2.5], endPoint: [3, 2.5], height: 2.8, thickness: 0.15 },
        { id: 'wall-east', startPoint: [3, 2.5], endPoint: [3, -2.5], height: 2.8, thickness: 0.15 },
        { id: 'wall-north', startPoint: [3, -2.5], endPoint: [-3, -2.5], height: 2.8, thickness: 0.15 },
        { id: 'wall-west', startPoint: [-3, -2.5], endPoint: [-3, 2.5], height: 2.8, thickness: 0.15 },
      ],
      openings: [
        {
          id: 'door-south',
          wallId: 'wall-south',
          type: 'door',
          distanceAlongWall: 2.0,
          width: 0.9,
          height: 2.1,
          swing: 'inward-left',
        },
        {
          id: 'window-north',
          wallId: 'wall-north',
          type: 'window',
          distanceAlongWall: 2.0,
          width: 1.5,
          height: 1.2,
          sillHeight: 0.9,
        },
      ],
    },
    objects: [
      {
        id: 'sofa-1',
        assetId: 'sofa-modern-3seater',
        name: 'Modern 3-Seater Sofa',
        position: [0, 0.425, 0.5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: [2.1, 0.85, 0.9],
        materialOverrides: { color: '#3b82f6' },
      },
    ],
  };

  it('builds a clean, versioned spatial context schema from a canonical scene', () => {
    const context = buildSpatialContext(sampleScene);

    expect(context.schemaVersion).toBe(SPATIAL_CONTEXT_SCHEMA_VERSION);
    expect(context.room.dimensions).toEqual([6, 2.8, 5]);
    expect(context.room.areaSqm).toBe(30);
    expect(context.room.wallCount).toBe(4);
    expect(context.room.walls).toHaveLength(4);
    expect(context.room.openings).toHaveLength(2);
    expect(context.placedObjects).toHaveLength(1);
    expect(context.placedObjects[0].name).toBe('Modern 3-Seater Sofa');
    expect(context.placedObjects[0].color).toBe('#3b82f6');
  });

  it('accurately distinguishes pedestrian door portals from windows', () => {
    const context = buildSpatialContext(sampleScene);

    const doorOp = context.room.openings.find((o) => o.id === 'door-south');
    const windowOp = context.room.openings.find((o) => o.id === 'window-north');

    expect(doorOp).toBeDefined();
    expect(doorOp?.isPedestrianPortal).toBe(true);
    expect(doorOp?.accessPoint).toBeDefined();
    // Landing point is inside the room (Z < 2.5)
    expect(doorOp!.accessPoint![1]).toBeLessThan(2.5);

    expect(windowOp).toBeDefined();
    expect(windowOp?.isPedestrianPortal).toBe(false);
    expect(windowOp?.accessPoint).toBeUndefined();
  });

  it('discovers available semantic sockets on anchor furniture', () => {
    const context = buildSpatialContext(sampleScene, null, { 'sofa-modern-3seater': 'seating' });

    // The sofa exposes 'sofa-front-table', 'sofa-left-accent', 'sofa-right-accent'
    expect(context.availableSockets.length).toBeGreaterThan(0);
    const frontSocket = context.availableSockets.find((s) => s.socketId === 'sofa-front-table');
    expect(frontSocket).toBeDefined();
    expect(frontSocket?.anchorObjectId).toBe('sofa-1');
    expect(frontSocket?.allowedCategories).toContain('tables');
    expect(frontSocket?.worldPosition).toBeDefined();
  });

  it('filters out occupied sockets when active relationships exist', () => {
    const sceneWithRelationship: CanonicalScene = {
      ...sampleScene,
      objects: [
        ...sampleScene.objects,
        {
          id: 'table-1',
          assetId: 'table-coffee-wood',
          name: 'Coffee Table',
          position: [0, 0.225, 1.45],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
          dimensions: [1.2, 0.45, 0.6],
        },
      ],
      relationships: [
        {
          id: 'rel-1',
          anchorObjectId: 'sofa-1',
          childObjectId: 'table-1',
          socketId: 'sofa-front-table',
          gap: 0.5,
          relativeYaw: 0,
        },
      ],
    };

    const context = buildSpatialContext(sceneWithRelationship, null, {
      'sofa-modern-3seater': 'seating',
      'table-coffee-wood': 'tables',
    });

    const frontSocket = context.availableSockets.find((s) => s.socketId === 'sofa-front-table');
    expect(frontSocket).toBeUndefined(); // Occupied socket must be excluded

    // Side sockets should remain available
    const leftSocket = context.availableSockets.find((s) => s.socketId === 'sofa-left-accent');
    expect(leftSocket).toBeDefined();
  });

  it('integrates walkability and circulation diagnostics when provided', () => {
    const walkability = analyzeWalkability(sampleScene);
    const context = buildSpatialContext(sampleScene, walkability);

    expect(context.walkability).toBeDefined();
    expect(context.walkability?.walkabilityScore).toBeGreaterThanOrEqual(80);
    expect(context.walkability?.isRoomPassable).toBe(true);
    expect(context.walkability?.unblockedEntranceCount).toBe(1);
    expect(context.walkability?.blockedDoorIds).toHaveLength(0);
  });

  it('computes usable space metrics and free area ratio', () => {
    const context = buildSpatialContext(sampleScene);

    expect(context.usableSpace.totalAreaSqm).toBe(30);
    // Sofa footprint is 2.1 * 0.9 = 1.89 m²
    expect(context.usableSpace.occupiedAreaSqm).toBeCloseTo(1.89, 2);
    expect(context.usableSpace.freeAreaRatio).toBeGreaterThan(0.9);
  });

  it('guarantees pure JSON serializability without circular references or mesh bloat', () => {
    const context = buildSpatialContext(sampleScene);
    const serialized = JSON.stringify(context);
    expect(typeof serialized).toBe('string');

    const parsed = JSON.parse(serialized);
    expect(parsed.schemaVersion).toBe(SPATIAL_CONTEXT_SCHEMA_VERSION);
    expect(parsed.room.areaSqm).toBe(context.room.areaSqm);
  });
});
