import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startEvaluationSession,
  sendEvaluationCheckpoint,
  completeEvaluationSession,
  abortEvaluationSession,
  getActiveSession,
  saveActiveSession,
  clearActiveSession,
  recordEdit,
  recordUndoRedo,
  recordOutOfBoundsAttempt,
  recordAgentProposal,
  generateSecureSecret,
  generateSessionUUID,
  type ActiveEvaluationSession,
} from './evaluationTelemetry';
import type { CanonicalScene } from '../types/scene';

describe('evaluationTelemetry service', () => {
  const sampleScene: CanonicalScene = {
    schemaVersion: 1,
    unit: 'm',
    room: { width: 5.0, length: 4.0, height: 2.8 },
    objects: [
      {
        id: 'sofa-1',
        assetId: 'sofa-modern-3seater',
        name: 'Sofa',
        position: [0.0, 0.425, -1.2],
        dimensions: [2.1, 0.85, 0.9],
        scale: [1, 1, 1],
        rotationEuler: [0, 0, 0],
      },
    ],
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearActiveSession();
  });

  it('generates high entropy capability secrets and valid UUIDs', () => {
    const sec1 = generateSecureSecret();
    const sec2 = generateSecureSecret();
    expect(sec1).toBeDefined();
    expect(sec1.length).toBeGreaterThanOrEqual(32);
    expect(sec1).not.toBe(sec2);

    const uuid = generateSessionUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('starts a new evaluation session, sets X-Session-Secret header, and persists to sessionStorage', async () => {
    const mockRecord = {
      schemaVersion: 1,
      sessionId: '11111111-1111-4111-a111-111111111111',
      participantId: 'P01',
      condition: 'manual',
      sequenceOrder: 'G1',
      trialPeriod: 1,
      taskName: 'living_room',
      sessionStatus: 'in_progress',
      checkpointSequence: 0,
      startTime: new Date().toISOString(),
      activeDurationSeconds: 0,
      totalEdits: 0,
      undoRedoCount: 0,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
      totalIdleDurationSeconds: 0,
      maxSingleIdleGapSeconds: 0,
      hasProlongedInterruption: false,
      budgetTotalPaise: null,
      budgetCeilingPaise: 6000000,
      isBudgetCompliant: null,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => mockRecord,
    } as Response);

    const result = await startEvaluationSession({
      participantId: 'P01',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/v1/evaluation/sessions/start/');
    expect(options?.method).toBe('POST');
    
    // Check header
    const headers = options?.headers as Record<string, string>;
    expect(headers['X-Session-Secret']).toBeDefined();
    expect(headers['X-Session-Secret'].length).toBeGreaterThanOrEqual(16);

    // Verify stored session
    const active = getActiveSession();
    expect(active).not.toBeNull();
    expect(active?.participantId).toBe('P01');
    expect(active?.sessionId).toBe(mockRecord.sessionId);
    expect(active?.sessionSecret).toBe(headers['X-Session-Secret']);
    expect(result.sessionId).toBe(mockRecord.sessionId);
  });

  it('re-uses existing sessionId and sessionSecret on browser refresh / idempotent start', async () => {
    const existingSession: ActiveEvaluationSession = {
      sessionId: '22222222-2222-4222-a222-222222222222',
      sessionSecret: 'saved_secret_value_1234567890',
      participantId: 'P02',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date().toISOString(),
      checkpointSequence: 2,
      totalEdits: 5,
      undoRedoCount: 1,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
    };
    saveActiveSession(existingSession);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...existingSession,
        schemaVersion: 1,
        sessionStatus: 'in_progress',
        budgetCeilingPaise: 6000000,
      }),
    } as Response);

    const result = await startEvaluationSession({
      participantId: 'P02',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
    });

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options?.body as string);
    expect(body.sessionId).toBe(existingSession.sessionId);
    expect(body.sessionSecret).toBe(existingSession.sessionSecret);
    expect(result.sessionId).toBe(existingSession.sessionId);
  });

  it('tracks interaction counts (edits, undo/redo, boundary clashes, agent proposals)', () => {
    const session: ActiveEvaluationSession = {
      sessionId: '33333333-3333-4333-a333-333333333333',
      sessionSecret: 'secret_tracker_test_1234',
      participantId: 'P03',
      condition: 'ai_assisted',
      sequenceOrder: 'G2',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date().toISOString(),
      checkpointSequence: 0,
      totalEdits: 0,
      undoRedoCount: 0,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
    };
    saveActiveSession(session);

    recordEdit();
    recordEdit();
    recordUndoRedo();
    recordOutOfBoundsAttempt();
    recordAgentProposal({
      accepted: true,
      tier1Success: true,
      tier2Valid: true,
      tier3Valid: true,
    });

    const updated = getActiveSession();
    expect(updated?.totalEdits).toBe(2);
    expect(updated?.undoRedoCount).toBe(1);
    expect(updated?.attemptedOutOfBoundsCount).toBe(1);
    expect(updated?.agentProposalsCount).toBe(1);
    expect(updated?.agentAcceptedCount).toBe(1);
    expect(updated?.agentTier1SuccessCount).toBe(1);
    expect(updated?.agentTier2SchemaValidCount).toBe(1);
    expect(updated?.agentTier3DomainValidCount).toBe(1);
  });

  it('sends revision-ordered checkpoints with X-Session-Secret header', async () => {
    const session: ActiveEvaluationSession = {
      sessionId: '44444444-4444-4444-a444-444444444444',
      sessionSecret: 'checkpoint_secret_12345',
      participantId: 'P04',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date(Date.now() - 30000).toISOString(),
      checkpointSequence: 3,
      totalEdits: 8,
      undoRedoCount: 2,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
    };
    saveActiveSession(session);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...session, checkpointSequence: 4 }),
    } as Response);

    const res = await sendEvaluationCheckpoint(sampleScene);
    expect(res).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain(`/api/v1/evaluation/sessions/${session.sessionId}/checkpoint/`);
    expect(options?.method).toBe('PATCH');

    const headers = options?.headers as Record<string, string>;
    expect(headers['X-Session-Secret']).toBe('checkpoint_secret_12345');

    const body = JSON.parse(options?.body as string);
    expect(body.checkpointSequence).toBe(4);
    expect(body.totalEdits).toBe(8);
    expect(body.checkpointSceneSnapshot).toBeDefined();

    const stored = getActiveSession();
    expect(stored?.checkpointSequence).toBe(4);
  });

  it('handles terminal 409 Conflict during checkpoint by safely clearing active session', async () => {
    const session: ActiveEvaluationSession = {
      sessionId: '55555555-5555-4555-a555-555555555555',
      sessionSecret: 'secret_term_123456',
      participantId: 'P05',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date().toISOString(),
      checkpointSequence: 1,
      totalEdits: 0,
      undoRedoCount: 0,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
    };
    saveActiveSession(session);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () => 'Session is in terminal state',
    } as Response);

    const res = await sendEvaluationCheckpoint();
    expect(res).toBeNull();
    expect(getActiveSession()).toBeNull();
  });

  it('completes session, transmits finalSceneSnapshot, and clears sessionStorage', async () => {
    const session: ActiveEvaluationSession = {
      sessionId: '66666666-6666-4666-a666-666666666666',
      sessionSecret: 'complete_secret_12345',
      participantId: 'P06',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date(Date.now() - 60000).toISOString(),
      checkpointSequence: 2,
      totalEdits: 10,
      undoRedoCount: 2,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
    };
    saveActiveSession(session);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...session,
        sessionStatus: 'completed',
        isTaskSuccessful: true,
      }),
    } as Response);

    const result = await completeEvaluationSession(sampleScene);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain(`/api/v1/evaluation/sessions/${session.sessionId}/complete/`);
    expect(options?.method).toBe('POST');

    const headers = options?.headers as Record<string, string>;
    expect(headers['X-Session-Secret']).toBe('complete_secret_12345');

    const body = JSON.parse(options?.body as string);
    expect(body.finalSceneSnapshot).toBeDefined();
    expect(body.totalEdits).toBe(10);

    expect(getActiveSession()).toBeNull();
    expect(result.sessionStatus).toBe('completed');
  });

  it('aborts session with specified reason and clears sessionStorage', async () => {
    const session: ActiveEvaluationSession = {
      sessionId: '77777777-7777-4777-a777-777777777777',
      sessionSecret: 'abort_secret_123456',
      participantId: 'P07',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date().toISOString(),
      checkpointSequence: 1,
      totalEdits: 1,
      undoRedoCount: 0,
      attemptedOutOfBoundsCount: 0,
      agentProposalsCount: 0,
      agentAcceptedCount: 0,
      agentTier1SuccessCount: 0,
      agentTier2SchemaValidCount: 0,
      agentTier3DomainValidCount: 0,
      idleIntervals: [],
    };
    saveActiveSession(session);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...session,
        sessionStatus: 'aborted',
        abortReason: 'user_cancelled',
      }),
    } as Response);

    const result = await abortEvaluationSession('user_cancelled');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain(`/api/v1/evaluation/sessions/${session.sessionId}/abort/`);
    expect(options?.method).toBe('POST');

    const body = JSON.parse(options?.body as string);
    expect(body.abortReason).toBe('user_cancelled');

    expect(getActiveSession()).toBeNull();
    expect(result.sessionStatus).toBe('aborted');
  });
});
