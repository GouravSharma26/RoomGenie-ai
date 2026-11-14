// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiAgentDrawer } from '../../components/editor/AiAgentDrawer';
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
    submitCandidateFeedback: vi.fn().mockResolvedValue({ id: 'fb-1', status: 'recorded' }),
    getCandidateExplanation: vi.fn().mockResolvedValue({
      candidate_id: 'cand-1',
      label: 'Option A: Conversational',
      headline: 'Conversational Seating Arrangement with 98.5 Quality Score',
      why_recommended: [
        'Maintains uninterrupted transit route from entrance to seating',
        'Achieves 100% boundary containment and 0 collisions',
      ],
      key_metrics: {
        boundary_score: 100,
        collision_score: 100,
        circulation_score: 95,
        clearance_score: 100,
        utilization_score: 92,
        budget_score: 100,
        overall_score: 98.5,
        occupied_floor_pct: 22.4,
        open_floor_m2: 18.5,
        furniture_count: 3,
        door_clearance_min_m: 1.15,
      },
      alignment_reasons: ['Aligns with modern aesthetic'],
      trade_offs: ['Prioritizes social interaction over storage'],
      spatial_adjustments: [],
    }),
    refineCandidateLayout: vi.fn().mockResolvedValue({
      refined_candidates: [
        {
          id: 'cand-1-refined-A',
          schema_version: 1,
          label: 'Refined Option A',
          description: 'Adjusted coffee table forward 0.2m',
          reasoning_summary: 'Refined layout preserving sofa',
          proposed_actions: [],
          candidate_scene: {
            schemaVersion: 1,
            unit: 'm',
            room: { width: 5.0, length: 4.0, height: 2.8 },
            objects: [{ id: 'sofa-1', name: 'Modern Sofa', position: [0, 0, 0] }],
          },
          is_valid: true,
          is_approval_eligible: true,
          score: {
            boundary: 100,
            collision: 100,
            circulation: 95,
            clearance: 100,
            utilization: 94,
            budget: 100,
            overall: 99.0,
            weights: {},
          },
          validation_feedback: {
            is_valid: true,
            is_approval_eligible: true,
            has_collisions: false,
            has_boundary_breaches: false,
            is_budget_compliant: true,
            is_room_passable: true,
            fatal_errors: [],
            advisory_warnings: [],
            errors: [],
            warnings: [],
          },
        },
      ],
      refinement_request: {
        raw_prompt: 'Keep sofa, move table forward',
        intent_category: 'move_object',
        target_object_ids: ['table-1'],
        protected_object_ids: ['sofa-1'],
        is_ambiguous: false,
      },
      base_candidate_id: 'cand-1',
      count: 1,
    }),
  };
});

const initialScene = {
  schemaVersion: 1,
  unit: 'm',
  room: { width: 5.0, length: 4.0, height: 2.8 },
  objects: [],
  relationships: [],
};

const candidate1 = {
  id: 'cand-1',
  label: 'Option A: Conversational',
  description: 'Central arrangement',
  reasoning_summary: 'Sofa and table',
  is_valid: true,
  is_approval_eligible: true,
  score: {
    boundary: 100,
    collision: 100,
    circulation: 95,
    clearance: 100,
    utilization: 90,
    budget: 100,
    overall: 98.0,
    weights: {},
  },
  validation_feedback: {
    is_valid: true,
    is_approval_eligible: true,
    has_collisions: false,
    has_boundary_breaches: false,
    is_budget_compliant: true,
    is_room_passable: true,
    fatal_errors: [],
    advisory_warnings: [],
    errors: [],
    warnings: [],
  },
  proposed_actions: [],
  candidate_scene: {
    schemaVersion: 1,
    unit: 'm',
    room: { width: 5.0, length: 4.0, height: 2.8 },
    objects: [],
  },
};

const mockPromptResponse = {
  session_id: 'session-1',
  candidate_scene: candidate1.candidate_scene,
  budget_diff: {
    before_total_paise: 0,
    after_total_paise: 2999900,
    diff_paise: 2999900,
    room_containment_valid: true,
  },
  candidates: [candidate1],
  selected_candidate: candidate1,
  requires_approval: true,
  run: {
    id: 'run-1',
    session: 'session-1',
    user_prompt: 'Living room',
    status: 'proposed',
    ai_response_text: 'Generated proposal',
    proposed_actions: [],
    validation_results: {
      is_valid: true,
      candidates: [candidate1],
    },
  },
};

describe('Phase 7.3: Explainable, Feedback-Driven Spatial Design Refinement (Frontend)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'test-user', email: 'test@example.com', username: 'tester' } as any,
    });
    useEditorStore.setState({
      scene: JSON.parse(JSON.stringify(initialScene)),
    });
    usePreviewStore.getState().exitPreview();
  });

  it('submits candidate Like feedback when user clicks Like button', async () => {
    (agentApi.createAgentSession as any).mockResolvedValue({
      id: 'session-1',
      design: 'design-1',
    });
    (agentApi.sendAgentPrompt as any).mockResolvedValue(mockPromptResponse);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Design a living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
    });

    const likeBtn = screen.getByTestId('feedback-like-cand-1');
    expect(likeBtn).toBeInTheDocument();

    fireEvent.click(likeBtn);

    await waitFor(() => {
      expect(agentApi.submitCandidateFeedback).toHaveBeenCalledWith({
        run_id: 'run-1',
        candidate_id: 'cand-1',
        feedback_type: 'liked',
        structured_reasons: ['better_circulation'],
      });
    });
  });

  it('fetches and displays factual explanation when user clicks "Why this layout?"', async () => {
    (agentApi.createAgentSession as any).mockResolvedValue({
      id: 'session-1',
      design: 'design-1',
    });
    (agentApi.sendAgentPrompt as any).mockResolvedValue(mockPromptResponse);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Design a living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('toggle-explanation-cand-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('toggle-explanation-cand-1'));

    await waitFor(() => {
      expect(agentApi.getCandidateExplanation).toHaveBeenCalledWith('run-1', 'cand-1');
      expect(screen.getByText(/Conversational Seating Arrangement with 98.5 Quality Score/i)).toBeInTheDocument();
      expect(screen.getByText(/Maintains uninterrupted transit route/i)).toBeInTheDocument();
      expect(screen.getByText(/18.5 m²/i)).toBeInTheDocument();
    });
  });

  it('executes bounded conversational refinement and updates candidate preview', async () => {
    (agentApi.createAgentSession as any).mockResolvedValue({
      id: 'session-1',
      design: 'design-1',
    });
    (agentApi.sendAgentPrompt as any).mockResolvedValue(mockPromptResponse);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Design a living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('refinement-input-cand-1')).toBeInTheDocument();
    });

    const refineInput = screen.getByTestId('refinement-input-cand-1');
    fireEvent.change(refineInput, { target: { value: 'Keep sofa, move table forward' } });

    const refineBtn = screen.getByTestId('refine-btn-cand-1');
    fireEvent.click(refineBtn);

    await waitFor(() => {
      expect(agentApi.refineCandidateLayout).toHaveBeenCalledWith('run-1', 'cand-1', 'Keep sofa, move table forward');
      expect(screen.getByText(/Refined into 1 options/i)).toBeInTheDocument();
    });
  });
});
