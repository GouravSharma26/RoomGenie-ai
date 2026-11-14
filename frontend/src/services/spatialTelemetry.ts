/**
 * Spatial AI Telemetry for RoomGenie AI (Phase 6.5).
 * Enforces strict data minimization:
 * - NO API keys, session tokens, passwords, or Authorization headers.
 * - NO raw user prompts (hashes intent, extracts length & category only).
 * - NO raw geometry or full scene JSON (extracts coarse counts & area).
 * - Stable, standardized error codes.
 * - Non-blocking: failures in telemetry never interrupt UI or application state.
 */

// Spatial AI Telemetry for RoomGenie AI (Phase 6.5)

export type SpatialTelemetryEventType =
  | 'candidate_generation_requested'
  | 'candidate_generation_succeeded'
  | 'candidate_generation_failed'
  | 'candidate_preview_selected'
  | 'candidate_preview_discarded'
  | 'candidate_applied'
  | 'persistent_undo_executed'
  | 'persistent_redo_executed'
  | 'persistent_sync_succeeded'
  | 'persistent_sync_failed';

export const SPATIAL_ERROR_CODES = {
  ERR_OBB_COLLISION: 'ERR_OBB_COLLISION',
  ERR_OUT_OF_BOUNDS: 'ERR_OUT_OF_BOUNDS',
  ERR_DOOR_OBSTRUCTED: 'ERR_DOOR_OBSTRUCTED',
  ERR_CIRCULATION_BLOCKED: 'ERR_CIRCULATION_BLOCKED',
  ERR_CLEARANCE_VIOLATION: 'ERR_CLEARANCE_VIOLATION',
  ERR_BUDGET_EXCEEDED: 'ERR_BUDGET_EXCEEDED',
  ERR_SOCKET_INCOMPATIBLE: 'ERR_SOCKET_INCOMPATIBLE',
  ERR_STALE_CONCURRENCY: 'ERR_STALE_CONCURRENCY',
  ERR_PROVIDER_TIMEOUT: 'ERR_PROVIDER_TIMEOUT',
  ERR_NETWORK_ERROR: 'ERR_NETWORK_ERROR',
  ERR_UNKNOWN: 'ERR_UNKNOWN',
} as const;

export type SpatialErrorCode = (typeof SPATIAL_ERROR_CODES)[keyof typeof SPATIAL_ERROR_CODES];

export interface SanitizedPromptSummary {
  length: number;
  hash: string;
  category: 'living' | 'bedroom' | 'workspace' | 'dining' | 'general' | 'empty';
}

export interface CoarseRoomSummary {
  objectCount: number;
  wallCount: number;
  approxAreaSqm: number;
  isPolygon: boolean;
}

export interface SpatialTelemetryEvent {
  eventName: SpatialTelemetryEventType;
  timestamp: string;
  designId?: string | number | null;
  durationMs?: number;
  promptSummary?: SanitizedPromptSummary;
  roomSummary?: CoarseRoomSummary;
  candidateMetrics?: {
    candidateCount: number;
    validCandidateCount: number;
    selectedCandidateId?: string;
    overallScore?: number;
  };
  errorCode?: SpatialErrorCode | string;
  errorCategory?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

// In-memory buffer for client inspection and offline testing
const eventLogBuffer: SpatialTelemetryEvent[] = [];
const MAX_BUFFER_SIZE = 100;

export function isTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const envVal = (import.meta as any).env?.VITE_ROOMGENIE_TELEMETRY_ENABLED;
  if (envVal !== undefined && envVal !== null) {
    return envVal === 'true' || envVal === '1';
  }
  return true;
}

export function sanitizePromptClient(prompt?: string | null): SanitizedPromptSummary {
  if (!prompt || !prompt.trim()) {
    return { length: 0, hash: '', category: 'empty' };
  }
  const clean = prompt.trim();
  // Simple non-cryptographic short hash for client telemetry
  let hashVal = 0;
  for (let i = 0; i < clean.length; i++) {
    hashVal = (hashVal << 5) - hashVal + clean.charCodeAt(i);
    hashVal |= 0;
  }
  const hexHash = Math.abs(hashVal).toString(16).padStart(8, '0').slice(0, 8);

  const lower = clean.toLowerCase();
  let category: SanitizedPromptSummary['category'] = 'general';
  if (lower.includes('sofa') || lower.includes('living') || lower.includes('couch')) {
    category = 'living';
  } else if (lower.includes('bed') || lower.includes('bedroom') || lower.includes('nightstand')) {
    category = 'bedroom';
  } else if (lower.includes('desk') || lower.includes('office') || lower.includes('study')) {
    category = 'workspace';
  } else if (lower.includes('dining') || lower.includes('dinner')) {
    category = 'dining';
  }

  return {
    length: clean.length,
    hash: hexHash,
    category,
  };
}

export function summarizeSceneClient(scene: any): CoarseRoomSummary {
  if (!scene || typeof scene !== 'object') {
    return { objectCount: 0, wallCount: 0, approxAreaSqm: 0, isPolygon: false };
  }

  const room = scene.room || {};
  const width = Number(room.width || (room.dimensions && room.dimensions[0]) || 5.0);
  const length = Number(room.length || (room.dimensions && room.dimensions[2]) || 4.0);
  const footprint = room.footprint || room.polygonVertices;
  const isPolygon = Array.isArray(footprint) && footprint.length >= 3;

  const objects = Array.isArray(scene.objects) ? scene.objects : [];
  const walls = Array.isArray(room.walls) ? room.walls : [];
  const wallCount = walls.length > 0 ? walls.length : isPolygon ? footprint.length : 4;

  return {
    objectCount: objects.length,
    wallCount,
    approxAreaSqm: Math.round(width * length * 100) / 100,
    isPolygon,
  };
}

export function trackSpatialEvent(event: Omit<SpatialTelemetryEvent, 'timestamp'>): void {
  if (!isTelemetryEnabled()) return;

  try {
    const fullEvent: SpatialTelemetryEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    eventLogBuffer.push(fullEvent);
    if (eventLogBuffer.length > MAX_BUFFER_SIZE) {
      eventLogBuffer.shift();
    }

    if ((import.meta as any).env?.DEV) {
      console.debug('[SpatialTelemetry]', fullEvent.eventName, fullEvent);
    }
  } catch (err) {
    // Non-blocking: telemetry error must never throw
    console.warn('[SpatialTelemetry] suppressed tracking error', err);
  }
}

export function getClientTelemetryEvents(): SpatialTelemetryEvent[] {
  return [...eventLogBuffer];
}

export function clearClientTelemetryEvents(): void {
  eventLogBuffer.length = 0;
}
