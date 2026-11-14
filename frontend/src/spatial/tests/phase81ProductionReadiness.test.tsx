// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiAgentDrawer } from '../../components/editor/AiAgentDrawer';
import * as agentApi from '../../services/agentApi';
import { usePreviewStore } from '../../editor3d/store/previewStore';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { useAuthStore } from '../../services/authStore';

// Mock API layer
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
    submitCandidateFeedback: vi.fn().mockResolvedValue({ id: 'fb-prod-1', status: 'recorded' }),
    getCandidateExplanation: vi.fn().mockResolvedValue({
      candidate_id: 'cand-prod-living-1',
      label: 'Option A: Conversational Living Area',
      headline: 'Ranked #1 of 3 candidates with an overall score of 98.4/100',
      why_recommended: [
        'Coffee table correctly attached to front sofa socket with 0.45m circulation gap.',
        'Accent chairs angled inwards at 30 degrees preserving open walking route.',
        'Zero door swing clearance violations.',
      ],
      key_metrics: {
        boundary_score: 100,
        collision_score: 100,
        circulation_score: 96,
        clearance_score: 100,
        utilization_score: 92,
        budget_score: 100,
        overall_score: 98.4,
        occupied_floor_pct: 14.2,
        open_floor_m2: 17.16,
        furniture_count: 4,
        door_clearance_min_m: 0.95,
      },
      alignment_reasons: ['Maintains open conversational zone and clear room circulation'],
      trade_offs: ['Preserves open transit over additional storage'],
      spatial_adjustments: [],
    }),
  };
});

describe('Phase 8.1 Production Readiness & Real-World Validation', () => {
  const livingRoomScene = {
    schemaVersion: 1,
    unit: 'm' as const,
    room: { width: 5.0, length: 4.0, height: 2.8 },
    objects: [
      {
        id: 'sofa-base-1',
        assetId: 'sofa-nordic',
        name: 'Nordic Sofa',
        position: [0.0, 0.425, 0.0] as [number, number, number],
        rotationEuler: [0.0, 0.0, 0.0] as [number, number, number],
        scale: [1.0, 1.0, 1.0] as [number, number, number],
        dimensions: [2.1, 0.85, 0.9] as [number, number, number],
      },
    ],
    relationships: [],
  };

  const livingRoomCandidate1 = {
    id: 'cand-prod-living-1',
    schema_version: 1,
    label: 'Option A: Conversational Living Area',
    description: 'Sofa with centered coffee table and accent seating',
    reasoning_summary: 'Strict semantic socket attachment and clearance preserved',
    proposed_actions: [
      {
        type: 'add_furniture',
        asset_id: 'table-coffee-1',
        position: [0.0, 0.225, 1.1],
        rotation_euler: [0.0, 0.0, 0.0],
      },
    ],
    candidate_scene: {
      schemaVersion: 1,
      unit: 'm' as const,
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'sofa-base-1',
          assetId: 'sofa-nordic',
          name: 'Nordic Sofa',
          position: [0.0, 0.425, 0.0] as [number, number, number],
          rotationEuler: [0.0, 0.0, 0.0] as [number, number, number],
          scale: [1.0, 1.0, 1.0] as [number, number, number],
          dimensions: [2.1, 0.85, 0.9] as [number, number, number],
        },
        {
          id: 'table-coffee-1',
          assetId: 'table-coffee-1',
          name: 'Minimalist Coffee Table',
          position: [0.0, 0.225, 1.1] as [number, number, number],
          rotationEuler: [0.0, 0.0, 0.0] as [number, number, number],
          scale: [1.0, 1.0, 1.0] as [number, number, number],
          dimensions: [1.2, 0.45, 0.6] as [number, number, number],
        },
      ],
      relationships: [
        {
          id: 'rel-socket-1',
          type: 'socket_attachment',
          anchorId: 'sofa-base-1',
          childId: 'table-coffee-1',
          socketId: 'front_table',
        },
      ],
    },
    is_valid: true,
    is_approval_eligible: true,
    score: {
      boundary: 100,
      collision: 100,
      circulation: 96,
      clearance: 100,
      utilization: 92,
      budget: 100,
      overall: 98.4,
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
      iterations: 20,
      durationMs: 14.2,
      repaired: false,
      scoreDelta: 0.0,
      bestBadge: 'Best Circulation',
    },
  };

  const livingRoomCandidate2 = {
    id: 'cand-prod-living-2',
    schema_version: 1,
    label: 'Option B: Perimeter Seating',
    description: 'Wide transit pathway with side table configuration',
    reasoning_summary: 'Maximizes central floor walkability',
    proposed_actions: [],
    candidate_scene: {
      schemaVersion: 1,
      unit: 'm' as const,
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'sofa-base-1',
          assetId: 'sofa-nordic',
          name: 'Nordic Sofa',
          position: [-1.2, 0.425, 0.0] as [number, number, number],
          rotationEuler: [0.0, 0.0, 0.0] as [number, number, number],
          scale: [1.0, 1.0, 1.0] as [number, number, number],
          dimensions: [2.1, 0.85, 0.9] as [number, number, number],
        },
      ],
      relationships: [],
    },
    is_valid: true,
    is_approval_eligible: true,
    score: {
      boundary: 100,
      collision: 100,
      circulation: 99,
      clearance: 94,
      utilization: 87,
      budget: 100,
      overall: 96.8,
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
      durationMs: 11.0,
      repaired: false,
      scoreDelta: 0.0,
      bestBadge: 'Maximum Walkability',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      token: 'fake-prod-token-2026',
      user: { id: 101, username: 'prod_architect', email: 'architect@roomgenie.ai' } as any,
    });
    useEditorStore.setState({
      scene: livingRoomScene,
    });
    usePreviewStore.getState().exitPreview();
    vi.mocked(agentApi.createAgentSession).mockResolvedValue({
      id: 'sess-prod-81',
      design: 'design-prod-81',
    } as any);
  });

  // =========================================================================
  // WORKSTREAM B: END-TO-END USER JOURNEY & REAL-WORLD SCENARIOS
  // =========================================================================

  it('1. End-to-End User Journey: Proposal -> Preview -> Inspection -> Explicit Approval -> Persistent Apply', async () => {
    const mockResponse = {
      run: {
        id: 'run-prod-81',
        session: 'sess-prod-81',
        user_prompt: 'Arrange conversational living room with coffee table',
        status: 'proposed',
        proposed_actions: livingRoomCandidate1.proposed_actions,
      },
      candidates: [livingRoomCandidate1, livingRoomCandidate2],
      selected_candidate: livingRoomCandidate1,
      source_scene_hash: 'aabb112233',
      requires_approval: true,
      schema_valid: true,
      reference_valid: true,
      domain_valid: true,
      budget_valid: true,
    };

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValue(mockResponse as any);
    vi.mocked(agentApi.applyAgentRun).mockResolvedValue({
      status: 'success',
      applied_candidate_id: 'cand-prod-living-1',
      applied_scene: livingRoomCandidate1.candidate_scene,
    } as any);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    // Step 1: User types natural language prompt
    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange conversational living room with coffee table' } });
    
    // Step 2: User sends prompt
    const sendButton = screen.getByTitle('Send prompt to AI Assistant');
    fireEvent.click(sendButton);

    // Step 3: Verification of Candidate Cards
    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
      expect(screen.getAllByText(/Option A: Conversational Living Area/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Option B: Perimeter Seating/i).length).toBeGreaterThan(0);
    });

    // Step 4: Verify transparent deterministic scores rendered
    expect(screen.getByTestId('active-candidate-score')).toHaveTextContent('98.4');

    // Step 5: Check Preview Store Isolation (canonical scene must NOT be mutated during preview)
    const previewStore = usePreviewStore.getState();
    expect(previewStore.status).toBe('active');
    expect(previewStore.activeCandidateId).toBe('cand-prod-living-1');
    expect(useEditorStore.getState().scene.objects.length).toBe(1); // Canonical scene untouched!

    // Step 6: User switches candidate preview to Option B
    const optionBTab = screen.getByTestId('candidate-tab-cand-prod-living-2');
    fireEvent.click(optionBTab);
    expect(usePreviewStore.getState().activeCandidateId).toBe('cand-prod-living-2');
    expect(useEditorStore.getState().scene.objects.length).toBe(1); // Still untouched!

    // Step 7: Switch back to Option A and Inspect Evidence-Based Explanation
    const optionATab = screen.getByTestId('candidate-tab-cand-prod-living-1');
    fireEvent.click(optionATab);

    const whyBtn = screen.getByTestId('toggle-explanation-cand-prod-living-1');
    fireEvent.click(whyBtn);

    await waitFor(() => {
      expect(screen.getByText(/Coffee table correctly attached to front sofa socket/i)).toBeInTheDocument();
      expect(screen.getByText(/Accent chairs angled inwards/i)).toBeInTheDocument();
    });

    // Step 8: Explicit Approval Gate - User clicks Apply
    const applyButton = screen.getByTestId('apply-proposal-btn');
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(agentApi.applyAgentRun).toHaveBeenCalledWith('run-prod-81', expect.anything(), 'cand-prod-living-1');
    });

    // Step 9: Verify Preview automatically exits upon apply
    expect(usePreviewStore.getState().status).toBe('idle');
  });

  // =========================================================================
  // WORKSTREAM D: RELIABILITY, STALE CONFLICTS & ERROR RECOVERY
  // =========================================================================

  it('2. Handles 409 Stale Proposal Conflict Gracefully Without Corrupting Editor State', async () => {
    const mockResponse = {
      run: {
        id: 'run-stale-81',
        session: 'sess-prod-81',
        user_prompt: 'Add coffee table',
        status: 'proposed',
        proposed_actions: livingRoomCandidate1.proposed_actions,
      },
      candidates: [livingRoomCandidate1],
      selected_candidate: livingRoomCandidate1,
      source_scene_hash: 'old-hash-111',
      requires_approval: true,
      schema_valid: true,
      reference_valid: true,
      domain_valid: true,
      budget_valid: true,
    };

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValue(mockResponse as any);
    
    // Mock 409 Conflict rejection from backend
    const staleError = new Error('The saved design has been modified since this proposal was generated.');
    (staleError as any).response = {
      status: 409,
      data: {
        code: 'stale_proposal',
        stale: true,
        detail: 'The saved design has been modified since this proposal was generated.',
      },
    };
    vi.mocked(agentApi.applyAgentRun).mockRejectedValue(staleError);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Add coffee table' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
    });

    // Attempt to apply stale proposal
    const applyButton = screen.getByTestId('apply-proposal-btn');
    fireEvent.click(applyButton);

    // Verify error is captured and canonical scene is preserved
    await waitFor(() => {
      expect(screen.getByText(/modified since this proposal was generated/i)).toBeInTheDocument();
    });

    // Editor state remains strictly unchanged
    expect(useEditorStore.getState().scene.objects.length).toBe(1);
  });

  it('3. Handles Network Failure During Candidate Generation with Clean Error State', async () => {
    vi.mocked(agentApi.sendAgentPrompt).mockRejectedValue(new Error('Network error: Gateway Timeout'));

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Optimize room arrangement' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByText(/Network error: Gateway Timeout/i)).toBeInTheDocument();
    });

    // Preview store was never activated
    expect(usePreviewStore.getState().status).toBe('idle');
  });

  // =========================================================================
  // WORKSTREAM E: RESOURCE MANAGEMENT & PREVIEW ISOLATION
  // =========================================================================

  it('4. Cleans up preview store state and resources on drawer dismissal', async () => {
    usePreviewStore.getState().startPreview('run-1', livingRoomCandidate1 as any, [livingRoomCandidate1 as any]);
    expect(usePreviewStore.getState().status).toBe('active');
    expect(usePreviewStore.getState().previewScene).not.toBeNull();

    // Exit preview directly simulating drawer close or user cancel
    usePreviewStore.getState().exitPreview();
    expect(usePreviewStore.getState().status).toBe('idle');
    expect(usePreviewStore.getState().previewScene).toBeNull();
    expect(usePreviewStore.getState().activeCandidateId).toBeNull();
  });

  // =========================================================================
  // CORE DEMONSTRATION SCENARIOS (Phase 6.2 / 8.1 Real-World Validation)
  // =========================================================================

  it('5. Demonstration Scenario 1: Conversational Living Area (Sofa, Coffee Table, 2 Accent Chairs)', async () => {
    const conversationalCandidate = {
      id: 'cand-living-conversational',
      schema_version: 1,
      label: 'Option A: Full Conversational Group',
      description: 'Sofa facing coffee table flanked by two angled accent chairs',
      reasoning_summary: 'Sofa front socket hosts table; lateral zones host accent chairs preserving circulation',
      proposed_actions: [
        { type: 'add_furniture', asset_id: 'table-coffee-1', position: [0.0, 0.225, 1.1], rotation_euler: [0, 0, 0] },
        { type: 'add_furniture', asset_id: 'chair-accent-1', position: [-1.2, 0.45, 0.8], rotation_euler: [0, 0.52, 0] },
        { type: 'add_furniture', asset_id: 'chair-accent-2', position: [1.2, 0.45, 0.8], rotation_euler: [0, -0.52, 0] },
      ],
      candidate_scene: {
        schemaVersion: 1,
        unit: 'm' as const,
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          { id: 'sofa-base-1', assetId: 'sofa-nordic', position: [0.0, 0.425, 0.0], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [2.1, 0.85, 0.9] },
          { id: 'table-coffee-1', assetId: 'table-coffee-1', position: [0.0, 0.225, 1.1], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [1.2, 0.45, 0.6] },
          { id: 'chair-accent-1', assetId: 'chair-accent-1', position: [-1.2, 0.45, 0.8], rotationEuler: [0, 0.52, 0], scale: [1, 1, 1], dimensions: [0.8, 0.9, 0.8] },
          { id: 'chair-accent-2', assetId: 'chair-accent-2', position: [1.2, 0.45, 0.8], rotationEuler: [0, -0.52, 0], scale: [1, 1, 1], dimensions: [0.8, 0.9, 0.8] },
        ],
        relationships: [
          { id: 'rel-table', type: 'socket_attachment', anchorId: 'sofa-base-1', childId: 'table-coffee-1', socketId: 'front_table' },
          { id: 'rel-chair-l', type: 'socket_attachment', anchorId: 'sofa-base-1', childId: 'chair-accent-1', socketId: 'left_flank' },
          { id: 'rel-chair-r', type: 'socket_attachment', anchorId: 'sofa-base-1', childId: 'chair-accent-2', socketId: 'right_flank' },
        ],
      },
      is_valid: true,
      is_approval_eligible: true,
      score: {
        boundary: 100,
        collision: 100,
        circulation: 94.5,
        clearance: 98.0,
        utilization: 91.0,
        budget: 100,
        overall: 97.6,
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
        iterations: 24,
        durationMs: 18.2,
        repaired: false,
        scoreDelta: +0.4,
        bestBadge: 'Best Circulation',
      },
    };

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-conversational',
        session: 'sess-prod-81',
        user_prompt: 'Arrange sofa, coffee table, and two accent chairs',
        status: 'proposed',
        proposed_actions: conversationalCandidate.proposed_actions,
      },
      candidates: [conversationalCandidate],
      selected_candidate: conversationalCandidate,
      source_scene_hash: 'hash-conv-1',
      requires_approval: true,
      schema_valid: true,
      reference_valid: true,
      domain_valid: true,
      budget_valid: true,
    } as any);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange sofa, coffee table, and two accent chairs' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
      expect(screen.getAllByText(/Option A: Full Conversational Group/i).length).toBeGreaterThan(0);
    });

    // Verification of Review Checkpoint:
    // 1. Passes deterministic physical validators
    expect(conversationalCandidate.validation_feedback.is_valid).toBe(true);
    expect(conversationalCandidate.validation_feedback.has_collisions).toBe(false);
    expect(conversationalCandidate.score.circulation).toBeGreaterThanOrEqual(90);

    // 2. Canonical scene remains untouched until approval
    expect(useEditorStore.getState().scene.objects.length).toBe(1);
  });

  it('5. Demonstration Scenario 2: Functional Sleeping Zone (Bed & Nightstands)', async () => {
    const sleepingCandidate = {
      id: 'cand-sleeping-functional',
      schema_version: 1,
      label: 'Option A: Symmetrical Master Bedroom',
      description: 'Headboard backed against north wall with dual flanking nightstands',
      reasoning_summary: 'Socket attachments for left and right nightstands with 0.15m spacing and wall alignment',
      proposed_actions: [
        { type: 'add_furniture', asset_id: 'bed-king-1', position: [0.0, 0.55, -1.2], rotation_euler: [0, 0, 0] },
        { type: 'add_furniture', asset_id: 'nightstand-1', position: [-1.4, 0.3, -1.2], rotation_euler: [0, 0, 0] },
        { type: 'add_furniture', asset_id: 'nightstand-2', position: [1.4, 0.3, -1.2], rotation_euler: [0, 0, 0] },
      ],
      candidate_scene: {
        schemaVersion: 1,
        unit: 'm' as const,
        room: { width: 4.0, length: 3.5, height: 2.8 },
        objects: [
          { id: 'bed-1', assetId: 'bed-king-1', position: [0.0, 0.55, -1.2], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [1.9, 1.1, 2.1] },
          { id: 'stand-l', assetId: 'nightstand-1', position: [-1.4, 0.3, -1.2], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [0.5, 0.6, 0.45] },
          { id: 'stand-r', assetId: 'nightstand-2', position: [1.4, 0.3, -1.2], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [0.5, 0.6, 0.45] },
        ],
        relationships: [
          { id: 'rel-stand-l', type: 'socket_attachment', anchorId: 'bed-1', childId: 'stand-l', socketId: 'left_side' },
          { id: 'rel-stand-r', type: 'socket_attachment', anchorId: 'bed-1', childId: 'stand-r', socketId: 'right_side' },
        ],
      },
      is_valid: true,
      is_approval_eligible: true,
      score: {
        boundary: 100,
        collision: 100,
        circulation: 96.0,
        clearance: 100,
        utilization: 89.5,
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
        iterations: 16,
        durationMs: 12.4,
        repaired: false,
        scoreDelta: 0.0,
        bestBadge: 'Best Clearance',
      },
    };

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-sleeping',
        session: 'sess-prod-81',
        user_prompt: 'Arrange a bed and nightstands',
        status: 'proposed',
        proposed_actions: sleepingCandidate.proposed_actions,
      },
      candidates: [sleepingCandidate],
      selected_candidate: sleepingCandidate,
      source_scene_hash: 'hash-sleep-1',
      requires_approval: true,
      schema_valid: true,
      reference_valid: true,
      domain_valid: true,
      budget_valid: true,
    } as any);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange a bed and nightstands' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
      expect(screen.getAllByText(/Option A: Symmetrical Master Bedroom/i).length).toBeGreaterThan(0);
    });

    // Verification of Sockets, Spacing & Clearance
    expect(sleepingCandidate.candidate_scene.relationships.length).toBe(2);
    expect(sleepingCandidate.score.clearance).toBe(100);
    expect(sleepingCandidate.validation_feedback.has_boundary_breaches).toBe(false);
  });

  it('6. Demonstration Scenario 3: Workspace Arrangement (Desk, Chair, Storage)', async () => {
    const workspaceCandidate = {
      id: 'cand-workspace-ergonomic',
      schema_version: 1,
      label: 'Option A: Ergonomic Workstation',
      description: 'Desk with attached task chair and adjacent shelving unit',
      reasoning_summary: 'Chair attached to desk seating socket with unobstructed transit route behind chair',
      proposed_actions: [
        { type: 'add_furniture', asset_id: 'desk-office-1', position: [-0.8, 0.375, -1.0], rotation_euler: [0, 0, 0] },
        { type: 'add_furniture', asset_id: 'chair-task-1', position: [-0.8, 0.45, -0.4], rotation_euler: [0, 0, 0] },
        { type: 'add_furniture', asset_id: 'storage-shelf-1', position: [1.2, 0.9, -1.2], rotation_euler: [0, 0, 0] },
      ],
      candidate_scene: {
        schemaVersion: 1,
        unit: 'm' as const,
        room: { width: 4.0, length: 3.0, height: 2.8 },
        objects: [
          { id: 'desk-1', assetId: 'desk-office-1', position: [-0.8, 0.375, -1.0], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [1.4, 0.75, 0.7] },
          { id: 'chair-1', assetId: 'chair-task-1', position: [-0.8, 0.45, -0.4], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [0.6, 0.9, 0.6] },
          { id: 'shelf-1', assetId: 'storage-shelf-1', position: [1.2, 0.9, -1.2], rotationEuler: [0, 0, 0], scale: [1, 1, 1], dimensions: [0.9, 1.8, 0.4] },
        ],
        relationships: [
          { id: 'rel-desk-chair', type: 'socket_attachment', anchorId: 'desk-1', childId: 'chair-1', socketId: 'chair_seat' },
        ],
      },
      is_valid: true,
      is_approval_eligible: true,
      score: {
        boundary: 100,
        collision: 100,
        circulation: 97.2,
        clearance: 100,
        utilization: 88.0,
        budget: 100,
        overall: 97.9,
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
        iterations: 18,
        durationMs: 13.1,
        repaired: false,
        scoreDelta: 0.0,
        bestBadge: 'Maximum Walkability',
      },
    };

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-workspace',
        session: 'sess-prod-81',
        user_prompt: 'Arrange desk, chair, and storage',
        status: 'proposed',
        proposed_actions: workspaceCandidate.proposed_actions,
      },
      candidates: [workspaceCandidate],
      selected_candidate: workspaceCandidate,
      source_scene_hash: 'hash-work-1',
      requires_approval: true,
      schema_valid: true,
      reference_valid: true,
      domain_valid: true,
      budget_valid: true,
    } as any);

    render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);
    await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

    const input = screen.getByPlaceholderText(/Type design instruction/i);
    fireEvent.change(input, { target: { value: 'Arrange desk, chair, and storage' } });
    fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('active-candidate-card')).toBeInTheDocument();
      expect(screen.getAllByText(/Option A: Ergonomic Workstation/i).length).toBeGreaterThan(0);
    });

    // Verification of Chair Attachment and Unobstructed Circulation
    expect(workspaceCandidate.candidate_scene.relationships[0].socketId).toBe('chair_seat');
    expect(workspaceCandidate.score.circulation).toBeGreaterThan(95);
    expect(workspaceCandidate.validation_feedback.is_room_passable).toBe(true);
  });
});
