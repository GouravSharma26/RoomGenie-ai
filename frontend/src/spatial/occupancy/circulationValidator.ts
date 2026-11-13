import type { CanonicalScene, FurniturePlacement } from '../../types/scene';
import { cellIndex, gridToWorldCenter, worldToGrid } from './gridCoordinates';
import { findPath } from './pathfinder';
import type {
  CirculationIssue,
  CirculationReport,
  NavigationPath,
  RoomOpening,
  WalkabilityCostGrid,
} from './walkabilityTypes';

/**
 * Validates circulation, flow, doorway access, and bottlenecks across a room scene.
 */
export function validateCirculation(
  scene: CanonicalScene,
  costGrid: WalkabilityCostGrid,
  openings: RoomOpening[],
  categoryLookup: Record<string, string> = {}
): CirculationReport {
  void categoryLookup;
  const { dimensions, config, classifications, cellFurnitureIds } = costGrid;
  const issues: CirculationIssue[] = [];
  const routes: Record<string, NavigationPath> = {};

  const furnitureMap = new Map<string, FurniturePlacement>(
    scene.objects.map((o) => [o.id, o])
  );

  // Set of exempt pairs (connected via semantic relationships)
  const connectedPairs = new Set<string>();
  for (const rel of scene.relationships || []) {
    connectedPairs.add(`${rel.anchorObjectId}:${rel.childObjectId}`);
    connectedPairs.add(`${rel.childObjectId}:${rel.anchorObjectId}`);
  }

  // 1. Doorway / Entrance Clearance Validation
  const primaryOpening = openings[0];
  const primaryEntrancePoint: [number, number] = primaryOpening
    ? primaryOpening.accessPoint
    : [0, scene.room.length / 2 - 0.5];

  for (const door of openings) {
    const halfWidth = door.width / 2;
    const depth = door.clearanceDepth;
    const [doorX, doorZ] = door.center;
    const [accX, accZ] = door.accessPoint;

    // Vector pointing inwards from door center towards interior landing
    const vx = accX - doorX;
    const vz = accZ - doorZ;
    const vLen = Math.hypot(vx, vz);
    const nx = vLen > 1e-4 ? vx / vLen : (door.wall === 'north' ? 1 : door.wall === 'south' ? -1 : 0);
    const nz = vLen > 1e-4 ? vz / vLen : (door.wall === 'south' ? -1 : door.wall === 'north' ? 1 : 0);
    const ux = -nz;
    const uz = nx;

    // 4 corners of door swing & pedestrian passage corridor
    const p1x = doorX - halfWidth * ux;
    const p1z = doorZ - halfWidth * uz;
    const p2x = doorX + halfWidth * ux;
    const p2z = doorZ + halfWidth * uz;
    const p3x = p2x + depth * nx;
    const p3z = p2z + depth * nz;
    const p4x = p1x + depth * nx;
    const p4z = p1z + depth * nz;

    const minX = Math.min(p1x, p2x, p3x, p4x);
    const maxX = Math.max(p1x, p2x, p3x, p4x);
    const minZ = Math.min(p1z, p2z, p3z, p4z);
    const maxZ = Math.max(p1z, p2z, p3z, p4z);

    const minC = worldToGrid(minX, minZ, dimensions);
    const maxC = worldToGrid(maxX, maxZ, dimensions);

    if (minC && maxC) {
      const blockingObjIds = new Set<string>();

      for (let r = Math.min(minC.row, maxC.row); r <= Math.max(minC.row, maxC.row); r++) {
        for (let c = Math.min(minC.col, maxC.col); c <= Math.max(minC.col, maxC.col); c++) {
          const idx = cellIndex(c, r, dimensions.numCols);
          if (idx < 0 || idx >= dimensions.totalCells) continue;

          if (classifications[idx] === 'blocked') {
            for (const fId of cellFurnitureIds[idx]) {
              blockingObjIds.add(fId);
            }
          }
        }
      }

      for (const fId of blockingObjIds) {
        const obj = furnitureMap.get(fId);
        const name = obj ? obj.name : 'Furniture';
        issues.push({
          id: `door-blocked-${door.id}-${fId}`,
          type: 'door_blocked',
          severity: 'error',
          title: `${name} blocks doorway swing`,
          description: `"${name}" is positioned inside the entrance swing corridor. Move it clear of the door to allow safe entry and egress.`,
          affectedFurnitureIds: [fId],
          location: door.accessPoint,
          recommendation: `Reposition "${name}" at least ${door.width.toFixed(1)}m away from the doorway.`,
        });
      }
    }
  }

  // 2. Navigation Routes & Reachability from Entrance to each Furniture Item
  let accessibleCount = 0;

  for (const obj of scene.objects) {
    const targetCenter: [number, number] = [obj.position[0], obj.position[2]];
    const path = findPath(primaryEntrancePoint, targetCenter, costGrid, {
      allowRestricted: true,
      smoothPath: true,
    });

    routes[obj.id] = path;

    if (!path.found) {
      issues.push({
        id: `unreachable-${obj.id}`,
        type: 'furniture_unreachable',
        severity: 'error',
        title: `${obj.name} is unreachable`,
        description: `No walkable passage connects the entrance to "${obj.name}". It is boxed in by other furniture or walls.`,
        affectedFurnitureIds: [obj.id],
        location: targetCenter,
        recommendation: `Provide at least a ${(config.minCorridorWidth * 100).toFixed(0)}cm walkway to "${obj.name}".`,
      });
    } else {
      accessibleCount++;

      // Check if path traverses OTHER objects' restricted zones
      const crossesOtherRestricted = path.gridPath.some((coord) => {
        const idx = cellIndex(coord.col, coord.row, dimensions.numCols);
        if (classifications[idx] !== 'restricted') return false;
        const ids = cellFurnitureIds[idx];
        return ids.length > 0 && ids.some((fId) => fId !== obj.id);
      });

      if (crossesOtherRestricted) {
        issues.push({
          id: `restricted-access-${obj.id}`,
          type: 'narrow_passage',
          severity: 'warning',
          title: `Tight access to ${obj.name}`,
          description: `Access to "${obj.name}" passes through another item's operational clearance zone.`,
          affectedFurnitureIds: [obj.id],
          location: targetCenter,
          recommendation: `Widen circulation path to "${obj.name}" to avoid stepping into other furniture zones.`,
        });
      }
    }
  }

  // 3. Bottleneck and Narrow Passage Detection between Distinct Furniture Items
  let narrowestPassage = Infinity;
  const flaggedBottleneckPairs = new Set<string>();

  for (let i = 0; i < scene.objects.length; i++) {
    for (let j = i + 1; j < scene.objects.length; j++) {
      const objA = scene.objects[i];
      const objB = scene.objects[j];
      const pairKey = [objA.id, objB.id].sort().join(':');

      if (connectedPairs.has(pairKey)) continue;

      const halfWA = (objA.dimensions[0] * (objA.scale?.[0] ?? 1)) / 2;
      const halfLA = (objA.dimensions[2] * (objA.scale?.[2] ?? 1)) / 2;
      const halfWB = (objB.dimensions[0] * (objB.scale?.[0] ?? 1)) / 2;
      const halfLB = (objB.dimensions[2] * (objB.scale?.[2] ?? 1)) / 2;

      const gapX = Math.max(0, Math.abs(objA.position[0] - objB.position[0]) - (halfWA + halfWB));
      const gapZ = Math.max(0, Math.abs(objA.position[2] - objB.position[2]) - (halfLA + halfLB));
      const gap = Math.hypot(gapX, gapZ);

      if (gap < narrowestPassage && gap > 0) {
        narrowestPassage = gap;
      }

      // If gap is between 0.05m and criticalCorridorWidth (e.g. 50cm), it's a tight squeeze bottleneck
      if (gap > 0.05 && gap < config.criticalCorridorWidth && !flaggedBottleneckPairs.has(pairKey)) {
        flaggedBottleneckPairs.add(pairKey);
        issues.push({
          id: `bottleneck-${pairKey}`,
          type: 'narrow_passage',
          severity: 'error',
          title: `Critical bottleneck between ${objA.name} and ${objB.name}`,
          description: `Passage width is only ${(gap * 100).toFixed(0)}cm (minimum recommended is ${(config.minCorridorWidth * 100).toFixed(0)}cm).`,
          affectedFurnitureIds: [objA.id, objB.id],
          location: [
            (objA.position[0] + objB.position[0]) / 2,
            (objA.position[2] + objB.position[2]) / 2,
          ],
          recommendation: `Increase corridor spacing to at least ${(config.minCorridorWidth * 100).toFixed(0)}cm for comfortable passage.`,
        });
      }
    }
  }

  // 4. Functional Clearance Clashes between distinct furniture items
  const reportedClashPairs = new Set<string>();
  const totalCells = dimensions.numCols * dimensions.numRows;

  for (let i = 0; i < totalCells; i++) {
    if (classifications[i] !== 'restricted') continue;

    const ids = cellFurnitureIds[i];
    if (ids.length >= 2) {
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const idA = ids[a];
          const idB = ids[b];
          if (connectedPairs.has(`${idA}:${idB}`)) continue;

          const pairKey = [idA, idB].sort().join(':');
          if (!reportedClashPairs.has(pairKey)) {
            reportedClashPairs.add(pairKey);
            const objA = furnitureMap.get(idA);
            const objB = furnitureMap.get(idB);
            const nameA = objA ? objA.name : 'Item 1';
            const nameB = objB ? objB.name : 'Item 2';

            const col = i % dimensions.numCols;
            const row = Math.floor(i / dimensions.numCols);
            const loc = gridToWorldCenter(col, row, dimensions);

            issues.push({
              id: `clash-${pairKey}`,
              type: 'clearance_clash',
              severity: 'warning',
              title: `Clearance clash: ${nameA} & ${nameB}`,
              description: `Functional operational clearances for "${nameA}" and "${nameB}" overlap. Pullout drawers or seating may collide.`,
              affectedFurnitureIds: [idA, idB],
              location: loc,
              recommendation: `Separate "${nameA}" and "${nameB}" to preserve independent clearance zones.`,
            });
          }
        }
      }
    }
  }

  // 5. Compute Floor Coverage Ratios
  let freeCount = 0;
  let totalInBoundsCount = 0;

  for (let i = 0; i < totalCells; i++) {
    if (classifications[i] !== 'out_of_bounds') {
      totalInBoundsCount++;
      if (classifications[i] === 'free' || classifications[i] === 'restricted') {
        freeCount++;
      }
    }
  }

  const walkableAreaRatio = totalInBoundsCount > 0 ? freeCount / totalInBoundsCount : 0;
  const accessibleRatio = scene.objects.length > 0 ? accessibleCount / scene.objects.length : 1.0;

  // 6. Holistic Flow Score (0 to 100)
  let score = 100;

  for (const issue of issues) {
    if (issue.severity === 'error') {
      if (issue.type === 'door_blocked') score -= 30;
      else if (issue.type === 'furniture_unreachable') score -= 20;
      else score -= 15;
    } else if (issue.severity === 'warning') {
      if (issue.type === 'clearance_clash') score -= 8;
      else score -= 5;
    }
  }

  if (accessibleRatio < 1.0) {
    score -= (1.0 - accessibleRatio) * 30;
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const isRoomPassable = !issues.some((iss) => iss.type === 'door_blocked') && accessibleRatio >= 0.75;

  return {
    walkabilityScore: finalScore,
    accessibleRatio: Number(accessibleRatio.toFixed(2)),
    accessibleFurnitureCount: accessibleCount,
    totalFurnitureCount: scene.objects.length,
    isRoomPassable,
    issues,
    routes,
    narrowestPassageMeters: Number((narrowestPassage === Infinity ? 0 : narrowestPassage).toFixed(2)),
    walkableAreaRatio: Number(walkableAreaRatio.toFixed(2)),
  };
}
