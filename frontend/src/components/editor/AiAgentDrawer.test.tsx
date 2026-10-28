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
import { useAuthStore } from '../../services/authStore';

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

    useAuthStore.setState({
      isAuthenticated: true,
      token: 'mock-agent-test-token',
      user: { id: 1, username: 'testuser', email: 'test@example.com' },
    });

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
    expect(session?.agentTier2SchemaValidCount).toBe(1); // Tool action adhered to allowlisted schema
    expect(session?.agentTier3DomainValidCount).toBe(0); // Room containment violated
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
          schema_valid: true,
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
    expect(session?.agentTier1SuccessCount).toBe(1);
    expect(session?.agentTier2SchemaValidCount).toBe(1); // Tool action schema valid
    expect(session?.agentTier3DomainValidCount).toBe(0); // Room containment violated
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
          schema_valid: true,
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
    expect(session?.agentTier1SuccessCount).toBe(1);
    expect(session?.agentTier2SchemaValidCount).toBe(1); // Tool action schema valid
    expect(session?.agentTier3DomainValidCount).toBe(1); // Room containment valid
    expect(session?.attemptedOutOfBoundsCount).toBe(0); // Valid proposal does NOT increment
  });

  it('does not treat non-boundary failures (e.g. budget exceeded) as boundary violations and correctly classifies Tier 2 and Tier 3', async () => {
    saveActiveSession(createMockSession());

    // Proposal that fails budget validation but has valid room containment and valid tool schema
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
          schema_valid: true,
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
    // Tier 2: LLM tool call followed allowlisted action signatures and parameter types
    expect(session?.agentTier2SchemaValidCount).toBe(1);
    // Tier 3: Proposed furniture layout passes room boundary containment checks
    expect(session?.agentTier3DomainValidCount).toBe(1);
    // Boundary counter: Budget exceedance is not a boundary violation!
    expect(session?.attemptedOutOfBoundsCount).toBe(0);
  });

  it('correctly marks Tier 2 invalid when tool call violates schema without incrementing boundary counter', async () => {
    saveActiveSession(createMockSession());

    // Proposal where tool call fails allowlisted action schema validation
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-schema-fail',
        session: 'mock-agent-session-id',
        user_prompt: 'Run arbitrary operation',
        status: 'proposed',
        ai_response_text: 'I attempted an operation.',
        proposed_actions: [],
        validation_results: {
          is_valid: false,
          schema_valid: false,
          schema_errors: ["Action [0] 'execute_arbitrary_shell_command' is not an allowlisted operation."],
          errors: ["Action [0] 'execute_arbitrary_shell_command' is not an allowlisted operation."],
          warnings: [],
          budget_diff: {
            diff_paise: 0,
            room_containment_valid: true,
            room_violations: [],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: sampleScene,
      budget_diff: {
        diff_paise: 0,
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
    fireEvent.change(input, { target: { value: 'Run arbitrary operation' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier1SuccessCount).toBe(1);
    // Tier 2: Failed schema validation
    expect(session?.agentTier2SchemaValidCount).toBe(0);
    // Boundary counter: Schema violation is not a boundary clamp clash
    expect(session?.attemptedOutOfBoundsCount).toBe(0);
  });

  it('marks Tier 2 valid but execution invalid on missing catalogue asset without incrementing boundary counter', async () => {
    saveActiveSession(createMockSession());

    // Proposal where tool call adheres to action signature & parameter types,
    // but the referenced catalogue asset does not exist.
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-missing-asset',
        session: 'mock-agent-session-id',
        user_prompt: 'Add missing chair',
        status: 'proposed',
        ai_response_text: 'I attempted to add a missing chair.',
        proposed_actions: [
          { name: 'add_furniture', parameters: { asset_id: 'nonexistent-uuid', position: [0.0, 0.44, 0.0] } },
        ],
        validation_results: {
          is_valid: false,
          schema_valid: true,
          reference_valid: false,
          domain_valid: true,
          budget_valid: true,
          schema_errors: [],
          reference_errors: ["Action [0]: Asset 'nonexistent-uuid' does not exist in catalogue or is inactive."],
          domain_errors: [],
          budget_errors: [],
          errors: ["Action [0]: Asset 'nonexistent-uuid' does not exist in catalogue or is inactive."],
          warnings: [],
          budget_diff: {
            diff_paise: 0,
            room_containment_valid: true,
            room_violations: [],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: sampleScene,
      budget_diff: {
        diff_paise: 0,
        room_containment_valid: true,
        room_violations: [],
      },
      schema_valid: true,
      reference_valid: false,
      domain_valid: true,
      budget_valid: true,
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add missing chair' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier1SuccessCount).toBe(1);
    // Tier 2: Valid schema (syntactic tool contract met)
    expect(session?.agentTier2SchemaValidCount).toBe(1);
    // Tier 3: Room containment valid
    expect(session?.agentTier3DomainValidCount).toBe(1);
    // Boundary counter must NEVER increment for reference resolution failure
    expect(session?.attemptedOutOfBoundsCount).toBe(0);

    // Proposal errors must be visible in UI
    expect(screen.getByText(/Asset 'nonexistent-uuid' does not exist in catalogue/i)).toBeInTheDocument();
  });

  it('marks Tier 2 valid but execution invalid on nonexistent scene object without incrementing boundary counter', async () => {
    saveActiveSession(createMockSession());

    // Proposal where move_object has valid parameter types, but object_id does not exist in the scene.
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-missing-object',
        session: 'mock-agent-session-id',
        user_prompt: 'Move missing chair',
        status: 'proposed',
        ai_response_text: 'I attempted to move a chair that is not in the room.',
        proposed_actions: [
          { name: 'move_object', parameters: { object_id: 'ghost-item-1', position: [1.0, 0.44, 1.0] } },
        ],
        validation_results: {
          is_valid: false,
          schema_valid: true,
          reference_valid: false,
          domain_valid: true,
          budget_valid: true,
          schema_errors: [],
          reference_errors: ["Action [0]: Object 'ghost-item-1' not found in scene."],
          domain_errors: [],
          budget_errors: [],
          errors: ["Action [0]: Object 'ghost-item-1' not found in scene."],
          warnings: [],
          budget_diff: {
            diff_paise: 0,
            room_containment_valid: true,
            room_violations: [],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: sampleScene,
      budget_diff: {
        diff_paise: 0,
        room_containment_valid: true,
        room_violations: [],
      },
      schema_valid: true,
      reference_valid: false,
      domain_valid: true,
      budget_valid: true,
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Move missing chair' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier1SuccessCount).toBe(1);
    // Tier 2: Valid schema
    expect(session?.agentTier2SchemaValidCount).toBe(1);
    // Tier 3: Room containment valid
    expect(session?.agentTier3DomainValidCount).toBe(1);
    // Boundary counter must NEVER increment for nonexistent object failure
    expect(session?.attemptedOutOfBoundsCount).toBe(0);

    // Proposal errors must be visible in UI
    expect(screen.getByText(/Object 'ghost-item-1' not found in scene/i)).toBeInTheDocument();
  });

  it('marks Tier 2 invalid on malformed vector parameter type without incrementing boundary counter', async () => {
    saveActiveSession(createMockSession());

    // Proposal with malformed position vector
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-malformed-vec',
        session: 'mock-agent-session-id',
        user_prompt: 'Add chair with bad vector',
        status: 'proposed',
        ai_response_text: 'Adding chair with bad vector.',
        proposed_actions: [],
        validation_results: {
          is_valid: false,
          schema_valid: false,
          reference_valid: true,
          domain_valid: true,
          budget_valid: true,
          schema_errors: ['Action [0]: Invalid position vector: expected 3-element numeric array.'],
          reference_errors: [],
          domain_errors: [],
          budget_errors: [],
          errors: ['Action [0]: Invalid position vector: expected 3-element numeric array.'],
          warnings: [],
          budget_diff: {
            diff_paise: 0,
            room_containment_valid: true,
            room_violations: [],
          },
        },
        provider_metadata: { provider: 'mock', model: 'mock-model', latency_ms: 100 },
        created_at: new Date().toISOString(),
      },
      candidate_scene: sampleScene,
      budget_diff: {
        diff_paise: 0,
        room_containment_valid: true,
        room_violations: [],
      },
      schema_valid: false,
      requires_approval: true,
    });

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add chair with bad vector' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
    });

    const session = getActiveSession();
    expect(session?.agentProposalsCount).toBe(1);
    expect(session?.agentTier1SuccessCount).toBe(1);
    // Tier 2: Invalid due to malformed parameter vector
    expect(session?.agentTier2SchemaValidCount).toBe(0);
    // Boundary counter must NOT increment
    expect(session?.attemptedOutOfBoundsCount).toBe(0);
  });
});
