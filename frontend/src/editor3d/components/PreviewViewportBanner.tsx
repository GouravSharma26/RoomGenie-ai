import React from 'react';
import { Eye, X, Layers, AlertCircle, CheckCircle2 } from 'lucide-react';
import { usePreviewStore } from '../store/previewStore';

export const PreviewViewportBanner: React.FC = () => {
  const status = usePreviewStore((state) => state.status);
  const activeCandidate = usePreviewStore((state) => state.activeCandidate);
  const exitPreview = usePreviewStore((state) => state.exitPreview);
  const setComparisonOpen = usePreviewStore((state) => state.setComparisonOpen);

  const isPreviewActive = status === 'active' || status === 'switching';

  if (!isPreviewActive || !activeCandidate) return null;

  const isValid = activeCandidate.is_valid && activeCandidate.is_approval_eligible;

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 backdrop-blur-xl border border-indigo-500/40 rounded-full shadow-2xl text-xs select-none transition-all duration-200"
      data-testid="preview-viewport-banner"
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
        <Eye className="w-4 h-4 text-indigo-400" />
        <span className="font-semibold text-white tracking-wide">
          Preview: {activeCandidate.label}
        </span>
      </div>

      <div className="h-3.5 w-px bg-slate-700" />

      {/* Score badge */}
      <div
        className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold border flex items-center gap-1 ${
          isValid
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
        }`}
        data-testid="preview-banner-score"
      >
        {isValid ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        ) : (
          <AlertCircle className="w-3 h-3 text-rose-400" />
        )}
        <span>{activeCandidate.score?.overall?.toFixed(1) ?? '0.0'} / 100</span>
      </div>

      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium hidden sm:inline">
        Read-Only 3D Inspection
      </span>

      <div className="h-3.5 w-px bg-slate-700" />

      {/* Compare button */}
      <button
        onClick={() => setComparisonOpen(true)}
        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-[11px] flex items-center gap-1 transition"
        data-testid="preview-banner-compare-btn"
        title="Compare all candidate options"
      >
        <Layers className="w-3 h-3" />
        <span>Compare</span>
      </button>

      {/* Exit preview button */}
      <button
        onClick={exitPreview}
        className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
        data-testid="preview-banner-exit-btn"
        title="Exit preview (restore current scene)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
