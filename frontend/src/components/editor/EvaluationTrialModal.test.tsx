import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EvaluationTrialModal } from './EvaluationTrialModal';
import {
  savePendingSession,
  clearPendingSession,
  clearActiveSession,
  type PendingEvaluationSession,
} from '../../services/evaluationTelemetry';

describe('EvaluationTrialModal Recovery & Interface Tests', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearPendingSession();
    clearActiveSession();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
    clearPendingSession();
    clearActiveSession();
    vi.restoreAllMocks();
  });

  it('renders default configuration form when no active or pending session exists', () => {
    render(<EvaluationTrialModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Evaluation Protocol & Telemetry')).toBeInTheDocument();
    expect(screen.getByDisplayValue('P01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start evaluation trial/i })).toBeInTheDocument();
    expect(screen.queryByText(/pending \/ lost start session detected/i)).not.toBeInTheDocument();
  });

  it('restores pending assignment after lost response and enables explicit retry via UI', async () => {
    // 1. Simulate lost start response: pending session stored in sessionStorage
    const pendingSession: PendingEvaluationSession = {
      sessionId: 'pending-uuid-1234',
      sessionSecret: 'pending_secret_token_5678',
      participantId: 'P_LOST_RETRY',
      condition: 'ai_assisted',
      sequenceOrder: 'G2',
      taskName: 'living_room',
      trialPeriod: 1,
      createdAt: new Date().toISOString(),
    };
    savePendingSession(pendingSession);

    // 2. Page reload happens -> user opens modal
    render(<EvaluationTrialModal isOpen={true} onClose={vi.fn()} />);

    // 3. Interface detects pending unconfirmed session and restores parameters
    expect(screen.getByText(/pending \/ lost start session detected/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('P_LOST_RETRY')).toBeInTheDocument();
    expect(screen.getByText(/retry \/ resume session/i)).toBeInTheDocument();

    // 4. Mock backend idempotent 200 response on retry
    const mockRecord = {
      schemaVersion: 1,
      sessionId: 'pending-uuid-1234',
      participantId: 'P_LOST_RETRY',
      condition: 'ai_assisted',
      sequenceOrder: 'G2',
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
      status: 200,
      json: async () => mockRecord,
    } as Response);

    // 5. User clicks "Retry / Resume Session" button in UI
    const retryButton = screen.getByRole('button', { name: /retry \/ resume session/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain('/api/v1/evaluation/sessions/start/');
    expect(callOptions?.headers).toMatchObject({
      'X-Session-Secret': 'pending_secret_token_5678',
    });
    const parsedBody = JSON.parse(callOptions?.body as string);
    expect(parsedBody.sessionId).toBe('pending-uuid-1234');
    expect(parsedBody.sessionSecret).toBe('pending_secret_token_5678');
    expect(parsedBody.participantId).toBe('P_LOST_RETRY');

    // 6. Active trial state is displayed in the modal
    await waitFor(() => {
      expect(screen.getByText(/active study trial/i)).toBeInTheDocument();
      expect(screen.getByText('In Progress')).toBeInTheDocument();
      expect(screen.queryByText(/pending \/ lost start session detected/i)).not.toBeInTheDocument();
    });
  });

  it('allows discarding pending credentials to start a fresh trial', async () => {
    const pendingSession: PendingEvaluationSession = {
      sessionId: 'pending-uuid-discard',
      sessionSecret: 'pending_secret_discard',
      participantId: 'P_DISCARD',
      condition: 'manual',
      sequenceOrder: 'G1',
      taskName: 'living_room',
      trialPeriod: 1,
      createdAt: new Date().toISOString(),
    };
    savePendingSession(pendingSession);

    render(<EvaluationTrialModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/pending \/ lost start session detected/i)).toBeInTheDocument();

    const discardButton = screen.getByRole('button', { name: /discard pending/i });
    fireEvent.click(discardButton);

    // Banner is removed and pending storage is cleared
    expect(screen.queryByText(/pending \/ lost start session detected/i)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('roomgenie_evaluation_pending_session')).toBeNull();
  });
});
