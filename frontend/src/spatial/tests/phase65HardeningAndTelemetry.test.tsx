import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { usePreviewStore } from '../../editor3d/store/previewStore';
import * as designApi from '../../services/designApi';
import {
  trackSpatialEvent,
  getClientTelemetryEvents,
  clearClientTelemetryEvents,
  sanitizePromptClient,
  summarizeSceneClient,
  SPATIAL_ERROR_CODES,
} from '../../services/spatialTelemetry';
import type { CanonicalScene } from '../../types/scene';
import type { LayoutCandidateRecord } from '../../services/agentApi';

vi.mock('../../services/designApi', () => ({
  persistDesignScene: vi.fn(),
  fetchDesignDetail: vi.fn(),
}));

describe('Phase 6.5: Spatial AI Hardening, Telemetry & Persistent Reversible Apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClientTelemetryEvents();
    useEditorStore.setState({
      history: [],
      future: [],
      currentDesignId: null,
      isSyncingPersistence: false,
      lastSyncError: null,
    });
    usePreviewStore.setState({
      status: 'idle',
      runId: null,
      activeCandidateId: null,
      activeCandidate: null,
      previewScene: null,
      allCandidates: [],
      comparisonOpen: false,
      errorMessage: null,
    });
  });

  describe('Investigation A: Persistent Undo/Redo & Concurrency Sync', () => {
    it('automatically invokes syncCurrentDesignToBackend on undo when currentDesignId is set', async () => {
      const mockPersist = vi.mocked(designApi.persistDesignScene);
      mockPersist.mockResolvedValueOnce({
        id: 42,
        title: 'Persistent Room',
        room_type: 'living_room',
        scene_json: {},
        updated_at: '2026-11-14T10:00:00Z',
      } as any);

      const scene1: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5, length: 4, height: 2.8 },
        objects: [],
      };
      const scene2: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5, length: 4, height: 2.8 },
        objects: [
          {
            id: 'obj-1',
            assetId: 'sofa-modern-3seater',
            name: 'Sofa',
            position: [0, 0, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [2.1, 0.85, 0.9],
          },
        ],
      };

      useEditorStore.setState({
        currentDesignId: 'design-42',
        scene: scene2,
        history: [scene1],
        future: [],
      });

      // Execute undo
      useEditorStore.getState().undo();

      // State is restored to scene1
      expect(useEditorStore.getState().scene.objects.length).toBe(0);
      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(mockPersist).toHaveBeenCalledWith('design-42', expect.objectContaining({ objects: [] }));

      // Telemetry recorded persistent undo
      const events = getClientTelemetryEvents();
      const undoEvent = events.find((e) => e.eventName === 'persistent_undo_executed');
      expect(undoEvent).toBeDefined();
      expect(undoEvent?.designId).toBe('design-42');
    });

    it('handles 409 Concurrency Conflict gracefully without crashing store state', async () => {
      const mockPersist = vi.mocked(designApi.persistDesignScene);
      const conflictError: any = new Error('Design was modified concurrently.');
      conflictError.status = 409;
      mockPersist.mockRejectedValueOnce(conflictError);

      useEditorStore.setState({
        currentDesignId: 'design-99',
        scene: {
          schemaVersion: 1,
          unit: 'm',
          room: { width: 5, length: 4, height: 2.8 },
          objects: [],
        },
      });

      const result = await useEditorStore.getState().syncCurrentDesignToBackend();
      expect(result).toBeNull();
      expect(useEditorStore.getState().isSyncingPersistence).toBe(false);
      expect(useEditorStore.getState().lastSyncError).toContain('concurrently');

      // Telemetry captures ERR_STALE_CONCURRENCY
      const events = getClientTelemetryEvents();
      const failEvent = events.find((e) => e.eventName === 'persistent_sync_failed');
      expect(failEvent).toBeDefined();
      expect(failEvent?.errorCode).toBe(SPATIAL_ERROR_CODES.ERR_STALE_CONCURRENCY);
    });
  });

  describe('Investigation C: Preview Resource Lifecycle & Clean Disposal', () => {
    it('manages preview store state transitions cleanly without touching canonical scene', () => {
      const initialScene: CanonicalScene = {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5, length: 4, height: 2.8 },
        objects: [
          {
            id: 'orig-sofa',
            assetId: 'sofa-modern-3seater',
            name: 'Original Sofa',
            position: [0, 0, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [2.1, 0.85, 0.9],
          },
        ],
      };
      useEditorStore.setState({ scene: initialScene });

      const candidateMock: LayoutCandidateRecord = {
        id: 'cand-test-1',
        schema_version: 1,
        label: 'Candidate 1',
        description: 'Test layout',
        reasoning_summary: 'Reasoning',
        is_valid: true,
        is_approval_eligible: true,
        score: {
          boundary: 100,
          collision: 100,
          circulation: 100,
          clearance: 100,
          utilization: 90,
          budget: 100,
          overall: 99,
          weights: { boundary: 0.25, collision: 0.25, circulation: 0.2, clearance: 0.15, utilization: 0.1, budget: 0.05 },
          explanations: {},
          budget_evaluated: true,
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
          ...initialScene,
          objects: [
            ...initialScene.objects,
            {
              id: 'cand-table',
              assetId: 'table-coffee-wood',
              name: 'Coffee Table',
              position: [0, 0, 1.2],
              rotationEuler: [0, 0, 0],
              scale: [1, 1, 1],
              dimensions: [1.1, 0.45, 0.6],
            },
          ],
        },
        source_scene_hash: 'hash-abc',
        trade_offs: [],
      };

      // 1. Start Preview
      usePreviewStore.getState().startPreview('run-100', candidateMock, [candidateMock]);
      expect(usePreviewStore.getState().status).toBe('active');
      expect(usePreviewStore.getState().activeCandidate?.id).toBe('cand-test-1');
      expect(usePreviewStore.getState().previewScene?.objects.length).toBe(2);

      // Canonical scene in editor remains unchanged
      expect(useEditorStore.getState().scene.objects.length).toBe(1);

      // 2. Discard Preview
      usePreviewStore.getState().discardPreview();
      expect(usePreviewStore.getState().status).toBe('discarded');
      expect(usePreviewStore.getState().activeCandidate).toBeNull();
      expect(usePreviewStore.getState().previewScene).toBeNull();
      expect(usePreviewStore.getState().allCandidates.length).toBe(0);

      // Canonical scene still untouched
      expect(useEditorStore.getState().scene.objects.length).toBe(1);
    });
  });

  describe('Privacy-Conscious Spatial Telemetry', () => {
    it('sanitizes user prompt removing private text while retaining category and hash', () => {
      const prompt = 'Please place a luxury velvet sofa under 50000';
      const sanitized = sanitizePromptClient(prompt);

      expect(sanitized.length).toBe(prompt.length);
      expect(sanitized.category).toBe('living');
      expect(sanitized.hash.length).toBe(8);
      // Ensure cleartext prompt words do not leak into return object
      expect((sanitized as any).prompt).toBeUndefined();
    });

    it('summarizes coarse scene metrics without raw geometry or vertex arrays', () => {
      const complexScene = {
        room: {
          width: 6,
          length: 5,
          footprint: [
            [0, 0],
            [6, 0],
            [6, 5],
            [0, 5],
          ],
        },
        objects: [{ id: '1' }, { id: '2' }, { id: '3' }],
      };
      const summary = summarizeSceneClient(complexScene);

      expect(summary.objectCount).toBe(3);
      expect(summary.approxAreaSqm).toBe(30);
      expect(summary.isPolygon).toBe(true);
      expect(summary.wallCount).toBe(4);
      // Raw arrays should not be present
      expect((summary as any).footprint).toBeUndefined();
    });

    it('records spatial telemetry events into safe buffer and handles errors silently', () => {
      trackSpatialEvent({
        eventName: 'candidate_preview_selected',
        designId: 42,
        candidateMetrics: {
          candidateCount: 3,
          validCandidateCount: 2,
          selectedCandidateId: 'cand-1',
          overallScore: 95.5,
        },
      });

      const events = getClientTelemetryEvents();
      expect(events.length).toBe(1);
      expect(events[0].eventName).toBe('candidate_preview_selected');
      expect(events[0].designId).toBe(42);
      expect(events[0].candidateMetrics?.overallScore).toBe(95.5);
    });
  });
});
