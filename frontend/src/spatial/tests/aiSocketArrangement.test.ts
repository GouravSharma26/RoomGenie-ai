import { describe, it, expect } from 'vitest';
import type { CanonicalScene, FurniturePlacement } from '../../types/scene';
import { defaultSocketRegistry } from '../relationships/socketRegistry';
import { computeChildTransformFromSocket } from '../relationships/relativeTransforms';
import { attachSocket, isDescendantOf } from '../relationships/relationshipManager';

describe('Phase 6.2 — AI Semantic Socket Attachment & Zone Layouts', () => {
  const baseRoom = {
    width: 6.0,
    length: 5.0,
    height: 2.8,
  };

  const sampleSofa: FurniturePlacement = {
    id: 'sofa-main-1',
    assetId: 'sofa-modern-3seater',
    name: 'Modern 3-Seater Sofa',
    dimensions: [2.10, 0.85, 0.90],
    position: [0.0, 0.425, -0.5],
    rotationEuler: [0.0, 0.0, 0.0],
    scale: [1.0, 1.0, 1.0],
  };

  const sampleCoffeeTable: FurniturePlacement = {
    id: 'table-coffee-1',
    assetId: 'table-oak-coffee',
    name: 'Minimalist Coffee Table',
    dimensions: [1.10, 0.45, 0.60],
    position: [0.0, 0.225, 0.8],
    rotationEuler: [0.0, 0.0, 0.0],
    scale: [1.0, 1.0, 1.0],
  };

  const sampleArmchair: FurniturePlacement = {
    id: 'chair-left-1',
    assetId: 'chair-accent-armchair',
    name: 'Accent Armchair',
    dimensions: [0.85, 0.88, 0.85],
    position: [-1.5, 0.44, 0.0],
    rotationEuler: [0.0, 0.0, 0.0],
    scale: [1.0, 1.0, 1.0],
  };

  const sampleBed: FurniturePlacement = {
    id: 'bed-main-1',
    assetId: 'bed-queen-platform',
    name: 'Nordic Queen Platform Bed',
    dimensions: [1.60, 0.95, 2.10],
    position: [0.0, 0.475, -0.8],
    rotationEuler: [0.0, 0.0, 0.0],
    scale: [1.0, 1.0, 1.0],
  };

  const sampleNightstand: FurniturePlacement = {
    id: 'nightstand-left-1',
    assetId: 'table-bedside-nightstand',
    name: 'Bedside Nightstand',
    dimensions: [0.50, 0.50, 0.40],
    position: [-1.2, 0.25, -0.8],
    rotationEuler: [0.0, 0.0, 0.0],
    scale: [1.0, 1.0, 1.0],
  };

  const sampleDesk: FurniturePlacement = {
    id: 'desk-main-1',
    assetId: 'desk-workspace-study',
    name: 'Ergonomic Study Desk',
    dimensions: [1.40, 0.75, 0.70],
    position: [-1.2, 0.375, -0.8],
    rotationEuler: [0.0, 0.0, 0.0],
    scale: [1.0, 1.0, 1.0],
  };

  describe('Authoritative Socket Registry & Semantics', () => {
    it('retrieves all 6 canonical socket definitions with valid limits', () => {
      const sofaSockets = defaultSocketRegistry.getSocketsForAsset('sofa-modern-3seater');
      expect(sofaSockets.length).toBe(3);
      expect(sofaSockets.map((s) => s.id)).toEqual(
        expect.arrayContaining(['sofa-front-table', 'sofa-left-accent', 'sofa-right-accent'])
      );

      const bedSockets = defaultSocketRegistry.getSocketsForAsset('bed-queen-platform');
      expect(bedSockets.length).toBe(2);
      expect(bedSockets.map((s) => s.id)).toEqual(
        expect.arrayContaining(['bed-left-nightstand', 'bed-right-nightstand'])
      );

      const deskSockets = defaultSocketRegistry.getSocketsForAsset('desk-workspace-study');
      expect(deskSockets.length).toBe(1);
      expect(deskSockets[0].id).toBe('desk-knee-well-chair');
    });

    it('validates semantic category and tag compatibility', () => {
      const sofaSocket = defaultSocketRegistry.getSocketDefinition('sofa-modern-3seater', 'sofa-front-table');
      expect(sofaSocket).toBeDefined();

      // Table is compatible
      expect(defaultSocketRegistry.isCompatibleWithSocket(sofaSocket!, 'tables', ['living-room'])).toBe(true);

      // Bed is incompatible category
      expect(defaultSocketRegistry.isCompatibleWithSocket(sofaSocket!, 'beds', ['bedroom'])).toBe(false);

      // Desk knee well accepts seating
      const deskSocket = defaultSocketRegistry.getSocketDefinition('desk-workspace-study', 'desk-knee-well-chair');
      expect(deskSocket).toBeDefined();
      expect(defaultSocketRegistry.isCompatibleWithSocket(deskSocket!, 'seating', ['workspace'])).toBe(true);
      expect(defaultSocketRegistry.isCompatibleWithSocket(deskSocket!, 'tables', ['workspace'])).toBe(false);
    });
  });

  describe('Deterministic Relative Transform Math', () => {
    it('computes exact child world position applying gap strictly once (sofa -> coffee table)', () => {
      const socket = defaultSocketRegistry.getSocketDefinition('sofa-modern-3seater', 'sofa-front-table')!;
      const transform = computeChildTransformFromSocket(
        sampleSofa,
        sampleCoffeeTable,
        socket,
        0.45
      );

      // Sofa center Z is -0.5. Front normal is +Z.
      // Half depth of sofa = 0.90 / 2 = 0.45m.
      // Gap = 0.45m.
      // Half depth of table = 0.60 / 2 = 0.30m.
      // Expected world Z = -0.5 + 0.45 + 0.45 + 0.30 = 0.70m.
      expect(transform.position[0]).toBeCloseTo(0.0, 3);
      expect(transform.position[1]).toBeCloseTo(0.225, 3); // 0.45m height / 2 (floor grounded)
      expect(transform.position[2]).toBeCloseTo(0.70, 2);
      expect(transform.effectiveGap).toBeCloseTo(0.45, 2);
    });

    it('computes angled conversation orientation for sofa accent armchair', () => {
      const leftSocket = defaultSocketRegistry.getSocketDefinition('sofa-modern-3seater', 'sofa-left-accent')!;
      const transform = computeChildTransformFromSocket(
        sampleSofa,
        sampleArmchair,
        leftSocket,
        0.50
      );

      // Left normal is -X, lateral ratio 0.35 shifts towards front (+Z)
      expect(transform.position[0]).toBeLessThan(sampleSofa.position[0]);
      // Child should face back toward the anchor with inward conversational yaw angle
      expect(transform.rotationEuler[1]).not.toBe(0);
    });

    it('computes symmetrical bedside nightstand positions', () => {
      const leftSocket = defaultSocketRegistry.getSocketDefinition('bed-queen-platform', 'bed-left-nightstand')!;
      const rightSocket = defaultSocketRegistry.getSocketDefinition('bed-queen-platform', 'bed-right-nightstand')!;

      const leftTrans = computeChildTransformFromSocket(sampleBed, sampleNightstand, leftSocket, 0.08);
      const rightTrans = computeChildTransformFromSocket(sampleBed, sampleNightstand, rightSocket, 0.08);

      // Symmetrical about X = 0
      expect(leftTrans.position[0]).toBeCloseTo(-rightTrans.position[0], 2);
      expect(leftTrans.position[2]).toBeCloseTo(rightTrans.position[2], 2);
      expect(leftTrans.position[1]).toBeCloseTo(0.25, 3);
    });

    it('computes desk knee-well chair facing anchor directly', () => {
      const deskSocket = defaultSocketRegistry.getSocketDefinition('desk-workspace-study', 'desk-knee-well-chair')!;
      const transform = computeChildTransformFromSocket(sampleDesk, sampleArmchair, deskSocket, 0.20);
      expect(transform.position[0]).toBeCloseTo(sampleDesk.position[0], 2);
      expect(transform.position[2]).toBeGreaterThan(sampleDesk.position[2]);
      expect(transform.effectiveGap).toBeCloseTo(0.20, 2);
    });

    it('clamps gap to socket permitted range [minGap, maxGap]', () => {
      const socket = defaultSocketRegistry.getSocketDefinition('sofa-modern-3seater', 'sofa-front-table')!;
      // minGap = 0.30, maxGap = 0.70
      const lowTrans = computeChildTransformFromSocket(sampleSofa, sampleCoffeeTable, socket, 0.10);
      expect(lowTrans.effectiveGap).toBeCloseTo(0.30, 2);

      const highTrans = computeChildTransformFromSocket(sampleSofa, sampleCoffeeTable, socket, 1.20);
      expect(highTrans.effectiveGap).toBeCloseTo(0.70, 2);
    });
  });

  describe('Physical Validation & Spatial Attachment Execution', () => {
    it('successfully attaches valid child and updates scene relationships', () => {
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: baseRoom,
        objects: [sampleSofa, sampleCoffeeTable],
        relationships: [],
      };

      const result = attachSocket(scene, 'sofa-main-1', 'sofa-front-table', 'table-coffee-1', { gap: 0.45 });
      expect(result.success).toBe(true);
      expect(result.updatedScene.relationships?.length).toBe(1);

      const rel = result.updatedScene.relationships![0];
      expect(rel.anchorObjectId).toBe('sofa-main-1');
      expect(rel.childObjectId).toBe('table-coffee-1');
      expect(rel.socketId).toBe('sofa-front-table');
      expect(rel.gap).toBe(0.45);
    });

    it('rejects self-attachment', () => {
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: baseRoom,
        objects: [sampleSofa],
      };

      const result = attachSocket(scene, 'sofa-main-1', 'sofa-front-table', 'sofa-main-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot attach to itself');
    });

    it('rejects circular relationship graphs', () => {
      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: baseRoom,
        objects: [sampleSofa, sampleCoffeeTable],
        relationships: [
          {
            id: 'rel-1',
            anchorObjectId: 'sofa-main-1',
            childObjectId: 'table-coffee-1',
            socketId: 'sofa-front-table',
            gap: 0.45,
            relativeYaw: 0,
          },
        ],
      };

      expect(isDescendantOf(scene, 'table-coffee-1', 'sofa-main-1')).toBe(true);

      // Attempting to attach sofa as child of table
      const cycleResult = attachSocket(scene, 'table-coffee-1', 'sofa-front-table', 'sofa-main-1');
      expect(cycleResult.success).toBe(false);
    });

    it('rejects already occupied sockets', () => {
      const table2: FurniturePlacement = {
        ...sampleCoffeeTable,
        id: 'table-coffee-2',
      };

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: baseRoom,
        objects: [sampleSofa, sampleCoffeeTable, table2],
        relationships: [
          {
            id: 'rel-1',
            anchorObjectId: 'sofa-main-1',
            childObjectId: 'table-coffee-1',
            socketId: 'sofa-front-table',
            gap: 0.45,
            relativeYaw: 0,
          },
        ],
      };

      const result = attachSocket(scene, 'sofa-main-1', 'sofa-front-table', 'table-coffee-2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already occupied');
    });

    it('rejects attachments that breach room boundaries', () => {
      // Tiny room 2.5m x 2.5m
      const tinyRoom = { width: 2.5, length: 2.5, height: 2.8 };
      const sofaNearWall: FurniturePlacement = {
        ...sampleSofa,
        position: [0.0, 0.425, 0.8], // Near +Z wall (max Z = 1.25m)
      };

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: tinyRoom,
        objects: [sofaNearWall, sampleCoffeeTable],
        relationships: [],
      };

      const result = attachSocket(scene, 'sofa-main-1', 'sofa-front-table', 'table-coffee-1', { gap: 0.45 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('violates room constraints');
      expect(result.violations?.some((v) => v.includes('boundaries'))).toBe(true);
    });

    it('rejects attachments that cause physical collision with unrelated furniture', () => {
      // Bookshelf placed right where coffee table would be positioned
      const blockingBookshelf: FurniturePlacement = {
        id: 'shelf-blocker',
        assetId: 'storage-bookshelf-tall',
        name: 'Bookshelf',
        dimensions: [0.90, 1.80, 0.35],
        position: [0.0, 0.90, 0.70],
        rotationEuler: [0.0, 0.0, 0.0],
        scale: [1.0, 1.0, 1.0],
      };

      const scene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: baseRoom,
        objects: [sampleSofa, sampleCoffeeTable, blockingBookshelf],
        relationships: [],
      };

      const result = attachSocket(scene, 'sofa-main-1', 'sofa-front-table', 'table-coffee-1', { gap: 0.45 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('violates room constraints');
      expect(result.violations?.some((v) => v.includes('Collides with other furniture'))).toBe(true);
    });
  });
});
