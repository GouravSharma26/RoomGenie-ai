import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startEvaluationSession,
  sendEvaluationCheckpoint,
  completeEvaluationSession,
  abortEvaluationSession,
  getActiveSession,
  saveActiveSession,
  clearActiveSession,
  getPendingSession,
  clearPendingSession,
  recordEdit,
  recordUndoRedo,
  recordOutOfBoundsAttempt,
  recordAgentProposal,
  recordAgentAcceptance,
  generateSecureSecret,
  generateSessionUUID,
  initEvaluationTelemetry,
  stopHeartbeat,
  onUserActivity,
  type ActiveEvaluationSession,
} from './evaluationTelemetry';
import { useEditorStore } from '../editor3d/store/editorStore';
import { SAMPLE_CATALOG } from '../editor3d/data/catalog';
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
    stopHeartbeat();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stopHeartbeat();
    clearActiveSession();
    clearPendingSession();
    vi.useRealTimers();
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
      trialPeriod: 1,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/v1/evaluation/sessions/start/');
    expect(options?.method).toBe('POST');

    const headers = options?.headers as Record<string, string>;
    expect(headers['X-Session-Secret']).toBeDefined();
    expect(headers['X-Session-Secret'].length).toBeGreaterThanOrEqual(16);

    const body = JSON.parse(options?.body as string);
    expect(body.sessionId).toBeDefined();
    expect(body.sessionSecret).toBe(headers['X-Session-Secret']);
    expect(body.participantId).toBe('P01');

    const active = getActiveSession();
    expect(active).not.toBeNull();
    expect(active?.sessionId).toBe(mockRecord.sessionId);
    expect(active?.sessionSecret).toBe(headers['X-Session-Secret']);
    expect(result.sessionId).toBe(mockRecord.sessionId);
  });

  it('persists pending retry credentials before request and recovers from network failure', async () => {
    // 1. Initial attempt fails due to dropped connection / lost response
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('Failed to fetch (network disconnected)')
    );

    await expect(
      startEvaluationSession({
        participantId: 'P_RETRY_TEST',
        condition: 'manual',
        sequenceOrder: 'G1',
        taskName: 'living_room',
        trialPeriod: 1,
      })
    ).rejects.toThrow('Failed to fetch');

    // Verify pending session record was saved prior to network dispatch
    const pending = getPendingSession();
    expect(pending).not.toBeNull();
    expect(pending?.participantId).toBe('P_RETRY_TEST');
    expect(pending?.sessionId).toBeDefined();
    expect(pending?.sessionSecret).toBeDefined();
    const originalPendingSessionId = pending!.sessionId;
    const originalPendingSecret = pending!.sessionSecret;

    // Active session is not yet stored
    expect(getActiveSession()).toBeNull();

    // 2. Retry attempt: server returns 200 (created during initial attempt or retried idempotently)
    const mockRecord = {
      schemaVersion: 1,
      sessionId: originalPendingSessionId,
      participantId: 'P_RETRY_TEST',
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

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockRecord,
    } as Response);

    const retryResult = await startEvaluationSession({
      participantId: 'P_RETRY_TEST',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
    });

    // Check that retry re-used the exact same session ID and secret from the pending state
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, retryOptions] = fetchSpy.mock.calls[1];
    const retryBody = JSON.parse(retryOptions?.body as string);
    expect(retryBody.sessionId).toBe(originalPendingSessionId);
    expect(retryBody.sessionSecret).toBe(originalPendingSecret);

    // Pending record is cleared after success and active session is saved
    expect(getPendingSession()).toBeNull();
    const active = getActiveSession();
    expect(active?.sessionId).toBe(originalPendingSessionId);
    expect(active?.sessionSecret).toBe(originalPendingSecret);
    expect(retryResult.sessionId).toBe(originalPendingSessionId);
  });

  it('automatically triggers heartbeat checkpoints and records inactivity intervals', async () => {
    vi.useFakeTimers();

    const mockStartRecord = {
      schemaVersion: 1,
      sessionId: '22222222-2222-4222-a222-222222222222',
      participantId: 'P_HEARTBEAT',
      condition: 'manual' as const,
      sequenceOrder: 'G1' as const,
      trialPeriod: 1,
      taskName: 'living_room' as const,
      sessionStatus: 'in_progress' as const,
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

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/start/')) {
        return {
          ok: true,
          status: 201,
          json: async () => mockStartRecord,
        } as Response;
      }
      if (urlStr.includes('/checkpoint/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...mockStartRecord, checkpointSequence: 1 }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    await startEvaluationSession({
      participantId: 'P_HEARTBEAT',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance by 20 seconds (the default heartbeat interval)
    await vi.advanceTimersByTimeAsync(20000);

    // Heartbeat should have dispatched an automatic checkpoint
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [chkUrl, chkOpts] = fetchSpy.mock.calls[1];
    expect(String(chkUrl)).toContain('/checkpoint/');
    const chkBody = JSON.parse(chkOpts?.body as string);
    expect(chkBody.checkpointSequence).toBe(1);

    // Inactivity check: advance another 15 seconds without user activity
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const [, secondChkOpts] = fetchSpy.mock.calls[2];
    const secondChkBody = JSON.parse(secondChkOpts?.body as string);
    expect(secondChkBody.checkpointSequence).toBe(2);
    // User has been inactive for > 10s, so idle intervals are recorded
    expect(secondChkBody.activeDurationSeconds).toBeLessThanOrEqual(40.0);

    stopHeartbeat();
    await vi.advanceTimersByTimeAsync(20000);
    // No additional checkpoints after stopHeartbeat
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('tracks interaction counts including undo/redo and AI agent proposals', () => {
    const session: ActiveEvaluationSession = {
      sessionId: '33333333-3333-4333-a333-333333333333',
      sessionSecret: 'secret_123',
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
      accepted: false,
      tier1Success: true,
      tier2Valid: true,
      tier3Valid: true,
    });
    recordAgentAcceptance();

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

  it('records out-of-bounds attempts from AI proposals once per proposal without inflation', () => {
    const session: ActiveEvaluationSession = {
      sessionId: '33333333-3333-4333-a333-333333333333',
      sessionSecret: 'secret_ai_test',
      participantId: 'P_AI',
      condition: 'ai_assisted',
      sequenceOrder: 'G1',
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

    // 1. Valid proposal: does NOT increment attemptedOutOfBoundsCount
    recordAgentProposal({
      accepted: false,
      tier1Success: true,
      tier2Valid: true,
      tier3Valid: true,
      hasOutOfBoundsViolation: false,
    });
    let s = getActiveSession();
    expect(s?.agentProposalsCount).toBe(1);
    expect(s?.agentTier1SuccessCount).toBe(1);
    expect(s?.agentTier2SchemaValidCount).toBe(1);
    expect(s?.agentTier3DomainValidCount).toBe(1);
    expect(s?.attemptedOutOfBoundsCount).toBe(0);

    // 2. Proposal with out-of-bounds placement: increments attemptedOutOfBoundsCount by exactly 1
    // (schema valid, containment invalid)
    recordAgentProposal({
      accepted: false,
      tier1Success: true,
      tier2Valid: true,
      tier3Valid: false,
      hasOutOfBoundsViolation: true,
    });
    s = getActiveSession();
    expect(s?.agentProposalsCount).toBe(2);
    expect(s?.agentTier1SuccessCount).toBe(2);
    expect(s?.agentTier2SchemaValidCount).toBe(2);
    expect(s?.agentTier3DomainValidCount).toBe(1);
    expect(s?.attemptedOutOfBoundsCount).toBe(1);

    // 3. Non-boundary invalid proposal (e.g. budget ceiling breach, containment is valid):
    // MUST NOT increment attemptedOutOfBoundsCount
    recordAgentProposal({
      accepted: false,
      tier1Success: true,
      tier2Valid: true,
      tier3Valid: true,
      hasOutOfBoundsViolation: false,
    });
    s = getActiveSession();
    expect(s?.agentProposalsCount).toBe(3);
    expect(s?.agentTier1SuccessCount).toBe(3);
    expect(s?.agentTier2SchemaValidCount).toBe(3);
    expect(s?.agentTier3DomainValidCount).toBe(2);
    expect(s?.attemptedOutOfBoundsCount).toBe(1); // Still 1

    // 4. Failed proposal (tier1Success=false, network error):
    // MUST NOT increment attemptedOutOfBoundsCount
    recordAgentProposal({
      accepted: false,
      tier1Success: false,
      tier2Valid: false,
      tier3Valid: false,
      hasOutOfBoundsViolation: false,
    });
    s = getActiveSession();
    expect(s?.agentProposalsCount).toBe(4);
    expect(s?.agentTier1SuccessCount).toBe(3);
    expect(s?.agentTier2SchemaValidCount).toBe(3);
    expect(s?.agentTier3DomainValidCount).toBe(2);
    expect(s?.attemptedOutOfBoundsCount).toBe(1); // Still 1
  });

  it('wires undo/redo store actions directly to recordUndoRedo telemetry', () => {
    const session: ActiveEvaluationSession = {
      sessionId: '44444444-4444-4444-a444-444444444444',
      sessionSecret: 'undo_secret_123',
      participantId: 'P_UNDO',
      condition: 'manual',
      sequenceOrder: 'G1',
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

    // Initial state
    expect(useEditorStore.getState().canUndo()).toBe(false);

    // Add a furniture item from catalog
    useEditorStore.getState().addFurniture(SAMPLE_CATALOG[0]);
    expect(useEditorStore.getState().canUndo()).toBe(true);

    // Execute undo action
    useEditorStore.getState().undo();
    let currentSession = getActiveSession();
    expect(currentSession?.undoRedoCount).toBe(1);
    expect(useEditorStore.getState().canRedo()).toBe(true);

    // Execute redo action
    useEditorStore.getState().redo();
    currentSession = getActiveSession();
    expect(currentSession?.undoRedoCount).toBe(2);
  });

  it('handles 409 conflict during checkpoint by clearing active session', async () => {
    const session: ActiveEvaluationSession = {
      sessionId: '55555555-5555-4555-a555-555555555555',
      sessionSecret: 'secret_409',
      participantId: 'P05',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date().toISOString(),
      checkpointSequence: 1,
      totalEdits: 5,
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

    const result = await sendEvaluationCheckpoint();
    expect(result).toBeNull();
    expect(getActiveSession()).toBeNull();
  });

  it('completes session and clears active session and pending credentials', async () => {
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
    expect(getPendingSession()).toBeNull();
    expect(result.sessionStatus).toBe('completed');
  });

  it('flushes ongoing idle interval on completion, includes it in payload, and maintains consistent active and idle duration', async () => {
    vi.useFakeTimers();

    const startTime = new Date(1000000).toISOString();
    vi.setSystemTime(1000000);

    const session: ActiveEvaluationSession = {
      sessionId: '77777777-7777-4777-a777-777777777777',
      sessionSecret: 'complete_idle_test_secret',
      participantId: 'P_IDLE_TEST',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: startTime,
      checkpointSequence: 0,
      totalEdits: 3,
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

    // Initialize telemetry so listeners and timestamps are bound at t=1000000 (0s relative)
    initEvaluationTelemetry();

    // Mock fetch for both background checkpoint heartbeats and complete calls
    let sentPayload: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/complete/')) {
        sentPayload = JSON.parse(opts?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...session,
            sessionStatus: 'completed',
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...session,
        }),
      } as Response;
    });

    // User is active for first 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    onUserActivity(); // active interaction at t=5s (5000ms)

    // User is now idle for 20 seconds (t=5s to t=25s)
    await vi.advanceTimersByTimeAsync(20000);

    // Complete evaluation session at t=25s
    await completeEvaluationSession(sampleScene);

    expect(sentPayload).not.toBeNull();
    // 1. The final idle interval MUST be present in the completion payload
    expect(sentPayload.idleIntervals).toHaveLength(1);
    expect(sentPayload.idleIntervals[0].durationSeconds).toBeCloseTo(20.0, 1);
    expect(sentPayload.idleIntervals[0].startOffsetSeconds).toBeCloseTo(5.0, 1);

    // 2. activeDurationSeconds must exclude the 20s idle period (25s total elapsed - 20s idle = 5.0s active)
    expect(sentPayload.activeDurationSeconds).toBeCloseTo(5.0, 1);

    // 3. active-plus-idle duration must be consistent with elapsed time (25.0s)
    const totalIdle = sentPayload.idleIntervals.reduce((sum: number, intv: { durationSeconds: number }) => sum + intv.durationSeconds, 0);
    expect(sentPayload.activeDurationSeconds + totalIdle).toBeCloseTo(25.0, 1);
  });

  it('preserves final idle interval when user resumes activity immediately before submitting design', async () => {
    vi.useFakeTimers();

    vi.setSystemTime(2000000);
    const session: ActiveEvaluationSession = {
      sessionId: '88888888-8888-4888-a888-888888888888',
      sessionSecret: 'complete_resume_test_secret',
      participantId: 'P_RESUME_TEST',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      startTime: new Date(2000000).toISOString(),
      checkpointSequence: 0,
      totalEdits: 4,
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
    initEvaluationTelemetry();

    // Mock fetch for both background checkpoint heartbeats and complete calls
    let sentPayload: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/complete/')) {
        sentPayload = JSON.parse(opts?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...session,
            sessionStatus: 'completed',
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...session,
        }),
      } as Response;
    });

    // 6s active (interact at t=3s and t=6s to stay below 10s inactivity threshold)
    await vi.advanceTimersByTimeAsync(3000);
    onUserActivity();
    await vi.advanceTimersByTimeAsync(3000);
    onUserActivity();

    // 30s idle (threshold >= 10s, idle from t=6s to t=36s)
    await vi.advanceTimersByTimeAsync(30000);

    // User resumes activity by clicking (fires onUserActivity)
    onUserActivity();

    // Immediately calls completeEvaluationSession
    await completeEvaluationSession(sampleScene);

    expect(sentPayload).not.toBeNull();
    expect(sentPayload.idleIntervals).toHaveLength(1);
    expect(sentPayload.idleIntervals[0].durationSeconds).toBeCloseTo(30.0, 1);
    expect(sentPayload.idleIntervals[0].startOffsetSeconds).toBeCloseTo(6.0, 1);
    expect(sentPayload.activeDurationSeconds).toBeCloseTo(6.0, 1);
    const totalIdle = sentPayload.idleIntervals.reduce((sum: number, intv: { durationSeconds: number }) => sum + intv.durationSeconds, 0);
    expect(sentPayload.activeDurationSeconds + totalIdle).toBeCloseTo(36.0, 1);
  });

  it('aborts session with specified reason and clears active and pending sessionStorage', async () => {
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
    expect(getPendingSession()).toBeNull();
    expect(result.sessionStatus).toBe('aborted');
  });

  it('restores active session and resumes heartbeat on initEvaluationTelemetry', () => {
    const session: ActiveEvaluationSession = {
      sessionId: '88888888-8888-4888-a888-888888888888',
      sessionSecret: 'init_secret_123',
      participantId: 'P_INIT',
      condition: 'manual',
      sequenceOrder: 'G1',
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

    const restored = initEvaluationTelemetry(() => sampleScene);
    expect(restored).not.toBeNull();
    expect(restored?.sessionId).toBe(session.sessionId);
    stopHeartbeat();
  });
});
