import type { CanonicalScene } from '../types/scene';

export type EvaluationCondition = 'manual' | 'ai_assisted';
export type EvaluationSequence = 'G1' | 'G2' | 'G3' | 'G4';
export type EvaluationTask = 'living_room' | 'home_study';
export type EvaluationSessionStatus = 'in_progress' | 'completed' | 'aborted';
export type AbortReason = 'user_cancelled' | 'inactivity_timeout' | 'browser_closed';

export interface IdleInterval {
  startOffsetSeconds: number;
  durationSeconds: number;
}

export interface ExperimentSessionRecord {
  schemaVersion: number;
  sessionId: string;
  participantId: string;
  condition: EvaluationCondition;
  sequenceOrder: EvaluationSequence;
  trialPeriod: number;
  taskName: EvaluationTask;
  sessionStatus: EvaluationSessionStatus;
  checkpointSequence: number;
  startTime: string;
  endTime?: string | null;
  durationSeconds?: number | null;
  activeDurationSeconds: number;
  abortedAt?: string | null;
  abortReason?: string | null;
  idleIntervals: IdleInterval[];
  totalIdleDurationSeconds: number;
  maxSingleIdleGapSeconds: number;
  hasProlongedInterruption: boolean;
  budgetTotalPaise: number | null;
  budgetCeilingPaise: number;
  isBudgetCompliant: boolean | null;
  attemptedOutOfBoundsCount: number;
  finalSceneOutOfBoundsCount?: number | null;
  aabbOverlapPairsCount?: number | null;
  doorwayIntrusionsCount?: number | null;
  isTaskSuccessful?: boolean | null;
  totalEdits: number;
  undoRedoCount: number;
  agentProposalsCount: number;
  agentAcceptedCount: number;
  agentTier1SuccessCount: number;
  agentTier2SchemaValidCount: number;
  agentTier3DomainValidCount: number;
  checkpointSceneSnapshot?: CanonicalScene | null;
  finalSceneSnapshot?: CanonicalScene | null;
}

export interface ActiveEvaluationSession {
  sessionId: string;
  sessionSecret: string;
  participantId: string;
  condition: EvaluationCondition;
  sequenceOrder: EvaluationSequence;
  taskName: EvaluationTask;
  trialPeriod: 1 | 2;
  startTime: string;
  checkpointSequence: number;
  totalEdits: number;
  undoRedoCount: number;
  attemptedOutOfBoundsCount: number;
  agentProposalsCount: number;
  agentAcceptedCount: number;
  agentTier1SuccessCount: number;
  agentTier2SchemaValidCount: number;
  agentTier3DomainValidCount: number;
  idleIntervals: IdleInterval[];
}

export interface PendingEvaluationSession {
  sessionId: string;
  sessionSecret: string;
  participantId: string;
  condition: EvaluationCondition;
  sequenceOrder: EvaluationSequence;
  taskName: EvaluationTask;
  trialPeriod: 1 | 2;
  createdAt: string;
}

export interface StartSessionParams {
  sessionId?: string;
  sessionSecret?: string;
  participantId: string;
  condition: EvaluationCondition;
  sequenceOrder: EvaluationSequence;
  taskName: EvaluationTask;
  trialPeriod?: 1 | 2;
}

const STORAGE_KEY = 'roomgenie_evaluation_session';
const PENDING_STORAGE_KEY = 'roomgenie_evaluation_pending_session';
const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:8000';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastInteractionTimestamp: number = Date.now();
let currentIdleStart: number | null = null;
let activityListenersAttached = false;
let registeredSceneGetter: (() => CanonicalScene | null) | null = null;

// 1. Session Storage Persistence across browser reloads
export function getActiveSession(): ActiveEvaluationSession | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveEvaluationSession;
  } catch {
    return null;
  }
}

export function saveActiveSession(session: ActiveEvaluationSession): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn('Failed to persist evaluation session to sessionStorage:', err);
  }
}

export function clearActiveSession(): void {
  stopHeartbeat();
  detachActivityListeners();
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear evaluation session from sessionStorage:', err);
  }
}

// 2. Pre-Request Retry Persistence
export function getPendingSession(): PendingEvaluationSession | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingEvaluationSession;
  } catch {
    return null;
  }
}

export function savePendingSession(pending: PendingEvaluationSession): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch (err) {
    console.warn('Failed to persist pending evaluation session to sessionStorage:', err);
  }
}

export function clearPendingSession(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear pending evaluation session from sessionStorage:', err);
  }
}

// 3. High-Entropy Secret & UUID Generation
export function generateSecureSecret(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replace(/-/g, '');
  }
  // Fallback high-entropy hex string
  const arr = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSessionUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 4. User Activity & Inactivity Timing
export function checkInactivityThreshold(): void {
  const now = Date.now();
  if (currentIdleStart === null && now - lastInteractionTimestamp >= 10000) {
    // User has been inactive for 10 seconds; mark start of idle gap
    currentIdleStart = lastInteractionTimestamp;
  }
}

export function flushOngoingIdleInterval(): void {
  checkInactivityThreshold();
  const now = Date.now();
  if (currentIdleStart !== null) {
    const idleSeconds = (now - currentIdleStart) / 1000;
    // Log pauses longer than 10 seconds as idle gaps
    if (idleSeconds >= 10.0) {
      const active = getActiveSession();
      if (active) {
        const startOffset = Math.max(0, (currentIdleStart - new Date(active.startTime).getTime()) / 1000);
        active.idleIntervals.push({
          startOffsetSeconds: Math.round(startOffset * 10) / 10,
          durationSeconds: Math.round(idleSeconds * 10) / 10,
        });
        saveActiveSession(active);
      }
    }
    currentIdleStart = null;
  }
  lastInteractionTimestamp = now;
}

export function onUserActivity(): void {
  flushOngoingIdleInterval();
}

export function attachActivityListeners(): void {
  if (typeof window === 'undefined' || activityListenersAttached) return;
  const events = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'];
  events.forEach((ev) => window.addEventListener(ev, onUserActivity, { passive: true }));
  activityListenersAttached = true;
  lastInteractionTimestamp = Date.now();
  currentIdleStart = null;
}

export function detachActivityListeners(): void {
  if (typeof window === 'undefined' || !activityListenersAttached) return;
  const events = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'];
  events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
  activityListenersAttached = false;
  currentIdleStart = null;
}

function calculateActiveDurationSeconds(active: ActiveEvaluationSession): number {
  checkInactivityThreshold();
  const now = Date.now();
  const start = new Date(active.startTime).getTime();
  const elapsed = Math.max(0, (now - start) / 1000);
  
  let totalIdle = active.idleIntervals.reduce((sum, intv) => sum + intv.durationSeconds, 0);
  if (currentIdleStart !== null) {
    totalIdle += Math.max(0, (now - currentIdleStart) / 1000);
  }
  return Math.max(0, Math.min(elapsed, Math.round((elapsed - totalIdle) * 10) / 10));
}

// 5. Editor Interaction Recording API
export function recordEdit(): void {
  const session = getActiveSession();
  if (!session) return;
  session.totalEdits += 1;
  saveActiveSession(session);
}

export function recordUndoRedo(): void {
  const session = getActiveSession();
  if (!session) return;
  session.undoRedoCount += 1;
  saveActiveSession(session);
}

export function recordOutOfBoundsAttempt(): void {
  const session = getActiveSession();
  if (!session) return;
  session.attemptedOutOfBoundsCount += 1;
  saveActiveSession(session);
}

export function recordAgentProposal(outcome: {
  accepted?: boolean;
  tier1Success: boolean;
  tier2Valid: boolean;
  tier3Valid: boolean;
}): void {
  const session = getActiveSession();
  if (!session) return;
  session.agentProposalsCount += 1;
  if (outcome.accepted) session.agentAcceptedCount += 1;
  if (outcome.tier1Success) session.agentTier1SuccessCount += 1;
  if (outcome.tier2Valid) session.agentTier2SchemaValidCount += 1;
  if (outcome.tier3Valid) session.agentTier3DomainValidCount += 1;
  saveActiveSession(session);
}

export function recordAgentAcceptance(): void {
  const session = getActiveSession();
  if (!session) return;
  session.agentAcceptedCount += 1;
  saveActiveSession(session);
}

// 6. Periodic Heartbeat / Checkpoint Timer
export function registerSceneGetter(getter: () => CanonicalScene | null): void {
  registeredSceneGetter = getter;
}

export function startHeartbeat(
  getCurrentScene?: () => CanonicalScene | null,
  intervalMs = 20000
): void {
  if (getCurrentScene) {
    registeredSceneGetter = getCurrentScene;
  }
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    checkInactivityThreshold();
    const active = getActiveSession();
    if (!active) {
      stopHeartbeat();
      return;
    }
    try {
      const scene = registeredSceneGetter ? registeredSceneGetter() : null;
      await sendEvaluationCheckpoint(scene || undefined);
    } catch (err) {
      console.warn('Evaluation heartbeat checkpoint failed (will retry):', err);
    }
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function initEvaluationTelemetry(
  getScene?: () => CanonicalScene | null,
  heartbeatIntervalMs = 20000
): ActiveEvaluationSession | null {
  if (getScene) {
    registeredSceneGetter = getScene;
  }
  const active = getActiveSession();
  if (active) {
    attachActivityListeners();
    startHeartbeat(registeredSceneGetter || undefined, heartbeatIntervalMs);
    return active;
  }
  return null;
}

// 7. Network Endpoints with Capability Headers & Error Handling
export async function startEvaluationSession(
  params: StartSessionParams
): Promise<ExperimentSessionRecord> {
  const existing = getActiveSession();
  const pending = getPendingSession();
  let sessionId = params.sessionId;
  let sessionSecret = params.sessionSecret;

  if (
    existing &&
    existing.participantId === params.participantId &&
    existing.condition === params.condition &&
    existing.sequenceOrder === params.sequenceOrder &&
    existing.taskName === params.taskName
  ) {
    sessionId = existing.sessionId;
    sessionSecret = existing.sessionSecret;
  } else if (
    pending &&
    pending.participantId === params.participantId &&
    pending.condition === params.condition &&
    pending.sequenceOrder === params.sequenceOrder &&
    pending.taskName === params.taskName
  ) {
    sessionId = pending.sessionId;
    sessionSecret = pending.sessionSecret;
  } else {
    if (!sessionId) sessionId = generateSessionUUID();
    if (!sessionSecret) sessionSecret = generateSecureSecret();
  }

  // Pre-request persistence: save pending credentials before sending request
  const pendingToSave: PendingEvaluationSession = {
    sessionId,
    sessionSecret,
    participantId: params.participantId,
    condition: params.condition,
    sequenceOrder: params.sequenceOrder,
    taskName: params.taskName,
    trialPeriod: params.trialPeriod || 1,
    createdAt: new Date().toISOString(),
  };
  savePendingSession(pendingToSave);

  const payload = {
    sessionId,
    sessionSecret,
    participantId: params.participantId,
    condition: params.condition,
    sequenceOrder: params.sequenceOrder,
    taskName: params.taskName,
    trialPeriod: params.trialPeriod,
  };

  const response = await fetch(`${API_BASE_URL}/api/v1/evaluation/sessions/start/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Session-Secret': sessionSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to start evaluation session (HTTP ${response.status}): ${errorBody}`);
  }

  const record: ExperimentSessionRecord = await response.json();

  // Clear pending record upon successful creation or retry re-establishment
  clearPendingSession();

  // Initialize active tracking state
  const activeSession: ActiveEvaluationSession = {
    sessionId: record.sessionId,
    sessionSecret,
    participantId: record.participantId,
    condition: record.condition,
    sequenceOrder: record.sequenceOrder,
    taskName: record.taskName,
    trialPeriod: (record.trialPeriod as 1 | 2) || 1,
    startTime: record.startTime,
    checkpointSequence: record.checkpointSequence || 0,
    totalEdits: existing?.totalEdits || 0,
    undoRedoCount: existing?.undoRedoCount || 0,
    attemptedOutOfBoundsCount: existing?.attemptedOutOfBoundsCount || 0,
    agentProposalsCount: existing?.agentProposalsCount || 0,
    agentAcceptedCount: existing?.agentAcceptedCount || 0,
    agentTier1SuccessCount: existing?.agentTier1SuccessCount || 0,
    agentTier2SchemaValidCount: existing?.agentTier2SchemaValidCount || 0,
    agentTier3DomainValidCount: existing?.agentTier3DomainValidCount || 0,
    idleIntervals: existing?.idleIntervals || [],
  };

  saveActiveSession(activeSession);
  attachActivityListeners();
  startHeartbeat();
  return record;
}

export async function sendEvaluationCheckpoint(
  snapshot?: CanonicalScene
): Promise<ExperimentSessionRecord | null> {
  const active = getActiveSession();
  if (!active) return null;

  active.checkpointSequence += 1;
  const activeDuration = calculateActiveDurationSeconds(active);

  const payload: Record<string, unknown> = {
    checkpointSequence: active.checkpointSequence,
    activeDurationSeconds: activeDuration,
    totalEdits: active.totalEdits,
    undoRedoCount: active.undoRedoCount,
    attemptedOutOfBoundsCount: active.attemptedOutOfBoundsCount,
    idleIntervals: active.idleIntervals,
  };

  if (snapshot) {
    payload.checkpointSceneSnapshot = snapshot;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/evaluation/sessions/${active.sessionId}/checkpoint/`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Session-Secret': active.sessionSecret,
        },
        body: JSON.stringify(payload),
      }
    );

    if (response.status === 409) {
      // Terminal state: session already completed or aborted
      clearActiveSession();
      clearPendingSession();
      return null;
    }

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Checkpoint error (HTTP ${response.status}): ${errText}`);
      return null;
    }

    const data: ExperimentSessionRecord = await response.json();
    saveActiveSession(active);
    return data;
  } catch (err) {
    console.warn('Network error during checkpoint; state safely preserved for next retry:', err);
    saveActiveSession(active);
    return null;
  }
}

export async function completeEvaluationSession(
  finalScene: CanonicalScene
): Promise<ExperimentSessionRecord> {
  const existing = getActiveSession();
  if (!existing) {
    throw new Error('No active evaluation session to complete.');
  }

  // 1. Flush any pending/ongoing idle time to sessionStorage
  flushOngoingIdleInterval();

  // 2. Reload the updated session from storage to capture newly flushed idle intervals
  const active = getActiveSession();
  if (!active) {
    throw new Error('No active evaluation session to complete.');
  }

  // 3. Calculate active duration using the refreshed session and closed intervals
  const activeDuration = calculateActiveDurationSeconds(active);

  const payload = {
    finalSceneSnapshot: finalScene,
    activeDurationSeconds: activeDuration,
    totalEdits: active.totalEdits,
    undoRedoCount: active.undoRedoCount,
    attemptedOutOfBoundsCount: active.attemptedOutOfBoundsCount,
    idleIntervals: active.idleIntervals,
    agentProposalsCount: active.agentProposalsCount,
    agentAcceptedCount: active.agentAcceptedCount,
    agentTier1SuccessCount: active.agentTier1SuccessCount,
    agentTier2SchemaValidCount: active.agentTier2SchemaValidCount,
    agentTier3DomainValidCount: active.agentTier3DomainValidCount,
  };

  const response = await fetch(
    `${API_BASE_URL}/api/v1/evaluation/sessions/${active.sessionId}/complete/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Session-Secret': active.sessionSecret,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to complete evaluation session (HTTP ${response.status}): ${errorBody}`);
  }

  const record: ExperimentSessionRecord = await response.json();
  clearActiveSession();
  clearPendingSession();
  return record;
}

export async function abortEvaluationSession(
  reason: AbortReason = 'user_cancelled'
): Promise<ExperimentSessionRecord> {
  const active = getActiveSession();
  if (!active) {
    throw new Error('No active evaluation session to abort.');
  }

  const payload = {
    abortReason: reason,
  };

  const response = await fetch(
    `${API_BASE_URL}/api/v1/evaluation/sessions/${active.sessionId}/abort/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Session-Secret': active.sessionSecret,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to abort evaluation session (HTTP ${response.status}): ${errorBody}`);
  }

  const record: ExperimentSessionRecord = await response.json();
  clearActiveSession();
  clearPendingSession();
  return record;
}
