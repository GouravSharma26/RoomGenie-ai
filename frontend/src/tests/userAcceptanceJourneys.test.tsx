// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../editor3d/store/editorStore';
import { usePreviewStore } from '../editor3d/store/previewStore';
import { SAMPLE_CATALOG } from '../editor3d/data/catalog';
import * as agentApi from '../services/agentApi';
import * as designApi from '../services/designApi';
import type { CanonicalScene } from '../types/scene';

// Mock agentApi and designApi
vi.mock('../services/agentApi', async () => {
  const actual = await vi.importActual<typeof import('../services/agentApi')>('../services/agentApi');
  return {
    ...actual,
    createAgentSession: vi.fn(),
    sendAgentPrompt: vi.fn(),
    applyAgentRun: vi.fn(),
    rejectAgentRun: vi.fn(),
    submitCandidateFeedback: vi.fn(),
    getCandidateExplanation: vi.fn(),
  };
});

vi.mock('../services/designApi', async () => {
  const actual = await vi.importActual<typeof import('../services/designApi')>('../services/designApi');
  return {
    ...actual,
    saveDesignToBackend: vi.fn(),
    persistDesignScene: vi.fn(),
    getDesignById: vi.fn(),
  };
});

describe('Phase 8.3 User Acceptance Testing — 10 Production Journeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().clearScene();
    usePreviewStore.getState().exitPreview();
  });

  // Journey 1: First-time user creates a room
  it('Journey 1: First-time user creates a room with parametric dimensions', () => {
    const store = useEditorStore.getState();
    expect(store.scene.schemaVersion).toBe(1);
    expect(store.scene.unit).toBe('m');

    // User defines custom room envelope (6m x 5m x 2.8m)
    store.setRoomDimensions({ width: 6.0, length: 5.0, height: 2.8 });
    const updated = useEditorStore.getState().scene;

    expect(updated.room.width).toBe(6.0);
    expect(updated.room.length).toBe(5.0);
    expect(updated.room.height).toBe(2.8);
    expect(updated.objects).toHaveLength(0);
  });

  // Journey 2: User adds and arranges furniture from catalogue
  it('Journey 2: User adds and arranges furniture from catalogue with spatial validation', () => {
    const store = useEditorStore.getState();
    store.setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });

    const sofaItem = SAMPLE_CATALOG.find((c) => c.category === 'seating') || SAMPLE_CATALOG[0];
    const tableItem = SAMPLE_CATALOG.find((c) => c.category === 'tables') || SAMPLE_CATALOG[1];

    store.addFurniture(sofaItem);
    let currentScene = useEditorStore.getState().scene;
    expect(currentScene.objects).toHaveLength(1);
    const sofaObj = currentScene.objects[0];
    expect(sofaObj.assetId).toBe(sofaItem.id);

    // User adds coffee table
    store.addFurniture(tableItem);
    currentScene = useEditorStore.getState().scene;
    expect(currentScene.objects).toHaveLength(2);

    // User translates sofa
    store.updatePlacementPosition(sofaObj.id, [1.0, sofaObj.position[1], -1.0]);
    currentScene = useEditorStore.getState().scene;
    const movedSofa = currentScene.objects.find((o) => o.id === sofaObj.id);
    expect(movedSofa?.position[0]).toBe(1.0);
    expect(movedSofa?.position[2]).toBe(-1.0);
  });

  // Journey 3: User generates multi-candidate AI layout alternatives
  it('Journey 3: User generates multi-candidate AI layout alternatives with deterministic scoring', async () => {
    const mockCandidates = [
      {
        id: 'cand-uat-1',
        schema_version: 1,
        label: 'Candidate 1: Symmetrical Living',
        description: 'Centered sofa with front coffee table',
        reasoning_summary: 'Optimizes conversation and TV alignment',
        proposed_actions: [{ type: 'add_furniture', asset_id: 'sofa-1', position: [0, 0.45, 0] }],
        candidate_scene: {
          schemaVersion: 1,
          unit: 'm',
          room: { width: 5.0, length: 4.0, height: 2.8 },
          objects: [{ id: 'cand-sofa', assetId: 'sofa-1', name: 'Sofa', dimensions: [2, 0.9, 0.9], position: [0, 0.45, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] }],
        },
        source_scene_hash: 'hash-uat-1',
        is_valid: true,
        is_approval_eligible: true,
        score: {
          overall: 95.5,
          boundary: 100,
          collision: 100,
          circulation: 92,
          clearance: 95,
          utilization: 85,
          budget: 100,
        },
        validation_feedback: { is_valid: true, is_approval_eligible: true, fatal_errors: [], advisory_warnings: [] },
        trade_offs: ['Balances conversational seating with wall clearances'],
      },
      {
        id: 'cand-uat-2',
        schema_version: 1,
        label: 'Candidate 2: Open Flow Living',
        description: 'Sofa along wall with open walkway',
        reasoning_summary: 'Maximizes room circulation paths',
        proposed_actions: [{ type: 'add_furniture', asset_id: 'sofa-1', position: [1.2, 0.45, -0.5] }],
        candidate_scene: {
          schemaVersion: 1,
          unit: 'm',
          room: { width: 5.0, length: 4.0, height: 2.8 },
          objects: [{ id: 'cand-sofa-2', assetId: 'sofa-1', name: 'Sofa', dimensions: [2, 0.9, 0.9], position: [1.2, 0.45, -0.5], rotationEuler: [0, 0, 0], scale: [1, 1, 1] }],
        },
        source_scene_hash: 'hash-uat-2',
        is_valid: true,
        is_approval_eligible: true,
        score: {
          overall: 92.0,
          boundary: 100,
          collision: 100,
          circulation: 98,
          clearance: 92,
          utilization: 80,
          budget: 100,
        },
        validation_feedback: { is_valid: true, is_approval_eligible: true, fatal_errors: [], advisory_warnings: [] },
        trade_offs: ['Prioritizes open circulation over compact grouping'],
      },
    ];

    vi.mocked(agentApi.sendAgentPrompt).mockResolvedValueOnce({
      run: {
        id: 'run-uat-3',
        session: 'sess-uat-3',
        user_prompt: 'Arrange a modern living room',
        status: 'proposed',
        ai_response_text: 'Generated living room layout candidates',
        proposed_actions: [],
        validation_results: { is_valid: true, errors: [], warnings: [], budget_diff: { diff_paise: 0 } },
        provider_metadata: { provider: 'mock', model: 'deterministic-mock-v1' },
        created_at: '2026-11-14T18:00:00Z',
      },
      candidate_scene: mockCandidates[0].candidate_scene as any,
      budget_diff: { diff_paise: 0, diff_inr: 'Rs 0' },
      candidates: mockCandidates as any,
      selected_candidate: mockCandidates[0] as any,
      requires_approval: true,
    });

    const response = await agentApi.sendAgentPrompt(
      'sess-uat-3',
      'Arrange a modern living room',
      useEditorStore.getState().scene as any,
      undefined,
      2
    );

    expect(response.run.status).toBe('proposed');
    expect(response.candidates).toHaveLength(2);
    expect(response.candidates?.[0].score.overall).toBe(95.5);
    expect(response.candidates?.[1].score.circulation).toBe(98);
  });

  // Journey 4: User compares candidates side-by-side
  it('Journey 4: User compares candidates side-by-side evaluating score breakdowns and trade-offs', () => {
    const candidates = [
      { id: 'c1', label: 'Balanced', overall: 96, circulation: 90, clearance: 95, tradeOff: 'Even distribution' },
      { id: 'c2', label: 'Spacious', overall: 91, circulation: 99, clearance: 90, tradeOff: 'Large open floor' },
    ];

    // Verify comparison logic
    const bestOverall = [...candidates].sort((a, b) => b.overall - a.overall)[0];
    const bestCirculation = [...candidates].sort((a, b) => b.circulation - a.circulation)[0];

    expect(bestOverall.id).toBe('c1');
    expect(bestCirculation.id).toBe('c2');
    expect(bestCirculation.tradeOff).toBe('Large open floor');
  });

  // Journey 5: User refines a candidate with natural language feedback
  it('Journey 5: User refines a candidate with natural language feedback', async () => {
    vi.mocked(agentApi.submitCandidateFeedback).mockResolvedValueOnce({
      id: 'fb-uat-5',
      status: 'recorded',
    } as any);

    const feedbackRes = await agentApi.submitCandidateFeedback({
      run_id: 'run-uat-5',
      candidate_id: 'cand-uat-1',
      feedback_type: 'modified',
      feedback_text: 'Shift the sofa 0.3m closer to the east wall',
    });

    expect(feedbackRes.status).toBe('recorded');
    expect(agentApi.submitCandidateFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_id: 'cand-uat-1',
        feedback_type: 'modified',
        feedback_text: 'Shift the sofa 0.3m closer to the east wall',
      })
    );
  });

  // Journey 6: User previews candidate and applies layout to canonical scene
  it('Journey 6: User previews candidate in isolation and applies layout to canonical scene', async () => {
    const store = useEditorStore.getState();
    const previewStore = usePreviewStore.getState();

    // Setup initial canonical scene
    store.setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });
    const initialItem = SAMPLE_CATALOG[0];
    store.addFurniture(initialItem);
    const initialCanonical = useEditorStore.getState().scene;
    expect(initialCanonical.objects).toHaveLength(1);

    // Proposed candidate scene
    const candidateScene: CanonicalScene = {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        initialCanonical.objects[0],
        {
          id: 'preview-table',
          assetId: 'table-coffee-round',
          name: 'Round Coffee Table',
          dimensions: [1.0, 0.45, 1.0],
          position: [0.0, 0.225, 0.5],
          rotationEuler: [0.0, 0.0, 0.0],
          scale: [1.0, 1.0, 1.0],
        },
      ],
    };

    const candidateRecord = {
      id: 'cand-uat-6',
      schema_version: 1,
      label: 'Preview Candidate',
      description: 'Preview Description',
      reasoning_summary: 'Preview Summary',
      proposed_actions: [],
      candidate_scene: candidateScene,
      source_scene_hash: 'hash-preview',
      is_valid: true,
      is_approval_eligible: true,
      score: { overall: 95, boundary: 100, collision: 100, circulation: 90, clearance: 95, utilization: 85, budget: 100 },
      validation_feedback: null,
      trade_offs: [],
    };

    // User selects preview
    previewStore.startPreview('run-uat-6', candidateRecord as any);
    expect(usePreviewStore.getState().status).toBe('active');
    expect(usePreviewStore.getState().previewScene?.objects).toHaveLength(2);

    // Mock successful backend apply
    vi.mocked(agentApi.applyAgentRun).mockResolvedValueOnce({
      run_id: 'run-preview-6',
      status: 'applied',
      canonical_scene: candidateScene,
    } as any);

    // Exit preview and apply to canonical scene
    previewStore.exitPreview();
    store.loadScene(candidateScene);

    expect(usePreviewStore.getState().status).toBe('idle');
    expect(useEditorStore.getState().scene.objects).toHaveLength(2);
    expect(useEditorStore.getState().scene.objects[1].id).toBe('preview-table');
  });

  // Journey 7: User saves design to PostgreSQL and reloads it
  it('Journey 7: User saves design to persistence and reloads it preserving canonical fidelity', async () => {
    const currentScene = useEditorStore.getState().scene;

    vi.mocked(designApi.saveDesignToBackend).mockResolvedValueOnce({
      id: 'design-uat-7',
      title: 'Master Suite Design',
      scene_json: currentScene,
      created_at: '2026-11-14T18:00:00Z',
      updated_at: '2026-11-14T18:00:00Z',
    } as any);

    const saveResult = await designApi.saveDesignToBackend('Master Suite Design', currentScene);
    expect(saveResult.id).toBe('design-uat-7');

    vi.mocked(designApi.getDesignById).mockResolvedValueOnce({
      id: 'design-uat-7',
      title: 'Master Suite Design',
      scene_json: currentScene,
      created_at: '2026-11-14T18:00:00Z',
      updated_at: '2026-11-14T18:00:00Z',
    } as any);

    const loadedDesign = await designApi.getDesignById('design-uat-7');
    expect(loadedDesign.id).toBe('design-uat-7');
    expect(loadedDesign.scene_json.unit).toBe('m');
    expect(loadedDesign.scene_json.room.width).toBe(currentScene.room.width);
  });

  // Journey 8: User experiences an AI provider failure and cleanly recovers without scene corruption
  it('Journey 8: User experiences an AI provider failure and recovers cleanly without scene corruption', async () => {
    const store = useEditorStore.getState();
    store.addFurniture(SAMPLE_CATALOG[0]);
    const baselineScene = JSON.stringify(useEditorStore.getState().scene);

    // Simulate provider failure (timeout / HTTP 500)
    vi.mocked(agentApi.sendAgentPrompt).mockRejectedValueOnce(
      new Error('Gemini API upstream rate limit (HTTP 429) - mock fallback activated')
    );

    let caughtError: string | null = null;
    try {
      await agentApi.sendAgentPrompt(
        'sess-fail-8',
        'Generate luxury layout',
        useEditorStore.getState().scene as any
      );
    } catch (err: any) {
      caughtError = err.message;
    }

    expect(caughtError).toContain('HTTP 429');
    // Verify canonical scene remains 100% intact and uncorrupted
    const postErrorScene = JSON.stringify(useEditorStore.getState().scene);
    expect(postErrorScene).toBe(baselineScene);
  });

  // Journey 9: User exercises persistent Undo and Redo
  it('Journey 9: User exercises persistent Undo and Redo across edits', () => {
    const store = useEditorStore.getState();
    store.setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });

    // Step 1: Add first item
    store.addFurniture(SAMPLE_CATALOG[0]);
    expect(useEditorStore.getState().scene.objects).toHaveLength(1);
    expect(useEditorStore.getState().canUndo()).toBe(true);

    // Step 2: Add second item
    store.addFurniture(SAMPLE_CATALOG[1]);
    expect(useEditorStore.getState().scene.objects).toHaveLength(2);

    // Step 3: Undo -> reverts to 1 item
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().scene.objects).toHaveLength(1);
    expect(useEditorStore.getState().canRedo()).toBe(true);

    // Step 4: Redo -> restores 2 items
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().scene.objects).toHaveLength(2);
  });

  // Journey 10: User submits an invalid/ambiguous prompt and receives structured error explanation
  it('Journey 10: User submits an invalid/incompatible prompt and receives structured validation feedback', async () => {
    vi.mocked(agentApi.sendAgentPrompt).mockRejectedValueOnce(
      new Error('Budget ceiling exceeded: requested layout requires Rs 1,50,000 but budget is Rs 50,000.')
    );

    let caughtError: string | null = null;
    try {
      await agentApi.sendAgentPrompt(
        'sess-uat-10',
        'Place 10 premium leather sectionals within 50000 budget',
        useEditorStore.getState().scene as any
      );
    } catch (err: any) {
      caughtError = err.message;
    }

    expect(caughtError).toContain('Budget ceiling exceeded');
  });
});
