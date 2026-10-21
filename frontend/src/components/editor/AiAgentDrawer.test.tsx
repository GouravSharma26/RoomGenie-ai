import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiAgentDrawer } from './AiAgentDrawer';
import * as agentApi from '../../services/agentApi';
import { 
  saveActiveSession, 
  clearActiveSession, 
  getActiveSession, 
  type ActiveEvaluationSession 
} from '../../services/evaluationTelemetry';
import type { CanonicalScene } from '../../types/scene';

vi.mock('../../services/agentApi');

describe('AiAgentDrawer Telemetry Integration', () => {
  const sampleScene: CanonicalScene = {
    schemaVersion: 1,
    unit: 'm',
    room: { width: 5.0, length: 4.0, height: 2.8 },
    objects: [
      {
        id: 'sofa-1',
        assetId: 'sofa-modern-3seater',
        name: 'Sofa',
        position: [0.0, 0.425, 0.0],
        dimensions: [2.0, 0.85, 0.9],
        scale: [1, 1, 1],
        rotationEuler: [0, 0, 0],
      },
    ],
  };

  const createMockSession = (overrides?: Partial<ActiveEvaluationSession>): ActiveEvaluationSession => ({
    sessionId: 'test-ai-eval-session-123',
    sessionSecret: 'secret_ai_eval_123',
    participantId: 'P_AI_TEST',
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
    ...overrides,
  });

  beforeEach(() => {
    sessionStorage.clear();
    clearActiveSession();
    vi.restoreAllMocks();

    vi.mocked(agentApi.createAgentSession).mockResolvedValue({
      id: 'mock-agent-session-id',
      owner_username: 'testuser',
      design: null,
      title: 'Design Session',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  afterEach(() => {
    clearActiveSession();
    sessionStorage.clear();
  });

  it('increments attemptedOutOfBoundsCount once when AI proposal has an out-of-bounds placement', async () => {
    saveActiveSession(createMockSession());

    // Proposal where AI placed furniture out of bounds (room_containment_valid = false)
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-oob-1',
        session: 'mock-agent-session-id',
        user_prompt: 'Add a big table',
        status: 'proposed',
        ai_response_text: 'I placed a table near the wall.',
        proposed_actions: [
          { name: 'add_furniture', parameters: { assetId: 'table-large', position: [10.0, 0.5, 0.0] } },
        ],
        validation_results: {
          is_valid: false,
          errors: ['Candidate layout violates 3D room containment: 1 item(s) extend beyond room walls/ceiling.'],
          warnings: [],
          budget_diff: {
            diff_paise: 150000,
            room_containment_valid: false,
            room_violations: ['table-large extends 7.5m beyond East wall'],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: {
        ...sampleScene,
        objects: [
          ...sampleScene.objects,
          {
            id: 'table-large-1',
            assetId: 'table-large',
            name: 'Large Table',
            position: [10.0, 0.5, 0.0],
            dimensions: [1.8, 0.75, 0.9],
            scale: [1, 1, 1],
            rotationEuler: [0, 0, 0],
          },
        ],
      },
      budget_diff: {
        diff_paise: 150000,
        room_containment_valid: false,
        room_violations: ['table-large extends 7.5m beyond East wall'],
      },
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    // Send prompt
    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add a big table' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier1SuccessCount).toBe(1);
    expect(session?.agentTier3DomainValidCount).toBe(0);
    // Boundary violation attempt counted exactly once!
    expect(session?.attemptedOutOfBoundsCount).toBe(1);
  });

  it('does not inflate attemptedOutOfBoundsCount when an AI proposal has multiple boundary violations', async () => {
    saveActiveSession(createMockSession());

    // Proposal with 3 distinct out-of-bounds placements in a single response
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-multi-oob',
        session: 'mock-agent-session-id',
        user_prompt: 'Add three items',
        status: 'proposed',
        ai_response_text: 'I placed three items outside the room.',
        proposed_actions: [],
        validation_results: {
          is_valid: false,
          errors: ['Candidate layout violates 3D room containment: 3 item(s) extend beyond room walls/ceiling.'],
          warnings: [],
          budget_diff: {
            diff_paise: 300000,
            room_containment_valid: false,
            room_violations: [
              'item-1 extends beyond East wall',
              'item-2 extends beyond West wall',
              'item-3 extends beyond North wall',
            ],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: {
        ...sampleScene,
        objects: [
          ...sampleScene.objects,
          { id: 'item-1', assetId: 'chair', name: 'Chair', position: [8.0, 0.4, 0.0], dimensions: [0.8, 0.8, 0.8], scale: [1, 1, 1], rotationEuler: [0, 0, 0] },
          { id: 'item-2', assetId: 'chair', name: 'Chair', position: [-8.0, 0.4, 0.0], dimensions: [0.8, 0.8, 0.8], scale: [1, 1, 1], rotationEuler: [0, 0, 0] },
          { id: 'item-3', assetId: 'chair', name: 'Chair', position: [0.0, 0.4, 8.0], dimensions: [0.8, 0.8, 0.8], scale: [1, 1, 1], rotationEuler: [0, 0, 0] },
        ],
      },
      budget_diff: {
        diff_paise: 300000,
        room_containment_valid: false,
        room_violations: [
          'item-1 extends beyond East wall',
          'item-2 extends beyond West wall',
          'item-3 extends beyond North wall',
        ],
      },
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add three items' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    // Crucial check: 3 violations in 1 continuous proposal must count as exactly 1 attempt!
    expect(session?.attemptedOutOfBoundsCount).toBe(1);
  });

  it('does not increment attemptedOutOfBoundsCount when AI proposal is within room bounds', async () => {
    saveActiveSession(createMockSession());

    // Valid proposal within room boundaries
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-valid-1',
        session: 'mock-agent-session-id',
        user_prompt: 'Add an armchair',
        status: 'proposed',
        ai_response_text: 'I placed a cozy armchair in the corner.',
        proposed_actions: [
          { name: 'add_furniture', parameters: { assetId: 'armchair-modern', position: [1.0, 0.4, 1.0] } },
        ],
        validation_results: {
          is_valid: true,
          errors: [],
          warnings: [],
          budget_diff: {
            diff_paise: 250000,
            room_containment_valid: true,
            room_violations: [],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: {
        ...sampleScene,
        objects: [
          ...sampleScene.objects,
          {
            id: 'armchair-1',
            assetId: 'armchair-modern',
            name: 'Armchair',
            position: [1.0, 0.4, 1.0],
            dimensions: [0.9, 0.8, 0.85],
            scale: [1, 1, 1],
            rotationEuler: [0, 0, 0],
          },
        ],
      },
      budget_diff: {
        diff_paise: 250000,
        room_containment_valid: true,
        room_violations: [],
      },
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add an armchair' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier3DomainValidCount).toBe(1);
    expect(session?.attemptedOutOfBoundsCount).toBe(0); // Valid proposal does NOT increment
  });

  it('does not treat non-boundary failures (e.g. budget exceeded) as boundary violations', async () => {
    saveActiveSession(createMockSession());

    // Proposal that fails budget validation but has valid room containment
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-budget-fail',
        session: 'mock-agent-session-id',
        user_prompt: 'Add expensive furniture',
        status: 'proposed',
        ai_response_text: 'Here is luxury furniture.',
        proposed_actions: [],
        validation_results: {
          is_valid: false,
          errors: ['Total cost exceeds remaining budget by ₹25,000.00'],
          warnings: [],
          budget_diff: {
            diff_paise: 10000000,
            room_containment_valid: true, // Containment is completely valid!
            room_violations: [],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: {
        ...sampleScene,
        objects: [
          ...sampleScene.objects,
          {
            id: 'expensive-sofa',
            assetId: 'sofa-luxury',
            name: 'Luxury Sofa',
            position: [0.0, 0.45, -0.5],
            dimensions: [2.2, 0.9, 0.95],
            scale: [1, 1, 1],
            rotationEuler: [0, 0, 0],
          },
        ],
      },
      budget_diff: {
        diff_paise: 10000000,
        room_containment_valid: true,
        room_violations: [],
      },
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add expensive furniture' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier1SuccessCount).toBe(1);
    // Non-boundary invalid proposal must NOT increment boundary attempts!
    expect(session?.attemptedOutOfBoundsCount).toBe(0);
  });
});
