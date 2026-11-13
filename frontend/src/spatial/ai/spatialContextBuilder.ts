import type { CanonicalScene } from '../../types/scene';
import type { WalkabilityAnalysisResult } from '../occupancy/walkabilityTypes';
import { 
  getCanonicalRoomGeometry, 
  computePolygonArea, 
  deriveWallProperties 
} from '../parametric/roomGeometry';
import { SocketRegistry } from '../relationships/socketRegistry';
import { computeAnchorSurfacePointLocal } from '../relationships/relativeTransforms';
import { Vector3, Euler } from 'three';
import { 
  SPATIAL_CONTEXT_SCHEMA_VERSION,
  type SpatialContext,
  type SpatialWallDescriptor,
  type SpatialOpeningDescriptor,
  type SpatialObjectDescriptor,
  type AvailableSocketDescriptor,
  type SpatialWalkabilitySummary
} from './aiSpatialTypes';

const defaultSocketRegistry = new SocketRegistry();

/**
 * Deterministically constructs a compact, versioned Spatial Context representation
 * of a canonical scene for consumption by AI reasoning models.
 * 
 * Extracts room boundary geometry, wall normals, architectural openings,
 * placed furniture, available socket attachment points, and walkability metrics.
 * 
 * Pure function: does not mutate the input scene.
 */
export function buildSpatialContext(
  scene: CanonicalScene,
  walkability?: WalkabilityAnalysisResult | null,
  categoryLookup: Record<string, string> = {}
): SpatialContext {
  const canonicalRoom = getCanonicalRoomGeometry(scene.room);
  const footprint = canonicalRoom.footprint;
  const areaSqm = Number(computePolygonArea(footprint).toFixed(2));
  const walls = canonicalRoom.walls;

  // 1. Build Compact Wall Descriptors
  const wallDescriptors: SpatialWallDescriptor[] = walls.map((wall) => {
    const derived = deriveWallProperties(wall, canonicalRoom.height);
    const [nx, nz] = derived.interiorNormal;

    let cardinal: SpatialWallDescriptor['cardinalOrientation'] = 'slanted';
    if (Math.abs(nz - 1.0) < 0.1) cardinal = 'north';
    else if (Math.abs(nz + 1.0) < 0.1) cardinal = 'south';
    else if (Math.abs(nx - 1.0) < 0.1) cardinal = 'west';
    else if (Math.abs(nx + 1.0) < 0.1) cardinal = 'east';
    else if (wall.id.includes('north')) cardinal = 'north';
    else if (wall.id.includes('south')) cardinal = 'south';
    else if (wall.id.includes('east')) cardinal = 'east';
    else if (wall.id.includes('west')) cardinal = 'west';

    return {
      id: wall.id,
      startPoint: derived.startPoint,
      endPoint: derived.endPoint,
      lengthMeters: derived.length,
      cardinalOrientation: cardinal,
      interiorNormal: [nx, nz],
    };
  });

  // 2. Build Compact Architectural Opening Descriptors
  const openingDescriptors: SpatialOpeningDescriptor[] = (canonicalRoom.openings || []).map((op) => {
    const hostWall = walls.find((w) => w.id === op.wallId);
    let center: [number, number] = [0, 0];
    let accessPoint: [number, number] | undefined;

    if (hostWall) {
      const derived = deriveWallProperties(hostWall, canonicalRoom.height);
      const [x1, z1] = derived.startPoint;
      const [ux, uz] = derived.direction;
      const [nx, nz] = derived.interiorNormal;

      const midDist = op.distanceAlongWall + op.width / 2;
      const cx = Number((x1 + midDist * ux).toFixed(4));
      const cz = Number((z1 + midDist * uz).toFixed(4));
      center = [cx, cz];

      if (op.type === 'door') {
        const landingOffset = 0.60;
        accessPoint = [
          Number((cx + landingOffset * nx).toFixed(4)),
          Number((cz + landingOffset * nz).toFixed(4)),
        ];
      }
    }

    return {
      id: op.id,
      wallId: op.wallId,
      type: op.type,
      center,
      widthMeters: op.width,
      heightMeters: op.height,
      accessPoint,
      swing: op.swing,
      isPedestrianPortal: op.type === 'door',
    };
  });

  // 3. Map Placed Furniture Objects
  const relationships = scene.relationships || [];
  const anchorIds = new Set(relationships.map((r) => r.anchorObjectId));
  const connectedIds = new Set([
    ...relationships.map((r) => r.anchorObjectId),
    ...relationships.map((r) => r.childObjectId),
  ]);

  let totalOccupiedArea = 0;

  const objectDescriptors: SpatialObjectDescriptor[] = scene.objects.map((obj) => {
    const width = obj.dimensions[0] * (obj.scale?.[0] ?? 1.0);
    const depth = obj.dimensions[2] * (obj.scale?.[2] ?? 1.0);
    totalOccupiedArea += width * depth;

    const cat = categoryLookup[obj.assetId] || 'furniture';

    return {
      id: obj.id,
      assetId: obj.assetId,
      name: obj.name,
      category: cat,
      position: [...obj.position],
      rotationEuler: [...obj.rotationEuler],
      scale: [...obj.scale],
      dimensions: [...obj.dimensions],
      color: obj.materialOverrides?.color,
      isAnchor: anchorIds.has(obj.id),
      hasRelationships: connectedIds.has(obj.id),
    };
  });

  // 4. Calculate Available / Unfilled Sockets on Anchor Objects
  const occupiedSocketKeys = new Set(
    relationships.map((r) => `${r.anchorObjectId}:${r.socketId}`)
  );

  const availableSockets: AvailableSocketDescriptor[] = [];

  for (const obj of scene.objects) {
    const cat = categoryLookup[obj.assetId] || 'furniture';
    const sockets = defaultSocketRegistry.getSocketsForAsset(obj.assetId, cat);

    for (const socket of sockets) {
      const key = `${obj.id}:${socket.id}`;
      if (occupiedSocketKeys.has(key)) continue;

      // Transform local socket contact point into world space
      const localSurface = computeAnchorSurfacePointLocal(obj.dimensions, obj.scale, socket);
      const euler = new Euler(obj.rotationEuler[0], obj.rotationEuler[1], obj.rotationEuler[2], 'XYZ');
      const rotatedSurface = localSurface.clone().applyEuler(euler);
      const worldPos: [number, number, number] = [
        Number((obj.position[0] + rotatedSurface.x).toFixed(3)),
        Number((obj.position[1] + rotatedSurface.y).toFixed(3)),
        Number((obj.position[2] + rotatedSurface.z).toFixed(3)),
      ];

      // World normal facing vector
      const [nx, ny, nz] = socket.surfaceNormal;
      const normalVec = new Vector3(nx, ny, nz).applyEuler(euler);
      const facingDirection: [number, number, number] = [
        Number(normalVec.x.toFixed(3)),
        Number(normalVec.y.toFixed(3)),
        Number(normalVec.z.toFixed(3)),
      ];

      availableSockets.push({
        anchorObjectId: obj.id,
        anchorName: obj.name,
        socketId: socket.id,
        socketName: socket.name,
        worldPosition: worldPos,
        facingDirection,
        allowedCategories: [...socket.allowedCategories],
      });
    }
  }

  // 5. Walkability Summary (if available)
  let walkabilitySummary: SpatialWalkabilitySummary | undefined;
  if (walkability && walkability.circulation) {
    const circ = walkability.circulation;
    const blockedDoorIds = circ.issues
      .filter((iss) => iss.type === 'door_blocked')
      .map((iss) => iss.id);

    walkabilitySummary = {
      walkabilityScore: circ.walkabilityScore,
      isRoomPassable: circ.isRoomPassable,
      accessibleRatio: circ.accessibleRatio,
      unblockedEntranceCount: Math.max(0, (walkability.openings?.length || 0) - blockedDoorIds.length),
      blockedDoorIds,
      narrowestPassageMeters: circ.narrowestPassageMeters,
      walkableAreaRatio: circ.walkableAreaRatio,
    };
  }

  // 6. Usable Space Metrics
  const freeAreaRatio = areaSqm > 0 ? Math.max(0, Number(((areaSqm - totalOccupiedArea) / areaSqm).toFixed(2))) : 0;

  return {
    schemaVersion: SPATIAL_CONTEXT_SCHEMA_VERSION,
    room: {
      dimensions: [scene.room.width, scene.room.height, scene.room.length],
      areaSqm,
      footprint: [...footprint],
      isParametric: Boolean(scene.room.isParametric || (scene.room.footprint && scene.room.footprint.length >= 3)),
      wallCount: walls.length,
      walls: wallDescriptors,
      openings: openingDescriptors,
    },
    placedObjects: objectDescriptors,
    relationships: [...relationships],
    availableSockets,
    walkability: walkabilitySummary,
    zones: scene.zones ? [...scene.zones] : undefined,
    usableSpace: {
      totalAreaSqm: areaSqm,
      occupiedAreaSqm: Number(totalOccupiedArea.toFixed(2)),
      freeAreaRatio,
    },
  };
}
