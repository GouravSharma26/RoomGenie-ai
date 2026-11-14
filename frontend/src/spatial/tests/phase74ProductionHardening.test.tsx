// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiAgentDrawer } from '../../components/editor/AiAgentDrawer';
import { CandidateComparisonModal } from '../../components/editor/CandidateComparisonModal';
import * as agentApi from '../../services/agentApi';
import { usePreviewStore } from '../../editor3d/store/previewStore';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { useAuthStore } from '../../services/authStore';

vi.mock('../../services/agentApi', async () => {
  const actual = await vi.importActual('../../services/agentApi');
  return {
    ...actual,
    createAgentSession: vi.fn(),
    sendAgentPrompt: vi.fn(),
    applyAgentRun: vi.fn(),
    rejectAgentRun: vi.fn(),
    fetchUserPreferences: vi.fn().mockResolvedValue({}),
    saveUserPreferences: vi.fn().mockResolvedValue({}),
    resetUserPreferences: vi.fn().mockResolvedValue({}),
    submitCandidateFeedback: vi.fn().mockResolvedValue({ id: 'fb-hardened-1', status: 'recorded' }),
    getCandidateExplanation: vi.fn().mockResolvedValue({
      candidate_id: 'cand-hardened-1',
      label: 'Option A: Hardened Layout',
      headline: 'Ranked #1 of 3 candidates with an overall score of 98.2/100',
      why_recommended: [
        'Clear circulation: walking score of 95.0/100 guarantees wide transit routes.',
        'Optimal clearance: score of 100.0/100 maintains comfortable margins around key furniture.',
        'Balanced density: space utilization score of 91.5/100 avoids overcrowding.',
      ],
      key_metrics: {
        boundary_score: 100,
        collision_score: 100,
        circulation_score: 95,
        clearance_score: 100,
        utilization_score: 92,
        budget_score: 100,
        overall_score: 98.2,
        occupied_floor_pct: 12.5,
        open_floor_m2: 17.5,
        furniture_count: 3,
        door_clearance_min_m: 0.95,
      },
      alignment_reasons: ['Aligns with spacious open-concept preferences'],
      trade_offs: ['Balanced compromise between transit circulation and furniture capacity.'],
      spatial_adjustments: [],
    }),
    refineCandidateLayout: vi.fn().mockImplementation((_runId, _candId, prompt) => {
      if (prompt.toLowerCase().includes('that thing') || prompt.toLowerCase().includes('something')) {
        return Promise.resolve({
          is_ambiguous: true,
          ambiguity_reason: "Could not determine specific items or spatial properties to refine.",
          refinement_request: {
            intent_category: 'infeasible_protection',
            target_object_ids: [],
            protected_object_ids: [],
            is_ambiguous: true,
          },
          refined_candidates: [],
          count: 0,
        });
      }
      return Promise.resolve({
        is_ambiguous: false,
        base_candidate_id: 'cand-hardened-1',
        refinement_request: {
          intent_category: 'spatial_adjustment',
          target_object_ids: ['table-1'],
          protected_object_ids: ['sofa-1'],
          is_ambiguous: false,
        },
        refined_candidates: [
          {
            id: 'cand-hardened-refined-1',
            schema_version: 1,
            label: 'Refined Option A',
            description: 'Moved coffee table forward 0.2m while protecting sofa',
            reasoning_summary: 'Targeted spatial adjustment preserving protected objects',
            proposed_actions: [
              {
                type: 'move_object',
                parameters: { object_id: 'table-1', position: [0, 0, 1.2] },
              },
            ],
            candidate_scene: {
              schemaVersion: 1,
              unit: 'm',
              room: { width: 5.0, length: 4.0, height: 2.8 },
              objects: [
                { id: 'sofa-1', name: 'Sofa', position: [0, 0, 0], scale: [1, 1, 1], dimensions: [2.0, 0.85, 0.9] },
                { id: 'table-1', name: 'Coffee Table', position: [0, 0, 1.2], scale: [1, 1, 1], dimensions: [1.2, 0.45, 0.6] },
              ],
            },
            is_valid: true,
            is_approval_eligible: true,
            score: {
              boundary: 100,
              collision: 100,
              circulation: 96,
              clearance: 100,
              utilization: 93,
              budget: 100,
              overall: 98.8,
              weights: {},
            },
            validation_feedback: {
              is_valid: true,
              is_approval_eligible: true,
              has_collisions: false,
              has_boundary_breaches: false,
              is_budget_compliant: true,
              is_room_passable: true,
              errors: [],
              warnings: [],
            },
            optimization_metadata: {
              iterations: 12,
              durationMs: 8.5,
              repaired: true,
              scoreDelta: +0.6,
              bestBadge: 'Best Clearance',
            },
          },
        ],
        count: 1,
      });
    }),
  };
});

describe('Phase 7.4 Production Hardening & Spatial AI Integrity', () => {
  const mockCandidates = [
    {
      id: 'cand-hardened-1',
      schema_version: 1,
      label: 'Option A: Balanced & Functional',
      description: 'Ergonomic spacing and balanced clearances',
      reasoning_summary: 'Optimized living arrangement',
      proposed_actions: [
        {
          type: 'add_furniture',
          parameters: { asset_id: 'sofa-nordic', position: [0, 0, 0] },
        },
      ],
      candidate_scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [{ id: 'sofa-1', name: 'Sofa', position: [0, 0, 0], scale: [1, 1, 1], dimensions: [2, 0.85, 0.9] }],
      },
      is_valid: true,
      is_approval_eligible: true,
      score: {
        boundary: 100,
        collision: 100,
        circulation: 95,
        clearance: 100,
        utilization: 92,
        budget: 100,
        overall: 98.2,
        weights: {},
      },
      validation_feedback: {
        is_valid: true,
        is_approval_eligible: true,
        has_collisions: false,
        has_boundary_breaches: false,
        is_budget_compliant: true,
        is_room_passable: true,
        errors: [],
        warnings: [],
      },
      optimization_metadata: {
        iterations: 15,
        durationMs: 12.0,
        repaired: false,
        scoreDelta: 0.0,
        bestBadge: 'Best Overall',
      },
    },
    {
      id: 'cand-hardened-2',
      schema_version: 1,
      label: 'Option B: Open Circulation',
      description: 'Maximum pathway clearance',
      reasoning_summary: 'Prioritizes perimeter placement',
      proposed_actions: [],
      candidate_scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [{ id: 'sofa-1', name: 'Sofa', position: [-1.2, 0, 0], scale: [1, 1, 1], dimensions: [2, 0.85, 0.9] }],
      },
      is_valid: true,
      is_approval_eligible: true,
      score: {
        boundary: 100,
        collision: 100,
        circulation: 98,
        clearance: 95,
        utilization: 88,
        budget: 100,
        overall: 97.4,
        weights: {},
      },
      validation_feedback: {
        is_valid: true,
        is_approval_eligible: true,
        has_collisions: false,
        has_boundary_breaches: false,
        is_budget_compliant: true,
        is_room_passable: true,
        errors: [],
        warnings: [],
      },
      optimization_metadata: {
        iterations: 15,
        durationMs: 11.5,
        repaired: false,
        scoreDelta: 0.0,
        bestBadge: 'Best Circulation',
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      token: 'fake-hardened-token',
      user: { id: 1, username: 'tester', email: 'test@example.com' } as any,
    });
    useEditorStore.setState({
      scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [],
        relationships: [],
      },
    });
    usePreviewStore.getState().exitPreview();
    vi.mocked(agentApi.createAgentSession).mockResolvedValue({
      id: 'sess-1',
      design: 'design-1',
    } as any);
  });

  const mockPromptResponse = {
    session_id: 'sess-1',
    candidate_scene: mockCandidates[0].candidate_scene,
    budget_diff: {
      before_total_paise: 0,
      after_total_paise: 2999900,
      diff_paise: 2999900,
      room_containment_valid: true,
    },
    candidates: mockCandidates,
    selected_candidate: mockCandidates[0],
    requires_approval: true,
    run: {
      id: 'run-hardened-1',
      session: 'sess-1',
      user_prompt: 'Arrange living area',
      status: 'proposed',
      ai_response_text: 'Generated proposal',
      proposed_actions: mockCandidates[0].proposed_actions,
      validation_results: {
        is_valid: true,
        candidates: mockCandidates,
      },
    },
  };

  it('1. Renders multi-candidate selection cards with transparent score breakdowns', async () => {
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce(mockPromptResponse as any);

    render(<AiAgentDrawer isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living area' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
      expect(screen.getAllByText(/Option A: Balanced & Functional/i).length).toBeGreaterThan(0);
    });

    // Verify 6-component score labels
    expect(screen.getByText(/Boundary \(25%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Collision \(25%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Circulation \(20%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Clearances \(15%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Utilization \(10%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Budget \(5%\)/i)).toBeInTheDocument();
  });

  it('2. Expands evidence-based explainability panel with factual numerical metrics', async () => {
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce(mockPromptResponse as any);

    render(<AiAgentDrawer isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living area' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('toggle-explanation-cand-hardened-1')).toBeInTheDocument();
    });

    // Expand explanation
    fireEvent.click(screen.getByTestId('toggle-explanation-cand-hardened-1'));

    await waitFor(() => {
      expect(agentApi.getCandidateExplanation).toHaveBeenCalledWith('run-hardened-1', 'cand-hardened-1');
      expect(screen.getByText(/Ranked #1 of 3 candidates with an overall score of 98.2\/100/i)).toBeInTheDocument();
      expect(screen.getByText(/17.5 m²/i)).toBeInTheDocument();
      expect(screen.getByText(/12.5%/i)).toBeInTheDocument();
    });
  });

  it('3. Safely detects and reports ambiguous refinement instructions', async () => {
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce(mockPromptResponse as any);

    render(<AiAgentDrawer isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living area' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('refinement-input-cand-hardened-1')).toBeInTheDocument();
    });

    // Submit ambiguous refinement
    const refineInput = screen.getByTestId('refinement-input-cand-hardened-1');
    fireEvent.change(refineInput, { target: { value: 'Move that thing somewhere' } });
    fireEvent.click(screen.getByTestId('refine-btn-cand-hardened-1'));

    await waitFor(() => {
      expect(screen.getByTestId('refinement-status-cand-hardened-1')).toBeInTheDocument();
      expect(screen.getByText(/Ambiguous instruction/i)).toBeInTheDocument();
    });
  });

  it('4. Handles structured candidate feedback submission', async () => {
    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce(mockPromptResponse as any);

    render(<AiAgentDrawer isOpen={true} onClose={vi.fn()} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living area' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-like-cand-hardened-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feedback-like-cand-hardened-1'));

    await waitFor(() => {
      expect(agentApi.submitCandidateFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          run_id: 'run-hardened-1',
          candidate_id: 'cand-hardened-1',
          feedback_type: 'liked',
        })
      );
    });
  });

  it('5. Renders candidate pairwise comparison modal with metrics', () => {
    usePreviewStore.setState({
      comparisonOpen: true,
      allCandidates: mockCandidates as any,
      activeCandidateId: 'cand-hardened-1',
    });

    render(
      <CandidateComparisonModal
        candidates={mockCandidates as any}
        onApplyCandidate={vi.fn()}
      />
    );

    expect(screen.getByText(/Compare Layout Candidates \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Option A: Balanced & Functional/i)).toBeInTheDocument();
    expect(screen.getByText(/Option B: Open Circulation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/6-Component Scores/i).length).toBe(2);
  });
});
