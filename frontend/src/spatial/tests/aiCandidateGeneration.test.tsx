import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiAgentDrawer } from '../../components/editor/AiAgentDrawer';
import * as agentApi from '../../services/agentApi';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { useAuthStore } from '../../services/authStore';
import type { LayoutCandidateRecord } from '../../services/agentApi';
import type { CanonicalScene } from '../../types/scene';

vi.mock('../../services/agentApi', async () => {
  const actual = await vi.importActual<typeof import('../../services/agentApi')>('../../services/agentApi');
  return {
    ...actual,
    createAgentSession: vi.fn(),
    sendAgentPrompt: vi.fn(),
    applyAgentRun: vi.fn(),
    rejectAgentRun: vi.fn(),
  };
});

describe('Phase 6.3 — Multi-Candidate Layout Generation & Deterministic Scoring (Frontend)', () => {
  const initialScene: CanonicalScene = {
    schemaVersion: 1,
    unit: 'm',
    room: {
      width: 5.0,
      length: 4.0,
      height: 2.8,
    },
    objects: [
      {
        id: 'sofa-base-1',
        assetId: 'sofa-modern-3seater',
        name: 'Modern 3-Seater Sofa',
        position: [0.0, 0.425, -1.0],
        rotationEuler: [0.0, 0.0, 0.0],
        scale: [1.0, 1.0, 1.0],
        dimensions: [2.10, 0.85, 0.90],
      },
    ],
    relationships: [],
  };

  const candidateA: LayoutCandidateRecord = {
    id: 'cand-opt-a',
    schema_version: 1,
    label: 'Option A (Rank #1)',
    description: 'Conversational living zone with central coffee table and accent armchair.',
    reasoning_summary: 'Optimized for balanced circulation and socket attachments.',
    intent: 'Balanced Living',
    rank: 1,
    is_valid: true,
    is_approval_eligible: true,
    trade_offs: [
      'Prioritizes generous social seating with slightly reduced open floor space',
      'Preserves clear 1.2m entrance walkway',
    ],
    score: {
      overall: 88.5,
      boundary: 100.0,
      collision: 100.0,
      circulation: 85.0,
      clearance: 90.0,
      utilization: 75.0,
      budget: 95.0,
      weights: {
        boundary: 0.25,
        collision: 0.25,
        circulation: 0.20,
        clearance: 0.15,
        utilization: 0.10,
        budget: 0.05,
      },
    },
    validation_feedback: {
      is_valid: true,
      is_approval_eligible: true,
      has_collisions: false,
      has_boundary_breaches: false,
      is_budget_compliant: true,
      is_room_passable: true,
      fatal_errors: [],
      advisory_warnings: [
        {
          code: 'advisory_clearance',
          message: 'Minor clearance advisory: 0.55m to coffee table edge.',
          severity: 'warning',
        },
      ],
      errors: [],
      warnings: ['Minor clearance advisory: 0.55m to coffee table edge.'],
    },
    proposed_actions: [
      {
        name: 'attach_to_socket',
        parameters: {
          anchor_object_id: 'sofa-base-1',
          child_object_id: 'table-coffee-1',
          socket_id: 'sofa-front-coffee-table',
          gap_meters: 0.55,
        },
      },
    ],
    candidate_scene: {
      ...initialScene,
      objects: [
        ...initialScene.objects,
        {
          id: 'table-coffee-1',
          assetId: 'table-oak-coffee',
          name: 'Oak Coffee Table',
          position: [0.0, 0.225, 0.0],
          rotationEuler: [0.0, 0.0, 0.0],
          scale: [1.0, 1.0, 1.0],
          dimensions: [1.10, 0.45, 0.60],
        },
      ],
    },
    budget_diff: {
      before_total_paise: 4500000,
      after_total_paise: 6200000,
      diff_paise: 1700000,
      before_total_inr: '45,000',
      after_total_inr: '62,000',
      diff_inr: '17,000',
      room_containment_valid: true,
    },
  };

  const candidateB: LayoutCandidateRecord = {
    id: 'cand-opt-b',
    schema_version: 1,
    label: 'Option B (Rank #2)',
    description: 'Compact corner reading arrangement maximizing central floor space.',
    reasoning_summary: 'High floor utilization with accent chair near window.',
    intent: 'Max Open Space',
    rank: 2,
    is_valid: true,
    is_approval_eligible: true,
    trade_offs: [
      'Maximizes open center floor space',
      'Single seating position without dedicated coffee table',
    ],
    score: {
      overall: 82.0,
      boundary: 100.0,
      collision: 100.0,
      circulation: 92.0,
      clearance: 80.0,
      utilization: 55.0,
      budget: 100.0,
      weights: {
        boundary: 0.25,
        collision: 0.25,
        circulation: 0.20,
        clearance: 0.15,
        utilization: 0.10,
        budget: 0.05,
      },
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
    proposed_actions: [
      {
        name: 'add_furniture',
        parameters: {
          asset_id: 'chair-accent-armchair',
          position: [1.5, 0.44, -1.0],
          rotation_y: 0.0,
        },
      },
    ],
    candidate_scene: {
      ...initialScene,
      objects: [
        ...initialScene.objects,
        {
          id: 'chair-accent-armchair-1',
          assetId: 'chair-accent-armchair',
          name: 'Accent Armchair',
          position: [1.5, 0.44, -1.0],
          rotationEuler: [0.0, 0.0, 0.0],
          scale: [1.0, 1.0, 1.0],
          dimensions: [0.85, 0.88, 0.85],
        },
      ],
    },
    budget_diff: {
      before_total_paise: 4500000,
      after_total_paise: 5400000,
      diff_paise: 900000,
      before_total_inr: '45,000',
      after_total_inr: '54,000',
      diff_inr: '9,000',
      room_containment_valid: true,
    },
  };

  const candidateC: LayoutCandidateRecord = {
    id: 'cand-opt-c',
    schema_version: 1,
    label: 'Option C (Rank #3)',
    description: 'Over-dense layout with boundary encroachment.',
    reasoning_summary: 'Failed boundary containment check.',
    intent: 'Boundary Violation Failure',
    rank: 3,
    is_valid: false,
    is_approval_eligible: false,
    trade_offs: [
      'Excessive item count causes perimeter protrusion',
    ],
    score: {
      overall: 0.0,
      boundary: 0.0,
      collision: 100.0,
      circulation: 40.0,
      clearance: 60.0,
      utilization: 80.0,
      budget: 100.0,
      weights: {
        boundary: 0.25,
        collision: 0.25,
        circulation: 0.20,
        clearance: 0.15,
        utilization: 0.10,
        budget: 0.05,
      },
    },
    validation_feedback: {
      is_valid: false,
      is_approval_eligible: false,
      has_collisions: false,
      has_boundary_breaches: true,
      is_budget_compliant: true,
      is_room_passable: false,
      fatal_errors: [
        {
          code: 'boundary_violation',
          message: 'Critical error: Cabinet protrudes 0.25m outside north wall boundary.',
          severity: 'fatal',
        },
      ],
      advisory_warnings: [],
      errors: ['Critical error: Cabinet protrudes 0.25m outside north wall boundary.'],
      warnings: [],
    },
    proposed_actions: [
      {
        name: 'add_furniture',
        parameters: {
          asset_id: 'cabinet-tall-storage',
          position: [0.0, 0.9, 2.3],
          rotation_y: 0.0,
        },
      },
    ],
    candidate_scene: initialScene,
    budget_diff: {
      before_total_paise: 4500000,
      after_total_paise: 7500000,
      diff_paise: 3000000,
      room_containment_valid: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'test-user', email: 'test@example.com', username: 'tester' } as any,
    });
    useEditorStore.setState({
      scene: JSON.parse(JSON.stringify(initialScene)),
    });

    vi.mocked(agentApi.createAgentSession).mockResolvedValue({
      id: 'session-multi-1',
      title: 'Multi-Candidate Session',
      owner_username: 'tester',
      design: null,
      created_at: '2026-11-14T08:00:00Z',
      updated_at: '2026-11-14T08:00:00Z',
    });

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValue({
      run: {
        id: 'run-multi-1',
        session: 'session-multi-1',
        user_prompt: 'Arrange living room seating',
        status: 'proposed',
        ai_response_text: 'I have generated 3 candidate layouts evaluated with deterministic scoring.',
        proposed_actions: candidateA.proposed_actions,
        validation_results: {
          is_valid: true,
          errors: [],
          warnings: ['Minor clearance advisory: 0.55m to coffee table edge.'],
          budget_diff: candidateA.budget_diff!,
          candidates: [candidateA, candidateB, candidateC],
        },
        provider_metadata: {
          provider: 'mock',
          model: 'mock-spatial-planner',
          latency_ms: 12,
        },
        created_at: '2026-11-14T08:00:00Z',
      },
      candidate_scene: candidateA.candidate_scene,
      budget_diff: candidateA.budget_diff!,
      candidates: [candidateA, candidateB, candidateC],
      selected_candidate: candidateA,
      requires_approval: true,
    });
  });

  it('renders multi-candidate selector tabs with scores, ranks, and validity dots', async () => {
    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-selection-section')).toBeInTheDocument();
      expect(screen.getByText('Layout Candidates (3)')).toBeInTheDocument();
    });

    // Check candidate tabs
    expect(screen.getByTestId('candidate-tab-cand-opt-a')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-tab-cand-opt-b')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-tab-cand-opt-c')).toBeInTheDocument();

    // Check Option A (default selected) in active candidate card
    expect(screen.getByTestId('active-candidate-card')).toHaveTextContent('Option A (Rank #1)');
    expect(screen.getByTestId('active-candidate-card')).toHaveTextContent('88.5 / 100');
  });

  it('displays the 6-component score breakdown with exact canonical categories', async () => {
    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByText('Deterministic Score Breakdown')).toBeInTheDocument();
    });

    // 6 Canonical dimensions: Boundary (25%), Collision (25%), Circulation (20%), Clearances (15%), Utilization (10%), Budget (5%)
    expect(screen.getByText('Boundary (25%)')).toBeInTheDocument();
    expect(screen.getByText('Collision (25%)')).toBeInTheDocument();
    expect(screen.getByText('Circulation (20%)')).toBeInTheDocument();
    expect(screen.getByText('Clearances (15%)')).toBeInTheDocument();
    expect(screen.getByText('Utilization (10%)')).toBeInTheDocument();
    expect(screen.getByText('Budget (5%)')).toBeInTheDocument();
  });

  it('allows user to switch between candidates and updates displayed score and trade-offs', async () => {
    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-tab-cand-opt-b')).toBeInTheDocument();
    });

    // Initially Option A is selected
    expect(screen.getByText('88.5 / 100')).toBeInTheDocument();
    expect(screen.getByText('• Preserves clear 1.2m entrance walkway')).toBeInTheDocument();

    // Click on Option B
    fireEvent.click(screen.getByTestId('candidate-tab-cand-opt-b'));

    // Option B details become active
    await waitFor(() => {
      expect(screen.getByText('82.0 / 100')).toBeInTheDocument();
      expect(screen.getByText('• Maximizes open center floor space')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Approve Option B \(Rank #2\)/i })).toBeInTheDocument();
    });
  });

  it('disables approval button and shows hard constraint failure for invalid candidate', async () => {
    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-tab-cand-opt-c')).toBeInTheDocument();
    });

    // Click Option C (invalid candidate with boundary breach)
    fireEvent.click(screen.getByTestId('candidate-tab-cand-opt-c'));

    await waitFor(() => {
      expect(screen.getByText('0.0 / 100')).toBeInTheDocument();
      expect(screen.getByText('Hard Failure')).toBeInTheDocument();
      expect(screen.getByTestId('fatal-issues-block')).toBeInTheDocument();
      expect(screen.getByText(/Critical error: Cabinet protrudes 0.25m outside north wall boundary/i)).toBeInTheDocument();
    });

    // Verify approval button is disabled
    const approveBtn = screen.getByTestId('apply-proposal-btn');
    expect(approveBtn).toBeDisabled();
  });

  it('applies the specifically selected candidate when user approves', async () => {
    vi.mocked(agentApi.applyAgentRun).mockResolvedValue({
      detail: 'Candidate Option B applied successfully.',
      run: {
        id: 'run-multi-1',
        session: 'session-multi-1',
        user_prompt: 'Arrange living room',
        status: 'approved',
        ai_response_text: 'Done',
        proposed_actions: candidateB.proposed_actions,
        validation_results: {
          is_valid: true,
          errors: [],
          warnings: [],
          budget_diff: candidateB.budget_diff!,
        },
        provider_metadata: { provider: 'mock', model: 'mock' },
        created_at: '2026-11-14T08:00:00Z',
      },
      applied_scene: candidateB.candidate_scene,
      budget_diff: candidateB.budget_diff!,
    });

    const onSceneApplied = vi.fn();
    render(<AiAgentDrawer isOpen={true} onClose={() => {}} onSceneApplied={onSceneApplied} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-tab-cand-opt-b')).toBeInTheDocument();
    });

    // Switch to Option B
    fireEvent.click(screen.getByTestId('candidate-tab-cand-opt-b'));

    // Approve Option B
    const approveBtn = screen.getByRole('button', { name: /Approve Option B \(Rank #2\)/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(agentApi.applyAgentRun).toHaveBeenCalledWith('run-multi-1', expect.anything(), 'cand-opt-b');
      expect(onSceneApplied).toHaveBeenCalledWith(candidateB.candidate_scene);
    });
  });

  it('leaves the canonical 3D scene untouched until explicit user approval', async () => {
    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange living room' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-selection-section')).toBeInTheDocument();
    });

    // Canonical scene in editor store must still have only 1 object (the initial sofa)
    const storeObjects = useEditorStore.getState().scene.objects;
    expect(storeObjects.length).toBe(1);
    expect(storeObjects[0].id).toBe('sofa-base-1');
  });
});
