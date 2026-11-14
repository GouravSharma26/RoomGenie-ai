import { create } from 'zustand';
import type { CanonicalScene } from '../../types/scene';
import type { LayoutCandidateRecord } from '../../services/agentApi';

export type CandidatePreviewStatus =
  | 'idle'
  | 'loading'
  | 'active'
  | 'switching'
  | 'error'
  | 'discarded'
  | 'applied'
  | 'stale';

interface PreviewState {
  status: CandidatePreviewStatus;
  runId: string | null;
  activeCandidateId: string | null;
  activeCandidate: LayoutCandidateRecord | null;
  previewScene: CanonicalScene | null;
  allCandidates: LayoutCandidateRecord[];
  comparisonOpen: boolean;
  errorMessage: string | null;

  // Actions
  startPreview: (runId: string, candidate: LayoutCandidateRecord, allCandidates?: LayoutCandidateRecord[]) => void;
  switchCandidate: (candidate: LayoutCandidateRecord) => void;
  exitPreview: () => void;
  discardPreview: () => void;
  setComparisonOpen: (open: boolean) => void;
  markStale: () => void;
  setError: (msg: string) => void;
  clear: () => void;
}

function deepCloneScene(scene: CanonicalScene): CanonicalScene {
  return JSON.parse(JSON.stringify(scene));
}

export const usePreviewStore = create<PreviewState>((set) => ({
  status: 'idle',
  runId: null,
  activeCandidateId: null,
  activeCandidate: null,
  previewScene: null,
  allCandidates: [],
  comparisonOpen: false,
  errorMessage: null,

  startPreview: (runId, candidate, allCandidates = []) => {
    try {
      const cloned = candidate.candidate_scene ? deepCloneScene(candidate.candidate_scene) : null;
      set({
        status: 'active',
        runId,
        activeCandidateId: candidate.id,
        activeCandidate: candidate,
        previewScene: cloned,
        allCandidates: allCandidates.length > 0 ? allCandidates : [candidate],
        errorMessage: null,
      });
    } catch (err: any) {
      set({
        status: 'error',
        errorMessage: err.message || 'Failed to initialize candidate preview scene.',
      });
    }
  },

  switchCandidate: (candidate) => {
    try {
      const cloned = candidate.candidate_scene ? deepCloneScene(candidate.candidate_scene) : null;
      set({
        status: 'active',
        activeCandidateId: candidate.id,
        activeCandidate: candidate,
        previewScene: cloned,
        errorMessage: null,
      });
    } catch (err: any) {
      set({
        status: 'error',
        errorMessage: err.message || 'Failed to switch candidate preview.',
      });
    }
  },

  exitPreview: () => {
    set({
      status: 'idle',
      runId: null,
      activeCandidateId: null,
      activeCandidate: null,
      previewScene: null,
      allCandidates: [],
      errorMessage: null,
    });
  },

  discardPreview: () => {
    set({
      status: 'discarded',
      runId: null,
      activeCandidateId: null,
      activeCandidate: null,
      previewScene: null,
      allCandidates: [],
      errorMessage: null,
    });
  },

  setComparisonOpen: (open) => {
    set({ comparisonOpen: open });
  },

  markStale: () => {
    set({
      status: 'stale',
      errorMessage: 'The design scene was modified; this proposal preview is now stale.',
    });
  },

  setError: (msg) => {
    set({
      status: 'error',
      errorMessage: msg,
    });
  },

  clear: () => {
    set({
      status: 'idle',
      runId: null,
      activeCandidateId: null,
      activeCandidate: null,
      previewScene: null,
      allCandidates: [],
      comparisonOpen: false,
      errorMessage: null,
    });
  },
}));
