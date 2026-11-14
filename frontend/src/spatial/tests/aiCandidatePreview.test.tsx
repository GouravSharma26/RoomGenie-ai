import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { usePreviewStore } from '../../editor3d/store/previewStore';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { AiAgentDrawer } from '../../components/editor/AiAgentDrawer';
import { CandidateComparisonModal } from '../../components/editor/CandidateComparisonModal';
import { PreviewViewportBanner } from '../../editor3d/components/PreviewViewportBanner';
import { RoomCanvas } from '../../editor3d/components/RoomCanvas';
import * as agentApi from '../../services/agentApi';
import { useAuthStore } from '../../services/authStore';
import type { LayoutCandidateRecord, PromptProposalResponse } from '../../services/agentApi';
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

// Mock Three.js / R3F Canvas components safely for JSDOM
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
  useThree: () => ({
    scene: {},
    camera: {},
    gl: { domElement: document.createElement('canvas') },
  }),
  useFrame: vi.fn(),
}));

vi.mock('../../editor3d/components/RoomEnvironment', () => ({ RoomEnvironment: () => <div data-testid="room-environment" /> }));
vi.mock('../../editor3d/components/FurnitureItem', () => ({ FurnitureItem: () => <div data-testid="furniture-item" /> }));
vi.mock('../../editor3d/components/ViewportControls', () => ({ ViewportControls: () => <div data-testid="viewport-controls" /> }));
vi.mock('../../editor3d/components/AlignmentGuides', () => ({ AlignmentGuides: () => null }));
vi.mock('../../editor3d/components/SocketOverlay', () => ({ SocketOverlay: () => null }));
vi.mock('../../editor3d/components/RelationshipOverlay', () => ({ RelationshipOverlay: () => null }));
vi.mock('../../editor3d/components/WalkabilityOverlay', () => ({ WalkabilityOverlay: () => null }));

describe('Phase 6.4: Interactive 3D Candidate Preview & Reversible Apply', () => {
  const canonicalBaseScene: CanonicalScene = {
    room: {
      shape: 'polygon',
      dimensions: { width: 6.0, length: 5.0, height: 2.8 },
      polygonVertices: [
        [-3.0, -2.5],
        [3.0, -2.5],
        [3.0, 2.5],
        [-3.0, 2.5],
      ],
      walls: [
        { id: 'w1', startPoint: [-3.0, -2.5], endPoint: [3.0, -2.5], thickness: 0.15, openings: [] },
        { id: 'w2', startPoint: [3.0, -2.5], endPoint: [3.0, 2.5], thickness: 0.15, openings: [] },
        { id: 'w3', startPoint: [3.0, 2.5], endPoint: [-3.0, 2.5], thickness: 0.15, openings: [] },
        { id: 'w4', startPoint: [-3.0, 2.5], endPoint: [-3.0, -2.5], thickness: 0.15, openings: [] },
      ],
    },
    objects: [
      {
        id: 'existing-rug-1',
        assetId: 'nordic-rug',
        name: 'Nordic Area Rug',
        position: [0, 0.01, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: [2.0, 0.02, 1.5],
      },
    ],
  };

  const candidateSceneA: CanonicalScene = {
    ...canonicalBaseScene,
    objects: [
      ...canonicalBaseScene.objects,
      {
        id: 'cand-sofa-a',
        assetId: 'sofa-3seat',
        name: 'Modern 3-Seater Sofa',
        position: [0, 0.425, -1.0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: [2.1, 0.85, 0.9],
      },
      {
        id: 'cand-table-a',
        assetId: 'coffee-table',
        name: 'Oak Coffee Table',
        position: [0, 0.225, 0.0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: [1.1, 0.45, 0.6],
      },
    ],
  };

  const candidateSceneB: CanonicalScene = {
    ...canonicalBaseScene,
    objects: [
      ...canonicalBaseScene.objects,
      {
        id: 'cand-sectional-b',
        assetId: 'l-shape-sectional',
        name: 'Modular Corner Sectional',
        position: [-0.5, 0.425, -0.8],
        rotationEuler: [0, 1.5708, 0],
        scale: [1, 1, 1],
        dimensions: [2.4, 0.85, 1.8],
      },
    ],
  };

  const candidateA: LayoutCandidateRecord = {
    id: 'cand-opt-a',
    schema_version: 1,
    label: 'Option A: Conversational Centerpiece',
    description: 'Central sofa orientation with generous 1.0m circulation perimeter.',
    reasoning_summary: 'Prioritizes open floor passability and social seating around coffee table.',
    intent: 'social_conversation',
    rank: 1,
    proposed_actions: [
      { name: 'add_furniture', parameters: { asset_id: 'sofa-3seat', position: [0, 0.425, -1.0], rotation: [0, 0, 0] } },
      { name: 'add_furniture', parameters: { asset_id: 'coffee-table', position: [0, 0.225, 0.0], rotation: [0, 0, 0] } },
    ],
    candidate_scene: candidateSceneA,
    is_valid: true,
    is_approval_eligible: true,
    score: {
      overall: 93.5,
      boundary: 100,
      collision: 100,
      circulation: 95,
      clearance: 90,
      utilization: 85,
      budget: 90,
    },
    validation_feedback: {
      is_valid: true,
      is_approval_eligible: true,
      has_collisions: false,
      has_boundary_breaches: false,
      is_budget_compliant: true,
      is_room_passable: true,
      fatal_errors: [],
      advisory_warnings: [{ code: 'clearance_advisory', severity: 'warning', message: 'Coffee table clearance is 0.55m from sofa edge.' }],
      errors: [],
      warnings: ['Coffee table clearance is 0.55m from sofa edge.'],
    },
    trade_offs: ['Higher floor coverage', 'Optimal social viewing angle'],
    budget_diff: {
      before_paise: 499900,
      after_paise: 4399700,
      diff_paise: 3899800,
      before_total_paise: 499900,
      after_total_paise: 4399700,
      item_count_before: 1,
      item_count_after: 3,
      is_valid: true,
    },
  };

  const candidateB: LayoutCandidateRecord = {
    id: 'cand-opt-b',
    schema_version: 1,
    label: 'Option B: Maximized Lounge Space',
    description: 'Corner sectional placement with open interior corridor.',
    reasoning_summary: 'Anchors to corner walls to maximize open center rug area.',
    intent: 'lounge_relaxation',
    rank: 2,
    proposed_actions: [
      { name: 'add_furniture', parameters: { asset_id: 'l-shape-sectional', position: [-0.5, 0.425, -0.8], rotation: [0, 1.57, 0] } },
    ],
    candidate_scene: candidateSceneB,
    is_valid: true,
    is_approval_eligible: true,
    score: {
      overall: 88.0,
      boundary: 100,
      collision: 100,
      circulation: 85,
      clearance: 85,
      utilization: 80,
      budget: 85,
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
    trade_offs: ['Heavier footprint', 'Requires corner clearance'],
    budget_diff: {
      before_paise: 499900,
      after_paise: 4999800,
      diff_paise: 4499900,
      before_total_paise: 499900,
      after_total_paise: 4999800,
      item_count_before: 1,
      item_count_after: 2,
      is_valid: true,
    },
  };

  const candidateCInvalid: LayoutCandidateRecord = {
    id: 'cand-opt-c',
    schema_version: 1,
    label: 'Option C: Aggressive Perimeter Layout',
    description: 'Layout attempting oversized dining set near entry doorway.',
    reasoning_summary: 'Blocks entry circulation door path.',
    rank: 3,
    proposed_actions: [],
    candidate_scene: {
      ...canonicalBaseScene,
      objects: [...canonicalBaseScene.objects],
    },
    is_valid: false,
    is_approval_eligible: false,
    score: {
      overall: 0.0,
      boundary: 100,
      collision: 0,
      circulation: 0,
      clearance: 0,
      utilization: 0,
      budget: 0,
    },
    validation_feedback: {
      is_valid: false,
      is_approval_eligible: false,
      has_collisions: true,
      has_boundary_breaches: false,
      is_budget_compliant: false,
      is_room_passable: false,
      fatal_errors: [{ code: 'circulation_blocked', severity: 'fatal', message: 'Doorway circulation corridor is obstructed.' }],
      advisory_warnings: [],
      errors: ['Doorway circulation corridor is obstructed.'],
      warnings: [],
    },
    trade_offs: ['Severe door landing collision'],
  };

  const candidates = [candidateA, candidateB, candidateCInvalid];

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'u1', username: 'gourav', email: 'gourav@example.com' } as any,
    });
    useEditorStore.setState({
      scene: JSON.parse(JSON.stringify(canonicalBaseScene)),
      history: [],
      future: [],
    });
    usePreviewStore.getState().clear();
  });

  describe('1. Preview State Isolation & Lifecycle', () => {
    it('initializes with idle preview status and null previewScene', () => {
      const state = usePreviewStore.getState();
      expect(state.status).toBe('idle');
      expect(state.previewScene).toBeNull();
      expect(state.activeCandidateId).toBeNull();
    });

    it('starts preview without mutating canonical scene or history', () => {
      const initialSceneCopy = JSON.parse(JSON.stringify(useEditorStore.getState().scene));
      const initialHistoryLength = useEditorStore.getState().history.length;

      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);

      const previewState = usePreviewStore.getState();
      expect(previewState.status).toBe('active');
      expect(previewState.activeCandidateId).toBe('cand-opt-a');
      expect(previewState.previewScene?.objects).toHaveLength(3); // 1 initial + 2 new

      // Canonical scene and history MUST remain completely untouched
      const canonicalScene = useEditorStore.getState().scene;
      expect(canonicalScene).toEqual(initialSceneCopy);
      expect(canonicalScene.objects).toHaveLength(1);
      expect(useEditorStore.getState().history.length).toBe(initialHistoryLength);
    });

    it('switches candidate preview dynamically without mutating canonical scene', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);
      expect(usePreviewStore.getState().activeCandidateId).toBe('cand-opt-a');
      expect(usePreviewStore.getState().previewScene?.objects).toHaveLength(3);

      // Switch to candidate B
      usePreviewStore.getState().switchCandidate(candidateB);

      const previewState = usePreviewStore.getState();
      expect(previewState.status).toBe('active');
      expect(previewState.activeCandidateId).toBe('cand-opt-b');
      expect(previewState.previewScene?.objects).toHaveLength(2); // 1 initial + 1 sectional
      expect(previewState.previewScene?.objects[1].name).toBe('Modular Corner Sectional');

      // Canonical scene still untouched
      expect(useEditorStore.getState().scene.objects).toHaveLength(1);
    });

    it('exits preview and restores clean state on exitPreview()', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);
      expect(usePreviewStore.getState().status).toBe('active');

      usePreviewStore.getState().exitPreview();

      const previewState = usePreviewStore.getState();
      expect(previewState.status).toBe('idle');
      expect(previewState.previewScene).toBeNull();
      expect(previewState.activeCandidateId).toBeNull();
      expect(previewState.activeCandidate).toBeNull();
      expect(useEditorStore.getState().scene.objects).toHaveLength(1);
    });

    it('marks preview as discarded on discardPreview()', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);
      usePreviewStore.getState().discardPreview();

      const previewState = usePreviewStore.getState();
      expect(previewState.status).toBe('discarded');
      expect(previewState.previewScene).toBeNull();
      expect(previewState.activeCandidateId).toBeNull();
    });
  });

  describe('2. PreviewViewportBanner Component', () => {
    it('does not render when preview status is idle', () => {
      const { container } = render(<PreviewViewportBanner />);
      expect(container.firstChild).toBeNull();
    });

    it('renders preview banner with candidate label, quality score badge, and exit button when active', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);

      render(<PreviewViewportBanner />);

      expect(screen.getByTestId('preview-viewport-banner')).toBeInTheDocument();
      expect(screen.getByText(/Preview: Option A: Conversational Centerpiece/i)).toBeInTheDocument();
      expect(screen.getByText(/93.5 \/ 100/i)).toBeInTheDocument();
      expect(screen.getByText('Read-Only 3D Inspection')).toBeInTheDocument();
      expect(screen.getByTestId('preview-banner-compare-btn')).toBeInTheDocument();
      expect(screen.getByTestId('preview-banner-exit-btn')).toBeInTheDocument();
    });

    it('opens comparison modal when clicking Compare Candidates in banner', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);
      render(<PreviewViewportBanner />);

      fireEvent.click(screen.getByTestId('preview-banner-compare-btn'));
      expect(usePreviewStore.getState().comparisonOpen).toBe(true);
    });

    it('exits preview when clicking Exit Preview in banner', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);
      render(<PreviewViewportBanner />);

      fireEvent.click(screen.getByTestId('preview-banner-exit-btn'));
      expect(usePreviewStore.getState().status).toBe('idle');
      expect(usePreviewStore.getState().previewScene).toBeNull();
    });
  });

  describe('3. CandidateComparisonModal Component', () => {
    it('renders comparison cards for all candidates with scores, trade-offs, and dimensions', () => {
      usePreviewStore.setState({
        comparisonOpen: true,
        allCandidates: candidates,
        activeCandidateId: 'cand-opt-a',
      });

      render(<CandidateComparisonModal />);

      expect(screen.getByTestId('candidate-comparison-modal')).toBeInTheDocument();
      expect(screen.getByText(/Compare Layout Candidates \(3\)/i)).toBeInTheDocument();

      // Check all 3 candidate cards are present
      expect(screen.getByTestId('comparison-card-cand-opt-a')).toBeInTheDocument();
      expect(screen.getByTestId('comparison-card-cand-opt-b')).toBeInTheDocument();
      expect(screen.getByTestId('comparison-card-cand-opt-c')).toBeInTheDocument();

      // Score breakdowns
      expect(screen.getByText('93.5 / 100')).toBeInTheDocument();
      expect(screen.getByText('88.0 / 100')).toBeInTheDocument();
      expect(screen.getByText('0.0 / 100')).toBeInTheDocument();

      // Fatal error on candidate C
      expect(screen.getByText(/1 Fatal Issue/i)).toBeInTheDocument();
    });

    it('switches preview candidate when clicking 3D Preview in comparison modal', () => {
      usePreviewStore.setState({
        status: 'active',
        comparisonOpen: true,
        allCandidates: candidates,
        activeCandidateId: 'cand-opt-a',
        activeCandidate: candidateA,
      });

      render(<CandidateComparisonModal />);

      const previewBtnB = screen.getByTestId('preview-btn-cand-opt-b');
      fireEvent.click(previewBtnB);

      expect(usePreviewStore.getState().activeCandidateId).toBe('cand-opt-b');
      expect(usePreviewStore.getState().activeCandidate?.id).toBe('cand-opt-b');
    });

    it('disables Apply button for invalid candidate in comparison modal', () => {
      usePreviewStore.setState({
        comparisonOpen: true,
        allCandidates: candidates,
        activeCandidateId: 'cand-opt-c',
        activeCandidate: candidateCInvalid,
      });

      render(<CandidateComparisonModal />);

      const applyBtnC = screen.getByTestId('apply-btn-cand-opt-c');
      expect(applyBtnC).toBeDisabled();
    });

    it('closes comparison modal when clicking close button', () => {
      usePreviewStore.setState({
        comparisonOpen: true,
        allCandidates: candidates,
        activeCandidateId: 'cand-opt-a',
      });

      render(<CandidateComparisonModal />);
      fireEvent.click(screen.getByTestId('close-comparison-modal-btn'));

      expect(usePreviewStore.getState().comparisonOpen).toBe(false);
    });
  });

  describe('4. Reversible Apply & Single-Step History Integration', () => {
    it('applies candidate proposal atomically, creates exactly 1 undo entry, and exits preview', async () => {
      vi.mocked(agentApi.createAgentSession).mockResolvedValue({
        id: 'sess-p64',
        title: 'Preview Test Session',
        owner_username: 'gourav',
        design: null,
        created_at: '2026-11-14T08:00:00Z',
        updated_at: '2026-11-14T08:00:00Z',
      });

      const mockPromptResponse: PromptProposalResponse = {
        run: {
          id: 'run-p64',
          session: 'sess-p64',
          user_prompt: 'Arrange living room layout',
          status: 'proposed',
          ai_response_text: 'Generated 3 validated layout alternatives.',
          proposed_actions: candidateA.proposed_actions,
          validation_results: {
            is_valid: true,
            errors: [],
            warnings: [],
            budget_diff: candidateA.budget_diff!,
            candidates: candidates,
          },
          provider_metadata: {
            provider: 'mock',
            model: 'mock-planner',
            latency_ms: 10,
          },
          created_at: '2026-11-14T08:00:00Z',
        },
        candidate_scene: candidateSceneA,
        budget_diff: candidateA.budget_diff!,
        candidates: candidates,
        selected_candidate: candidateA,
        requires_approval: true,
      };

      vi.mocked(agentApi.sendAgentPrompt).mockResolvedValue(mockPromptResponse);

      vi.mocked(agentApi.applyAgentRun).mockResolvedValue({
        detail: 'Candidate Option A applied successfully.',
        run: {
          ...mockPromptResponse.run,
          status: 'approved',
        },
        applied_scene: candidateSceneA,
        budget_diff: candidateA.budget_diff!,
      });

      const onSceneApplied = vi.fn();
      render(<AiAgentDrawer isOpen={true} onClose={() => {}} onSceneApplied={onSceneApplied} />);

      await screen.findByText(/Hello! I am your AI Interior Design Assistant/i);

      // Submit user prompt
      const input = screen.getByPlaceholderText(/Type design instruction/i);
      fireEvent.change(input, { target: { value: 'Arrange living room' } });
      fireEvent.click(screen.getByTitle('Send prompt to AI Assistant'));

      // Wait for candidate tabs and automated preview activation
      await waitFor(() => {
        expect(screen.getByTestId('candidate-tab-cand-opt-a')).toBeInTheDocument();
      });

      // Verification: preview was activated automatically
      expect(usePreviewStore.getState().status).toBe('active');
      expect(usePreviewStore.getState().activeCandidateId).toBe('cand-opt-a');

      // Canonical scene before apply must still be 1 item
      expect(useEditorStore.getState().scene.objects).toHaveLength(1);
      const preApplyHistoryCount = useEditorStore.getState().history.length;

      // Confirmation summary must be visible
      expect(screen.getByTestId('apply-confirmation-summary')).toBeInTheDocument();

      // Click Approve & Apply
      const approveBtn = screen.getByTestId('apply-proposal-btn');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(agentApi.applyAgentRun).toHaveBeenCalledWith('run-p64', expect.anything(), 'cand-opt-a');
      });

      // Verification: canonical scene now updated to applied candidate scene (3 items)
      expect(useEditorStore.getState().scene.objects).toHaveLength(3);
      expect(onSceneApplied).toHaveBeenCalledWith(candidateSceneA);

      // Verification: exactly ONE undo entry added to history
      expect(useEditorStore.getState().history.length).toBe(preApplyHistoryCount + 1);

      // Verification: preview cleanly exited
      expect(usePreviewStore.getState().status).toBe('idle');
      expect(usePreviewStore.getState().previewScene).toBeNull();

      // Verification: UNDO restores exact canonical scene before apply
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().scene.objects).toHaveLength(1);
      expect(useEditorStore.getState().scene.objects[0].name).toBe('Nordic Area Rug');

      // Verification: REDO restores applied candidate scene
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().scene.objects).toHaveLength(3);
      expect(useEditorStore.getState().scene.objects[1].name).toBe('Modern 3-Seater Sofa');
    });
  });

  describe('5. Viewport Keyboard & Pointer Suppression during Preview', () => {
    it('disables Delete, Undo, and Redo shortcuts in RoomCanvas when preview is active, and Escape exits preview', () => {
      usePreviewStore.getState().startPreview('run-123', candidateA, candidates);
      expect(usePreviewStore.getState().status).toBe('active');

      const { unmount } = render(<RoomCanvas />);

      // Verify that Delete keydown does not delete canonical object
      fireEvent.keyDown(window, { key: 'Delete' });
      expect(useEditorStore.getState().scene.objects).toHaveLength(1);

      // Verify that Ctrl+Z does not mutate history
      const initialHistoryLength = useEditorStore.getState().history.length;
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      expect(useEditorStore.getState().history.length).toBe(initialHistoryLength);

      // Verify that Escape keydown exits preview cleanly
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(usePreviewStore.getState().status).toBe('idle');
      expect(usePreviewStore.getState().previewScene).toBeNull();

      unmount();
    });
  });
});
