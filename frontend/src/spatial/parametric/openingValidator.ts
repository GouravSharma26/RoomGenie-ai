import type { WallOpening, WallSegment } from './parametricTypes';
import { deriveWallProperties } from './roomGeometry';

export interface OpeningValidationResult {
  valid: boolean;
  errors: string[];
  validatedOpenings: WallOpening[];
}

/**
 * Validates architectural openings (doors and windows) hosted on wall segments.
 * Enforces host wall existence, boundary containment, non-overlap, and positive dimensions.
 */
export function validateWallOpenings(
  openings: unknown,
  walls: WallSegment[]
): OpeningValidationResult {
  if (!Array.isArray(openings)) {
    return { valid: true, errors: [], validatedOpenings: [] };
  }

  const errors: string[] = [];
  const validatedOpenings: WallOpening[] = [];

  const wallMap = new Map<string, WallSegment>();
  for (const w of walls) {
    wallMap.set(w.id, w);
  }

  // Track openings by wall to detect overlaps
  const openingsByWall = new Map<string, { id: string; start: number; end: number }[]>();
  const seenIds = new Set<string>();

  for (let i = 0; i < openings.length; i++) {
    const raw = openings[i];
    if (!raw || typeof raw !== 'object') {
      errors.push(`openings[${i}] must be an object.`);
      continue;
    }

    const op = raw as Partial<WallOpening>;
    const opId = typeof op.id === 'string' ? op.id.trim() : '';
    if (!opId) {
      errors.push(`openings[${i}].id must be a non-empty string.`);
      continue;
    }
    if (seenIds.has(opId)) {
      errors.push(`Duplicate opening ID detected: '${opId}'.`);
      continue;
    }
    seenIds.add(opId);

    const wallId = typeof op.wallId === 'string' ? op.wallId.trim() : '';
    if (!wallId || !wallMap.has(wallId)) {
      errors.push(`Opening '${opId}' references non-existent host wall '${wallId}'.`);
      continue;
    }

    const hostWall = wallMap.get(wallId)!;
    const derivedWall = deriveWallProperties(hostWall);

    const type = op.type === 'window' ? 'window' : 'door';
    const dist = typeof op.distanceAlongWall === 'number' && Number.isFinite(op.distanceAlongWall)
      ? op.distanceAlongWall
      : -1;
    const width = typeof op.width === 'number' && Number.isFinite(op.width) ? op.width : -1;
    const height = typeof op.height === 'number' && Number.isFinite(op.height) ? op.height : -1;
    const sillHeight = typeof op.sillHeight === 'number' && Number.isFinite(op.sillHeight)
      ? Math.max(0, op.sillHeight)
      : (type === 'door' ? 0.0 : 0.9);

    if (dist < 0) {
      errors.push(`Opening '${opId}': distanceAlongWall must be non-negative (received ${dist}).`);
      continue;
    }

    if (width <= 0) {
      errors.push(`Opening '${opId}': width must be positive (received ${width}).`);
      continue;
    }

    if (height <= 0) {
      errors.push(`Opening '${opId}': height must be positive (received ${height}).`);
      continue;
    }

    // Check wall span containment
    const opEnd = dist + width;
    if (opEnd > derivedWall.length + 1e-3) {
      errors.push(
        `Opening '${opId}' (span [${dist.toFixed(2)}m - ${opEnd.toFixed(2)}m]) exceeds host wall '${wallId}' length (${derivedWall.length.toFixed(2)}m).`
      );
      continue;
    }

    // Check vertical wall height containment
    if (sillHeight + height > derivedWall.height + 1e-3) {
      errors.push(
        `Opening '${opId}' vertical extent (${(sillHeight + height).toFixed(2)}m) exceeds wall height (${derivedWall.height.toFixed(2)}m).`
      );
      continue;
    }

    // Check overlap with existing openings on the same wall
    const existingOnWall = openingsByWall.get(wallId) || [];
    let overlaps = false;
    for (const existing of existingOnWall) {
      // Two intervals [A, B] and [C, D] overlap if max(A, C) < min(B, D)
      if (Math.max(dist, existing.start) < Math.min(opEnd, existing.end) - 1e-4) {
        errors.push(
          `Opening '${opId}' overlaps with existing opening '${existing.id}' on wall '${wallId}'.`
        );
        overlaps = true;
        break;
      }
    }

    if (overlaps) {
      continue;
    }

    existingOnWall.push({ id: opId, start: dist, end: opEnd });
    openingsByWall.set(wallId, existingOnWall);

    validatedOpenings.push({
      id: opId,
      wallId,
      type,
      distanceAlongWall: Number(dist.toFixed(4)),
      width: Number(width.toFixed(4)),
      height: Number(height.toFixed(4)),
      sillHeight: Number(sillHeight.toFixed(4)),
      swing: op.swing ?? (type === 'door' ? 'inward' : 'none'),
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    validatedOpenings,
  };
}

