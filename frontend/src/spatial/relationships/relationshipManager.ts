import type { 
  CanonicalScene, 
  FurniturePlacement, 
  Vector3Tuple, 
  SemanticRelationship 
} from '../../types/scene';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import { defaultSocketRegistry } from './socketRegistry';
import { computeChildTransformFromSocket } from './relativeTransforms';
import type { 
  SocketCandidate, 
  AttachmentResult, 
  GapUpdateResult, 
  GroupTransformResult 
} from './relationshipTypes';
import { validateRoomBoundaries } from '../constraints/boundaryValidator';
import { detectCollisions } from '../constraints/collisionDetector';
import { validateClearanceDetails } from '../constraints/clearanceValidator';
import type { ClearanceOptions } from '../core/spatialTypes';

const DEFAULT_CATEGORY_LOOKUP: Record<string, string> = Object.fromEntries(
  SAMPLE_CATALOG.map((item) => [item.id, item.category])
);

const DEFAULT_TAG_LOOKUP: Record<string, string[]> = Object.fromEntries(
  SAMPLE_CATALOG.map((item) => [item.id, item.styleTags || []])
);

export interface RelationshipManagerOptions {
  gap?: number;
  relativeYaw?: number;
  categoryLookup?: Record<string, string>;
  tagLookup?: Record<string, string[]>;
  searchRadius?: number;
}

/**
 * Returns all direct child relationships attached to an anchor.
 */
export function getDirectChildren(
  scene: CanonicalScene,
  anchorObjectId: string
): SemanticRelationship[] {
  if (!scene.relationships) return [];
  return scene.relationships.filter((rel) => rel.anchorObjectId === anchorObjectId);
}

/**
 * Returns the parent relationship for a child, if any exists.
 */
export function getParentRelationship(
  scene: CanonicalScene,
  childObjectId: string
): SemanticRelationship | undefined {
  if (!scene.relationships) return undefined;
  return scene.relationships.find((rel) => rel.childObjectId === childObjectId);
}

/**
 * Checks whether `potentialDescendantId` is a descendant of `ancestorId`
 * in the scene's relationship tree. Used for cycle prevention.
 */
export function isDescendantOf(
  scene: CanonicalScene,
  potentialDescendantId: string,
  ancestorId: string
): boolean {
  if (potentialDescendantId === ancestorId) return true;
  const directChildren = getDirectChildren(scene, ancestorId);
  for (const childRel of directChildren) {
    if (childRel.childObjectId === potentialDescendantId) return true;
    if (isDescendantOf(scene, potentialDescendantId, childRel.childObjectId)) {
      return true;
    }
  }
  return false;
}

/**
 * Collects all descendant object IDs for a given root object (transitive closure).
 */
export function getAllDescendantIds(
  scene: CanonicalScene,
  rootObjectId: string
): string[] {
  const descendants: string[] = [];
  const queue = [rootObjectId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const directChildren = getDirectChildren(scene, current);
    for (const child of directChildren) {
      descendants.push(child.childObjectId);
      queue.push(child.childObjectId);
    }
  }

  return descendants;
}

/**
 * Attaches a child furniture item to an anchor socket with full spatial validation.
 */
export function attachSocket(
  scene: CanonicalScene,
  anchorObjectId: string,
  socketId: string,
  childObjectId: string,
  options: RelationshipManagerOptions = {}
): AttachmentResult {
  // 1. Validate entities exist and are distinct
  if (anchorObjectId === childObjectId) {
    return {
      success: false,
      error: 'An item cannot attach to itself.',
      updatedScene: scene,
    };
  }

  const anchor = scene.objects.find((f) => f.id === anchorObjectId);
  if (!anchor) {
    return {
      success: false,
      error: `Anchor item "${anchorObjectId}" not found in scene.`,
      updatedScene: scene,
    };
  }

  const child = scene.objects.find((f) => f.id === childObjectId);
  if (!child) {
    return {
      success: false,
      error: `Child item "${childObjectId}" not found in scene.`,
      updatedScene: scene,
    };
  }

  // 2. Cycle prevention
  if (isDescendantOf(scene, anchorObjectId, childObjectId)) {
    return {
      success: false,
      error: `Cycle detected: "${anchor.name}" is already a child/descendant of "${child.name}".`,
      updatedScene: scene,
    };
  }

  // 3. Socket existence & compatibility
  const socket = defaultSocketRegistry.getSocketDefinition(anchor.assetId, socketId);
  if (!socket) {
    return {
      success: false,
      error: `Socket "${socketId}" is not defined on anchor "${anchor.name}" (${anchor.assetId}).`,
      updatedScene: scene,
    };
  }

  const categoryLookup = options.categoryLookup || DEFAULT_CATEGORY_LOOKUP;
  const tagLookup = options.tagLookup || DEFAULT_TAG_LOOKUP;

  const childCategory = categoryLookup[child.assetId] || 'decor';
  const childTags = tagLookup[child.assetId] || [];

  if (!defaultSocketRegistry.isCompatibleWithSocket(socket, childCategory, childTags)) {
    return {
      success: false,
      error: `Item "${child.name}" is not compatible with socket "${socket.name}".`,
      updatedScene: scene,
    };
  }

  // 4. Socket exclusivity: check if socket is already occupied by a DIFFERENT child
  const existingRels = scene.relationships || [];
  const existingOccupant = existingRels.find(
    (r) => r.anchorObjectId === anchorObjectId && r.socketId === socketId && r.childObjectId !== childObjectId
  );
  if (existingOccupant) {
    return {
      success: false,
      error: `Socket "${socket.name}" is already occupied by another item.`,
      updatedScene: scene,
    };
  }

  // 5. Gap clamping
  const targetGap = options.gap !== undefined
    ? Math.min(Math.max(options.gap, socket.minGap), socket.maxGap)
    : socket.recommendedGap;

  // 6. Compute child transform
  const transform = computeChildTransformFromSocket(
    anchor,
    child,
    socket,
    targetGap,
    options.relativeYaw
  );

  const updatedChild: FurniturePlacement = {
    ...child,
    position: transform.position,
    rotationEuler: transform.rotationEuler,
  };

  // 7. Constraint validation
  const violations: string[] = [];

  // 7a. Room boundary check
  const boundaryViolations = validateRoomBoundaries(updatedChild, scene.room);
  if (boundaryViolations.length > 0) {
    violations.push(`Breaches room boundaries: ${boundaryViolations.join(', ')}`);
  }

  // 7b. Collision check with other items (except self)
  const otherPlacements = scene.objects
    .filter((f) => f.id !== childObjectId)
    .map((f) => (f.id === anchorObjectId ? anchor : f));

  const collisions = detectCollisions(updatedChild, otherPlacements);
  if (collisions.length > 0) {
    violations.push(`Collides with other furniture: ${collisions.join(', ')}`);
  }

  // 7c. Clearance check with non-anchor items
  const clearanceOpts: ClearanceOptions = {
    exemptObjectIds: new Set([anchorObjectId]),
    enforceHardClearance: true,
  };
  const clearanceResult = validateClearanceDetails(
    updatedChild,
    otherPlacements,
    categoryLookup,
    clearanceOpts
  );
  if (clearanceResult.hardViolations.length > 0) {
    violations.push(...clearanceResult.hardViolations);
  }

  if (violations.length > 0) {
    return {
      success: false,
      error: 'Placement violates room constraints.',
      violations,
      updatedScene: scene,
    };
  }

  // 8. Build relationship record
  const newRelationship: SemanticRelationship = {
    id: `rel-${anchorObjectId}-${socketId}-${childObjectId}`,
    anchorObjectId,
    childObjectId,
    socketId,
    gap: targetGap,
    relativeYaw: options.relativeYaw ?? 0,
    createdAt: Date.now(),
  };

  // 9. Update scene
  const updatedObjects = scene.objects.map((f) =>
    f.id === childObjectId ? updatedChild : f
  );

  // Remove any previous relationship the child had (enforce 1 anchor parent)
  const updatedRelationships = existingRels
    .filter((r) => r.childObjectId !== childObjectId)
    .concat(newRelationship);

  const updatedScene: CanonicalScene = {
    ...scene,
    objects: updatedObjects,
    relationships: updatedRelationships,
  };

  return {
    success: true,
    relationship: newRelationship,
    childPlacement: updatedChild,
    updatedScene,
  };
}

/**
 * Detaches a child from its socket, keeping its current world transform intact.
 */
export function detachSocket(
  scene: CanonicalScene,
  childObjectId: string
): CanonicalScene {
  if (!scene.relationships || scene.relationships.length === 0) {
    return scene;
  }

  const updatedRelationships = scene.relationships.filter(
    (rel) => rel.childObjectId !== childObjectId
  );

  return {
    ...scene,
    relationships: updatedRelationships,
  };
}

/**
 * Detaches all children attached to a given anchor item.
 */
export function detachAllChildren(
  scene: CanonicalScene,
  anchorObjectId: string
): CanonicalScene {
  if (!scene.relationships || scene.relationships.length === 0) {
    return scene;
  }

  const updatedRelationships = scene.relationships.filter(
    (rel) => rel.anchorObjectId !== anchorObjectId
  );

  return {
    ...scene,
    relationships: updatedRelationships,
  };
}

/**
 * Adjusts the separation gap of an existing socket relationship.
 */
export function updateRelationshipGap(
  scene: CanonicalScene,
  childObjectId: string,
  newGap: number,
  options: RelationshipManagerOptions = {}
): GapUpdateResult {
  const rel = getParentRelationship(scene, childObjectId);
  if (!rel) {
    return {
      success: false,
      newGap,
      error: `Item "${childObjectId}" is not attached to any socket.`,
      updatedScene: scene,
    };
  }

  const anchor = scene.objects.find((f) => f.id === rel.anchorObjectId);
  const child = scene.objects.find((f) => f.id === childObjectId);
  if (!anchor || !child) {
    return {
      success: false,
      newGap,
      error: 'Anchor or child missing from scene.',
      updatedScene: scene,
    };
  }

  const socket = defaultSocketRegistry.getSocketDefinition(anchor.assetId, rel.socketId);
  if (!socket) {
    return {
      success: false,
      newGap,
      error: `Socket definition "${rel.socketId}" not found.`,
      updatedScene: scene,
    };
  }

  const categoryLookup = options.categoryLookup || DEFAULT_CATEGORY_LOOKUP;

  // Clamp gap within socket limits
  const clampedGap = Math.min(Math.max(newGap, socket.minGap), socket.maxGap);

  // Compute new child transform
  const transform = computeChildTransformFromSocket(
    anchor,
    child,
    socket,
    clampedGap,
    rel.relativeYaw
  );

  const updatedChild: FurniturePlacement = {
    ...child,
    position: transform.position,
    rotationEuler: transform.rotationEuler,
  };

  // Validate constraints
  const violations: string[] = [];
  const boundaryViolations = validateRoomBoundaries(updatedChild, scene.room);
  if (boundaryViolations.length > 0) {
    violations.push(`Breaches room boundaries: ${boundaryViolations.join(', ')}`);
  }

  const otherPlacements = scene.objects.filter((f) => f.id !== childObjectId);
  const collisions = detectCollisions(updatedChild, otherPlacements);
  if (collisions.length > 0) {
    violations.push(`Collides with other furniture: ${collisions.join(', ')}`);
  }

  const clearanceOpts: ClearanceOptions = {
    exemptObjectIds: new Set([anchor.id]),
    enforceHardClearance: true,
  };
  const clearanceResult = validateClearanceDetails(
    updatedChild,
    otherPlacements,
    categoryLookup,
    clearanceOpts
  );
  if (clearanceResult.hardViolations.length > 0) {
    violations.push(...clearanceResult.hardViolations);
  }

  if (violations.length > 0) {
    return {
      success: false,
      newGap: clampedGap,
      error: 'Placement at requested gap violates spatial constraints.',
      violations,
      updatedScene: scene,
    };
  }

  // Apply update
  const updatedObjects = scene.objects.map((f) =>
    f.id === childObjectId ? updatedChild : f
  );

  const updatedRelationships = (scene.relationships || []).map((r) =>
    r.id === rel.id ? { ...r, gap: clampedGap } : r
  );

  const updatedScene: CanonicalScene = {
    ...scene,
    objects: updatedObjects,
    relationships: updatedRelationships,
  };

  return {
    success: true,
    newGap: clampedGap,
    childPlacement: updatedChild,
    updatedScene,
  };
}

/**
 * Searches the scene for compatible sockets near a candidate furniture item.
 * Sockets are scored and ordered by proximity.
 */
export function findCompatibleSockets(
  scene: CanonicalScene,
  candidate: FurniturePlacement,
  options: RelationshipManagerOptions = {}
): SocketCandidate[] {
  const searchRadius = options.searchRadius ?? 1.5;
  const categoryLookup = options.categoryLookup || DEFAULT_CATEGORY_LOOKUP;
  const tagLookup = options.tagLookup || DEFAULT_TAG_LOOKUP;

  const candidateCat = categoryLookup[candidate.assetId] || 'decor';
  const candidateTags = tagLookup[candidate.assetId] || [];
  const candidates: SocketCandidate[] = [];

  const existingRels = scene.relationships || [];

  for (const anchor of scene.objects) {
    if (anchor.id === candidate.id) continue;

    const availableSockets = defaultSocketRegistry.getSocketsForAsset(anchor.assetId);
    for (const socket of availableSockets) {
      // 1. Compatibility check
      if (!defaultSocketRegistry.isCompatibleWithSocket(socket, candidateCat, candidateTags)) {
        continue;
      }

      // 2. Check if occupied by another child
      const isOccupied = existingRels.some(
        (r) => r.anchorObjectId === anchor.id && r.socketId === socket.id && r.childObjectId !== candidate.id
      );
      if (isOccupied) continue;

      // 3. Compute prospective child transform at recommended gap
      const prospective = computeChildTransformFromSocket(
        anchor,
        candidate,
        socket,
        socket.recommendedGap
      );

      // 4. Calculate distance from candidate's current position to prospective socket position
      const dx = candidate.position[0] - prospective.position[0];
      const dz = candidate.position[2] - prospective.position[2];
      const distance = Math.hypot(dx, dz);

      if (distance <= searchRadius) {
        // Validate prospective placement
        const testPlacement: FurniturePlacement = {
          ...candidate,
          position: prospective.position,
          rotationEuler: prospective.rotationEuler,
        };

        const violations: string[] = [];
        const boundaryViolations = validateRoomBoundaries(testPlacement, scene.room);
        if (boundaryViolations.length > 0) {
          violations.push(`Boundary breach: ${boundaryViolations.join(', ')}`);
        }

        const otherPlacements = scene.objects.filter((f) => f.id !== candidate.id);
        const collisions = detectCollisions(testPlacement, otherPlacements);
        if (collisions.length > 0) {
          violations.push(`Collision: ${collisions.join(', ')}`);
        }

        candidates.push({
          socket,
          anchorPlacement: anchor,
          targetPlacement: testPlacement,
          targetPosition: prospective.position,
          targetRotation: prospective.rotationEuler,
          distanceToTarget: Number(distance.toFixed(3)),
          gap: socket.recommendedGap,
          valid: violations.length === 0,
          violations,
        });
      }
    }
  }

  // Sort candidates: valid first, then by smallest distance to target
  candidates.sort((a, b) => {
    if (a.valid && !b.valid) return -1;
    if (!a.valid && b.valid) return 1;
    return a.distanceToTarget - b.distanceToTarget;
  });

  return candidates;
}

/**
 * Transforms an anchor furniture item and synchronously updates all its
 * descendant children in the relationship hierarchy (atomic group transform).
 * 
 * If any member of the group violates room boundaries or collides with external
 * furniture, the entire transformation is rejected to preserve layout integrity.
 */
export function transformGroup(
  scene: CanonicalScene,
  anchorObjectId: string,
  newAnchorPosition: Vector3Tuple,
  newAnchorRotationEuler: Vector3Tuple,
  options: RelationshipManagerOptions = {}
): GroupTransformResult {
  const anchor = scene.objects.find((f) => f.id === anchorObjectId);
  if (!anchor) {
    return {
      success: false,
      updatedScene: scene,
      movedObjectIds: [],
      violations: [`Anchor "${anchorObjectId}" not found.`],
    };
  }

  const categoryLookup = options.categoryLookup || DEFAULT_CATEGORY_LOOKUP;

  // 1. Identify all objects in the group (anchor + all descendants)
  const descendantIds = getAllDescendantIds(scene, anchorObjectId);
  const groupIds = new Set([anchorObjectId, ...descendantIds]);

  // Non-group furniture obstacles that group members cannot collide with
  const externalObstacles = scene.objects.filter((f) => !groupIds.has(f.id));

  // 2. Prepare transformed placements map
  const transformedMap = new Map<string, FurniturePlacement>();

  // Anchor transformed
  const updatedAnchor: FurniturePlacement = {
    ...anchor,
    position: newAnchorPosition,
    rotationEuler: newAnchorRotationEuler,
  };
  transformedMap.set(anchorObjectId, updatedAnchor);

  // 3. Breadth-first forward kinematic transform of all descendants
  const queue = [anchorObjectId];
  const allViolations: string[] = [];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentPlacement = transformedMap.get(parentId)!;
    const directChildren = getDirectChildren(scene, parentId);

    for (const rel of directChildren) {
      const child = scene.objects.find((f) => f.id === rel.childObjectId);
      if (!child) continue;

      const socket = defaultSocketRegistry.getSocketDefinition(parentPlacement.assetId, rel.socketId);
      if (!socket) {
        allViolations.push(`Missing socket "${rel.socketId}" on parent "${parentPlacement.name}".`);
        continue;
      }

      const childTransform = computeChildTransformFromSocket(
        parentPlacement,
        child,
        socket,
        rel.gap,
        rel.relativeYaw
      );

      const updatedChild: FurniturePlacement = {
        ...child,
        position: childTransform.position,
        rotationEuler: childTransform.rotationEuler,
      };

      transformedMap.set(child.id, updatedChild);
      queue.push(child.id);
    }
  }

  // 4. Validate all group members against boundaries and external obstacles
  for (const [, placement] of transformedMap.entries()) {
    // 4a. Boundary validation
    const bounds = validateRoomBoundaries(placement, scene.room);
    if (bounds.length > 0) {
      allViolations.push(
        `Group member "${placement.name}" breaches room boundaries: ${bounds.join(', ')}`
      );
    }

    // 4b. External collision validation
    const collisions = detectCollisions(placement, externalObstacles);
    if (collisions.length > 0) {
      allViolations.push(
        `Group member "${placement.name}" collides with external furniture: ${collisions.join(', ')}`
      );
    }

    // 4c. Clearance against external obstacles
    const clearanceOpts: ClearanceOptions = {
      enforceHardClearance: true,
    };
    const clearance = validateClearanceDetails(
      placement,
      externalObstacles,
      categoryLookup,
      clearanceOpts
    );
    if (clearance.hardViolations.length > 0) {
      allViolations.push(...clearance.hardViolations);
    }
  }

  if (allViolations.length > 0) {
    return {
      success: false,
      updatedScene: scene,
      movedObjectIds: [],
      violations: allViolations,
    };
  }

  // 5. Commit atomic group update
  const updatedObjects = scene.objects.map((f) =>
    transformedMap.get(f.id) || f
  );

  const updatedScene: CanonicalScene = {
    ...scene,
    objects: updatedObjects,
  };

  return {
    success: true,
    updatedScene,
    movedObjectIds: Array.from(groupIds),
    violations: [],
  };
}

/**
 * Validates active relationships in the scene and purges any broken, orphaned,
 * or incompatible relationships (e.g. after furniture deletion).
 */
export function purgeInvalidRelationships(
  scene: CanonicalScene
): { scene: CanonicalScene; purgedCount: number; purgedIds: string[] } {
  if (!scene.relationships || scene.relationships.length === 0) {
    return { scene, purgedCount: 0, purgedIds: [] };
  }

  const furnitureMap = new Map<string, FurniturePlacement>(scene.objects.map((f) => [f.id, f]));
  const purgedIds: string[] = [];

  const healthyRelationships = scene.relationships.filter((rel) => {
    // 1. Both anchor and child must exist
    const anchor = furnitureMap.get(rel.anchorObjectId);
    const child = furnitureMap.get(rel.childObjectId);
    if (!anchor || !child) {
      purgedIds.push(rel.id);
      return false;
    }

    // 2. Socket must exist on anchor
    const socket = defaultSocketRegistry.getSocketDefinition(anchor.assetId, rel.socketId);
    if (!socket) {
      purgedIds.push(rel.id);
      return false;
    }

    return true;
  });

  return {
    scene: {
      ...scene,
      relationships: healthyRelationships,
    },
    purgedCount: purgedIds.length,
    purgedIds,
  };
}
