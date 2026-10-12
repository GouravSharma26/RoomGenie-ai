import type { RoomDimensions, Vector3Tuple, CanonicalScene, FurniturePlacement } from '../../types/scene';

export const DEFAULT_ROOM: RoomDimensions = {
  width: 5.0,  // 5 metres
  length: 4.0, // 4 metres
  height: 2.8, // 2.8 metres
};

export const MIN_ROOM_DIMENSION = 2.0;
export const MAX_ROOM_DIMENSION = 25.0;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5.0;

export const SUPPORTED_SCHEMA_VERSION = 1;
export const MIN_OBJECT_DIMENSION = 0.05;
export const MAX_OBJECT_DIMENSION = 20.0;

export function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function isFinitePositiveNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0;
}

export function sanitizeNumber(val: unknown, fallback: number): number {
  if (isFiniteNumber(val)) return val;
  return fallback;
}

export function validateRoomDimensions(room: Partial<RoomDimensions> | undefined): RoomDimensions {
  if (!room) return { ...DEFAULT_ROOM };
  
  const width = Math.min(
    Math.max(sanitizeNumber(room.width, DEFAULT_ROOM.width), MIN_ROOM_DIMENSION),
    MAX_ROOM_DIMENSION
  );
  const length = Math.min(
    Math.max(sanitizeNumber(room.length, DEFAULT_ROOM.length), MIN_ROOM_DIMENSION),
    MAX_ROOM_DIMENSION
  );
  const height = Math.min(
    Math.max(sanitizeNumber(room.height, DEFAULT_ROOM.height), MIN_ROOM_DIMENSION),
    10.0
  );

  return { width, length, height };
}

export function sanitizeVector3(vec: unknown, fallback: Vector3Tuple = [0, 0, 0]): Vector3Tuple {
  if (!Array.isArray(vec) || vec.length < 3) return fallback;
  return [
    sanitizeNumber(vec[0], fallback[0]),
    sanitizeNumber(vec[1], fallback[1]),
    sanitizeNumber(vec[2], fallback[2]),
  ];
}

export function validateScale(scale: unknown): Vector3Tuple {
  const [sx, sy, sz] = sanitizeVector3(scale, [1, 1, 1]);
  return [
    Math.min(Math.max(sx, MIN_SCALE), MAX_SCALE),
    Math.min(Math.max(sy, MIN_SCALE), MAX_SCALE),
    Math.min(Math.max(sz, MIN_SCALE), MAX_SCALE),
  ];
}

export function validateRotation(rotation: unknown): Vector3Tuple {
  const [rx, ry, rz] = sanitizeVector3(rotation, [0, 0, 0]);
  // Normalize angles to [-2PI, 2PI]
  const twoPi = Math.PI * 2;
  return [
    rx % twoPi,
    ry % twoPi,
    rz % twoPi,
  ];
}

export function clampPositionToRoom(
  position: unknown,
  dimensions: Vector3Tuple,
  room: RoomDimensions,
  scale: Vector3Tuple = [1, 1, 1]
): Vector3Tuple {
  const [rawX, , rawZ] = sanitizeVector3(position, [0, 0, 0]);
  const [objW, objH, objD] = dimensions;
  const [sX, sY, sZ] = scale;

  const effW = Math.max(objW * sX, 0.1);
  const effH = Math.max(objH * sY, 0.1);
  const effD = Math.max(objD * sZ, 0.1);

  // Room floor extends from -width/2 to +width/2 on X, -length/2 to +length/2 on Z
  const halfRoomX = room.width / 2;
  const halfRoomZ = room.length / 2;

  const minX = -halfRoomX + effW / 2;
  const maxX = halfRoomX - effW / 2;
  const minZ = -halfRoomZ + effD / 2;
  const maxZ = halfRoomZ - effD / 2;

  // If object is larger than room, center it
  const clampedX = minX > maxX ? 0 : Math.min(Math.max(rawX, minX), maxX);
  const clampedZ = minZ > maxZ ? 0 : Math.min(Math.max(rawZ, minZ), maxZ);

  // In Three.js, base of furniture is placed at Y = 0 (floor) so the center of object is at effH / 2
  const floorCenterY = effH / 2;

  return [clampedX, floorCenterY, clampedZ];
}

export function serializeCanonicalScene(scene: CanonicalScene): string {
  return JSON.stringify(scene, null, 2);
}

export function parseCanonicalScene(rawJson: string): CanonicalScene | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') return null;

    // Explicitly reject unsupported schema versions or non-matching unit
    if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return null;
    }
    if (parsed.unit !== 'm') {
      return null;
    }

    // Validate room dimensions strictly as finite positive values
    if (!parsed.room || typeof parsed.room !== 'object') return null;
    const { width: rawW, length: rawL, height: rawH } = parsed.room;
    if (!isFinitePositiveNumber(rawW) || !isFinitePositiveNumber(rawL) || !isFinitePositiveNumber(rawH)) {
      return null; // Reject negative, zero, or non-finite room dimensions
    }
    const room = validateRoomDimensions(parsed.room);

    // Validate objects array and strictly check dimensions of every object
    if (!Array.isArray(parsed.objects)) return null;

    const objects: FurniturePlacement[] = [];
    for (let i = 0; i < parsed.objects.length; i++) {
      const obj = parsed.objects[i];
      if (!obj || typeof obj !== 'object') return null;

      // Validate dimensions: must be an array of 3 finite positive numbers
      if (!Array.isArray(obj.dimensions) || obj.dimensions.length < 3) {
        return null;
      }
      const [ow, oh, od] = obj.dimensions;
      if (!isFinitePositiveNumber(ow) || !isFinitePositiveNumber(oh) || !isFinitePositiveNumber(od)) {
        return null; // Reject negative, zero, or non-finite object dimensions
      }
      const dims: Vector3Tuple = [ow, oh, od];

      const scale: Vector3Tuple = validateScale(obj.scale);
      const rotation: Vector3Tuple = validateRotation(obj.rotationEuler);
      const position: Vector3Tuple = clampPositionToRoom(obj.position, dims, room, scale);

      // Preserve all supported material overrides (color, roughness, metalness)
      let materialOverrides: FurniturePlacement['materialOverrides'] = undefined;
      if (obj.materialOverrides && typeof obj.materialOverrides === 'object') {
        const overrides: NonNullable<FurniturePlacement['materialOverrides']> = {};
        if (typeof obj.materialOverrides.color === 'string') {
          overrides.color = obj.materialOverrides.color;
        }
        if (typeof obj.materialOverrides.roughness === 'number' && Number.isFinite(obj.materialOverrides.roughness)) {
          overrides.roughness = Math.min(Math.max(obj.materialOverrides.roughness, 0), 1);
        }
        if (typeof obj.materialOverrides.metalness === 'number' && Number.isFinite(obj.materialOverrides.metalness)) {
          overrides.metalness = Math.min(Math.max(obj.materialOverrides.metalness, 0), 1);
        }
        if (Object.keys(overrides).length > 0) {
          materialOverrides = overrides;
        }
      }

      objects.push({
        id: typeof obj.id === 'string' && obj.id ? obj.id : `placement-${Date.now()}-${i}`,
        assetId: typeof obj.assetId === 'string' ? obj.assetId : 'unknown-asset',
        name: typeof obj.name === 'string' ? obj.name : 'Furniture Item',
        dimensions: dims,
        scale,
        rotationEuler: rotation,
        position,
        materialOverrides,
      });
    }

    return {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      unit: 'm',
      room,
      objects,
    };
  } catch {
    return null;
  }
}

