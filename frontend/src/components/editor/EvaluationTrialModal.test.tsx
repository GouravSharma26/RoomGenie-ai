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
    expect(screen.getByRole('button', { name: /start (developer dry run|evaluation trial)/i })).toBeInTheDocument();
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

  it('runs full Developer Dry Run lifecycle without network calls: start, checkpoint, SUS survey validation, and result summary', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<EvaluationTrialModal isOpen={true} onClose={vi.fn()} />);

    // 1. Verify Developer Dry Run is enabled by default
    expect(screen.getByText('Developer Dry Run Mode')).toBeInTheDocument();
    const startButton = screen.getByRole('button', { name: /start developer dry run/i });
    expect(startButton).toBeInTheDocument();

    // 2. Start developer dry run
    fireEvent.click(startButton);

    // No network fetch should be dispatched in dry-run mode
    expect(fetchSpy).not.toHaveBeenCalled();

    // 3. In-progress trial dashboard is rendered
    expect(screen.getByText(/active study trial/i)).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Checkpoints:').parentElement).toHaveTextContent('Checkpoints: 0');

    // 4. Test manual checkpoint in dry run
    const checkpointBtn = screen.getByRole('button', { name: /save checkpoint/i });
    fireEvent.click(checkpointBtn);
    expect(screen.getByText('Checkpoints:').parentElement).toHaveTextContent('Checkpoints: 1');
    expect(fetchSpy).not.toHaveBeenCalled();

    // 5. Click "Submit Design (Complete)" to advance to SUS survey step
    const submitDesignBtn = screen.getByRole('button', { name: /submit design \(complete\)/i });
    fireEvent.click(submitDesignBtn);

    // 6. SUS survey questionnaire is rendered with 10 questions
    expect(screen.getByText(/system usability scale \(sus\) survey/i)).toBeInTheDocument();
    expect(screen.getByText(/I think that I would like to use this system frequently\./i)).toBeInTheDocument();
    expect(screen.getByText(/I needed to learn a lot of things/i)).toBeInTheDocument();

    // 7. Attempting to submit incomplete survey triggers validation error
    const submitSurveyBtn = screen.getByRole('button', { name: /validate & submit usability survey/i });
    fireEvent.click(submitSurveyBtn);

    expect(screen.getByText(/please answer all 10 questions to complete/i)).toBeInTheDocument();

    // 8. Fill sample survey responses
    const fillSampleBtn = screen.getByRole('button', { name: /fill sample responses/i });
    fireEvent.click(fillSampleBtn);

    // Validation error clears
    expect(screen.queryByText(/please answer all 10 questions to complete/i)).not.toBeInTheDocument();

    // 9. Submit validated survey
    fireEvent.click(submitSurveyBtn);

    // 10. Completed trial evaluation summary is displayed
    expect(screen.getByText(/trial successfully evaluated & recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/dry run synthetic record/i)).toBeInTheDocument();
    expect(screen.getByText(/task success \(h04\):/i)).toBeInTheDocument();
    expect(screen.getByText(/sus usability score:/i)).toBeInTheDocument();
    expect(screen.getByText(/inspect export record \(json schema\)/i)).toBeInTheDocument();

    // 11. Expand JSON inspection
    const expandBtn = screen.getByRole('button', { name: /inspect export record/i });
    fireEvent.click(expandBtn);
    expect(screen.getByText(/copy record json/i)).toBeInTheDocument();
  });
});

