import { Euler, Matrix4, Vector3 } from 'three';
import type { FurniturePlacement, Vector3Tuple } from '../../types/scene';
import { sanitizeCoordinate, sanitizeDimension, computeGroundedY } from '../core/coordinateSystem';
import type { 
  ChildTransformResult, 
  SpatialSocketDefinition 
} from './relationshipTypes';

/**
 * Computes the normalized angle in radians between -PI and +PI.
 */
export function normalizeAngle(rad: number): number {
  let angle = rad % (Math.PI * 2);
  if (angle > Math.PI) angle -= Math.PI * 2;
  if (angle < -Math.PI) angle += Math.PI * 2;
  return Number(angle.toFixed(4));
}

/**
 * Calculates the local surface anchor point on the host furniture item.
 * Uses dynamic half-extents of the anchor: (dimensions * scale) / 2.
 */
export function computeAnchorSurfacePointLocal(
  anchorDims: Vector3Tuple,
  anchorScale: Vector3Tuple,
  socket: SpatialSocketDefinition
): Vector3 {
  const halfX = (sanitizeDimension(anchorDims[0]) * sanitizeDimension(anchorScale[0], 1.0)) / 2;
  const halfZ = (sanitizeDimension(anchorDims[2]) * sanitizeDimension(anchorScale[2], 1.0)) / 2;

  const [nx, , nz] = socket.surfaceNormal;
  const latRatio = sanitizeCoordinate(socket.lateralRatio, 0);

  // Surface point along the face normal
  let px = nx * halfX;
  let pz = nz * halfZ;

  // Tangent vector for lateral displacement along the surface face
  // If normal is along Z (+Z/-Z), tangent is along X (+X)
  // If normal is along X (+X/-X), tangent is along Z (+Z)
  if (Math.abs(nz) > 0.5) {
    px += latRatio * halfX;
  } else if (Math.abs(nx) > 0.5) {
    pz += latRatio * halfZ;
  }

  return new Vector3(px, 0, pz);
}

/**
 * Computes the facing orientation of the child item in radians based on socket mode.
 */
export function computeChildYaw(
  anchorYaw: number,
  socket: SpatialSocketDefinition,
  relativeYaw: number = 0
): number {
  const [nx, , nz] = socket.surfaceNormal;
  const outwardAngle = Math.atan2(nx, nz);

  let modeOffset = 0;
  switch (socket.facingMode) {
    case 'same-direction':
      modeOffset = 0;
      break;
    case 'face-anchor':
      // Turn 180 degrees from outward socket angle to face directly back at anchor
      modeOffset = outwardAngle + Math.PI;
      break;
    case 'perpendicular-left':
      modeOffset = Math.PI / 2;
      break;
    case 'perpendicular-right':
      modeOffset = -Math.PI / 2;
      break;
    case 'free':
      modeOffset = 0;
      break;
  }

  const baseYaw = sanitizeCoordinate(socket.baseRelativeYaw, 0);
  const totalYaw = anchorYaw + modeOffset + baseYaw + relativeYaw;
  return normalizeAngle(totalYaw);
}

/**
 * Computes the half-extent of the child item along the socket's normal direction.
 * Accounts for dynamic child dimensions, scale, and its relative rotation.
 */
export function computeChildExtentAlongNormal(
  childDims: Vector3Tuple,
  childScale: Vector3Tuple,
  deltaYaw: number,
  surfaceNormal: Vector3Tuple
): number {
  const halfX = (sanitizeDimension(childDims[0]) * sanitizeDimension(childScale[0], 1.0)) / 2;
  const halfZ = (sanitizeDimension(childDims[2]) * sanitizeDimension(childScale[2], 1.0)) / 2;

  const cosY = Math.abs(Math.cos(deltaYaw));
  const sinY = Math.abs(Math.sin(deltaYaw));

  const [, , nz] = surfaceNormal;

  // Projection of child's oriented bounding box onto the normal axis in local space
  if (Math.abs(nz) > 0.5) {
    // Normal is primarily along local Z
    return Number((sinY * halfX + cosY * halfZ).toFixed(4));
  } else {
    // Normal is primarily along local X
    return Number((cosY * halfX + sinY * halfZ).toFixed(4));
  }
}

/**
 * Deterministically computes the world transform (position and rotation) for a child
 * furniture item attached to an anchor via a spatial socket.
 *
 * Spacing Rule: The physical gap parameter `gap` is applied strictly ONCE between
 * the anchor's contact surface and the child's contact surface.
 */
export function computeChildTransformFromSocket(
  anchor: FurniturePlacement,
  childOrDims: FurniturePlacement | Vector3Tuple,
  childScaleOrSocket: Vector3Tuple | SpatialSocketDefinition,
  socketOrGap?: SpatialSocketDefinition | number,
  gapOrYaw?: number,
  optionalYaw: number = 0
): ChildTransformResult {
  let childDims: Vector3Tuple;
  let childScale: Vector3Tuple;
  let socket: SpatialSocketDefinition;
  let desiredGap: number | undefined;
  let relativeYaw: number = 0;

  if (Array.isArray(childOrDims)) {
    // Tuple signature: (anchor, childDims, childScale, socket, gap, yaw)
    childDims = childOrDims;
    childScale = (childScaleOrSocket as Vector3Tuple) || [1, 1, 1];
    socket = socketOrGap as SpatialSocketDefinition;
    desiredGap = typeof gapOrYaw === 'number' ? gapOrYaw : undefined;
    relativeYaw = optionalYaw;
  } else {
    // Placement signature: (anchor, childPlacement, socket, gap, yaw)
    childDims = childOrDims.dimensions;
    childScale = childOrDims.scale || [1, 1, 1];
    socket = childScaleOrSocket as SpatialSocketDefinition;
    desiredGap = typeof socketOrGap === 'number' ? socketOrGap : undefined;
    relativeYaw = typeof gapOrYaw === 'number' ? gapOrYaw : 0;
  }

  const anchorYaw = anchor.rotationEuler[1];
  const childYaw = computeChildYaw(anchorYaw, socket, relativeYaw);
  const deltaYaw = childYaw - anchorYaw;

  // 1. Determine effective surface gap (clamped to socket bounds if within tolerance)
  const gap = typeof desiredGap === 'number' && Number.isFinite(desiredGap)
    ? Math.max(socket.minGap, Math.min(socket.maxGap, desiredGap))
    : socket.recommendedGap;

  // 2. Anchor surface point in local space
  const localAnchorSurface = computeAnchorSurfacePointLocal(anchor.dimensions, anchor.scale, socket);

  // 3. Child extent along normal
  const childExtent = computeChildExtentAlongNormal(childDims, childScale, deltaYaw, socket.surfaceNormal);

  // 4. Child center offset in anchor local space:
  // Local child center = anchor surface point + (gap + childExtent) * normal
  const [nx, , nz] = socket.surfaceNormal;
  const totalOffsetDistance = gap + childExtent;
  const localChildCenter = new Vector3(
    localAnchorSurface.x + nx * totalOffsetDistance,
    0,
    localAnchorSurface.z + nz * totalOffsetDistance
  );

  // 5. Transform from anchor local space to world space:
  // Rotation matrix for anchor yaw
  const euler = new Euler(0, anchorYaw, 0, 'XYZ');
  const rotMat = new Matrix4().makeRotationFromEuler(euler);

  const worldChildCenter = localChildCenter.clone().applyMatrix4(rotMat);
  worldChildCenter.x += anchor.position[0];
  worldChildCenter.z += anchor.position[2];

  // Grounding height: standard floor-level Y = (height * scaleY) / 2
  worldChildCenter.y = computeGroundedY(childDims[1], childScale[1]);

  // World contact points
  const worldAnchorSurface = localAnchorSurface.clone().applyMatrix4(rotMat);
  worldAnchorSurface.x += anchor.position[0];
  worldAnchorSurface.y = worldChildCenter.y;
  worldAnchorSurface.z += anchor.position[2];

  const localChildContact = new Vector3(
    localAnchorSurface.x + nx * gap,
    0,
    localAnchorSurface.z + nz * gap
  );
  const worldChildContact = localChildContact.clone().applyMatrix4(rotMat);
  worldChildContact.x += anchor.position[0];
  worldChildContact.y = worldChildCenter.y;
  worldChildContact.z += anchor.position[2];

  return {
    position: [
      Number(worldChildCenter.x.toFixed(4)),
      Number(worldChildCenter.y.toFixed(4)),
      Number(worldChildCenter.z.toFixed(4)),
    ],
    rotationEuler: [0, childYaw, 0],
    anchorSurfacePoint: [
      Number(worldAnchorSurface.x.toFixed(4)),
      Number(worldAnchorSurface.y.toFixed(4)),
      Number(worldAnchorSurface.z.toFixed(4)),
    ],
    childContactPoint: [
      Number(worldChildContact.x.toFixed(4)),
      Number(worldChildContact.y.toFixed(4)),
      Number(worldChildContact.z.toFixed(4)),
    ],
    effectiveGap: Number(gap.toFixed(4)),
  };
}

/**
 * Inverts the socket transformation: given an anchor and child in world space,
 * computes the measured physical gap and relative yaw with respect to the socket.
 * Used for round-trip validation and detecting socket engagement during drag.
 */
export function computeSocketFromWorldTransform(
  anchor: FurniturePlacement,
  child: FurniturePlacement,
  socket: SpatialSocketDefinition
): { measuredGap: number; relativeYaw: number; isWithinTolerance: boolean } {
  const anchorYaw = anchor.rotationEuler[1];
  const childYaw = child.rotationEuler[1];

  // World vector from anchor center to child center transformed into anchor local coordinates
  const diff = new Vector3(
    child.position[0] - anchor.position[0],
    0,
    child.position[2] - anchor.position[2]
  );
  const invEuler = new Euler(0, -anchorYaw, 0, 'XYZ');
  const invRotMat = new Matrix4().makeRotationFromEuler(invEuler);
  const localChildVec = diff.applyMatrix4(invRotMat);

  const localX = localChildVec.x;
  const localZ = localChildVec.z;

  // Anchor surface point in local coordinates
  const localAnchorSurface = computeAnchorSurfacePointLocal(anchor.dimensions, anchor.scale, socket);

  // Vector from anchor surface point to child center
  const toChildX = localX - localAnchorSurface.x;
  const toChildZ = localZ - localAnchorSurface.z;

  // Project along normal
  const [nx, , nz] = socket.surfaceNormal;
  const normalProjection = toChildX * nx + toChildZ * nz;

  // Child extent along normal
  const deltaYaw = childYaw - anchorYaw;
  const childExtent = computeChildExtentAlongNormal(child.dimensions, child.scale, deltaYaw, socket.surfaceNormal);

  // Measured surface-to-surface gap
  const measuredGap = Number((normalProjection - childExtent).toFixed(4));

  // Compute expected child yaw without relative offset
  const baseChildYaw = computeChildYaw(anchorYaw, socket, 0);
  const relativeYaw = normalizeAngle(childYaw - baseChildYaw);

  const isWithinTolerance = measuredGap >= socket.minGap - 0.05 && measuredGap <= socket.maxGap + 0.10;

  return {
    measuredGap,
    relativeYaw,
    isWithinTolerance,
  };
}
