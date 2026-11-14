import React from 'react';
import { 
  X, 
  Layers, 
  Eye, 
  Check, 
  AlertCircle, 
  CheckCircle2, 
  Info
} from 'lucide-react';
import { usePreviewStore } from '../../editor3d/store/previewStore';
import type { LayoutCandidateRecord } from '../../services/agentApi';

interface CandidateComparisonModalProps {
  candidates?: LayoutCandidateRecord[];
  onApplyCandidate?: (candidate: LayoutCandidateRecord) => void;
}

export const CandidateComparisonModal: React.FC<CandidateComparisonModalProps> = ({
  candidates: propCandidates,
  onApplyCandidate,
}) => {
  const isOpen = usePreviewStore((state) => state.comparisonOpen);
  const setComparisonOpen = usePreviewStore((state) => state.setComparisonOpen);
  const storeCandidates = usePreviewStore((state) => state.allCandidates);
  const activeCandidateId = usePreviewStore((state) => state.activeCandidateId);
  const switchCandidate = usePreviewStore((state) => state.switchCandidate);

  const candidates = (propCandidates && propCandidates.length > 0) ? propCandidates : storeCandidates;

  if (!isOpen || candidates.length === 0) return null;

  const handlePreview = (cand: LayoutCandidateRecord) => {
    switchCandidate(cand);
  };

  const handleApply = (cand: LayoutCandidateRecord) => {
    if (onApplyCandidate) {
      onApplyCandidate(cand);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
      data-testid="candidate-comparison-modal"
    >
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Compare Layout Candidates ({candidates.length})
              </h2>
              <p className="text-xs text-slate-400">
                Inspect physical validation dimensions, trade-offs, and estimated budget impacts side-by-side.
              </p>
            </div>
          </div>
          <button
            onClick={() => setComparisonOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            data-testid="close-comparison-modal-btn"
            title="Close comparison"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Table / Cards Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>
              Quality scores evaluate physical constraints (bounds, collisions, clearances, circulation, and budget caps). Personal style and living preference remain up to your choice.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {candidates.map((cand) => {
              const isSelected = cand.id === activeCandidateId;
              const isValid = cand.is_valid && cand.is_approval_eligible;
              const fatalCount = cand.validation_feedback?.fatal_errors?.length ?? 0;
              const advisoryCount = cand.validation_feedback?.advisory_warnings?.length ?? 0;
              const furnitureCount = cand.candidate_scene?.objects?.length ?? 0;
              const budgetPaise = cand.budget_diff?.diff_paise ?? 0;

              return (
                <div
                  key={cand.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between space-y-4 transition-all ${
                    isSelected
                      ? 'bg-indigo-950/30 border-indigo-500/80 ring-1 ring-indigo-500/50 shadow-lg'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                  data-testid={`comparison-card-${cand.id}`}
                >
                  <div className="space-y-3">
                    {/* Card Title & Score */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-3">
                      <div>
                        <span className="text-[10px] font-mono font-semibold text-slate-400 block">
                          Rank #{cand.rank ?? 1}
                        </span>
                        <h3 className="font-bold text-sm text-white">{cand.label}</h3>
                        <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{cand.description}</p>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${
                            isValid
                              ? (cand.score.overall >= 80 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30')
                              : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          }`}
                        >
                          {cand.score.overall.toFixed(1)} / 100
                        </span>
                        <span className="text-[9px] text-slate-500 mt-0.5 font-semibold uppercase">
                          {isValid ? 'Quality Score' : 'Hard Failure'}
                        </span>
                      </div>
                    </div>

                    {/* Dimensions Comparison Grid */}
                    <div className="space-y-1.5 text-[11px]">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        6-Component Scores
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px]">
                        <div className="flex justify-between p-1 rounded bg-slate-900 border border-slate-800">
                          <span className="text-slate-400">Boundary (25%)</span>
                          <span className="font-mono text-white">{cand.score.boundary.toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between p-1 rounded bg-slate-900 border border-slate-800">
                          <span className="text-slate-400">Collision (25%)</span>
                          <span className="font-mono text-white">{cand.score.collision.toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between p-1 rounded bg-slate-900 border border-slate-800">
                          <span className="text-slate-400">Circulation (20%)</span>
                          <span className="font-mono text-white">{cand.score.circulation.toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between p-1 rounded bg-slate-900 border border-slate-800">
                          <span className="text-slate-400">Clearances (15%)</span>
                          <span className="font-mono text-white">{cand.score.clearance.toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between p-1 rounded bg-slate-900 border border-slate-800">
                          <span className="text-slate-400">Utilization (10%)</span>
                          <span className="font-mono text-white">{cand.score.utilization.toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between p-1 rounded bg-slate-900 border border-slate-800">
                          <span className="text-slate-400">Budget (5%)</span>
                          <span className="font-mono text-white">{cand.score.budget.toFixed(0)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Metadata summary: furniture count, budget diff, issues */}
                    <div className="space-y-1 text-xs border-t border-slate-800/80 pt-2">
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Furniture Items:</span>
                        <span className="font-medium text-white">{furnitureCount} items</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Budget Impact:</span>
                        <span className="font-mono font-medium text-amber-300">
                          {budgetPaise > 0 ? `+₹${(budgetPaise / 100).toLocaleString('en-IN')}` : '₹0'}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-400">Validation Status:</span>
                        <span className={`flex items-center gap-1 font-medium ${isValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isValid ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> Valid
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3" /> {fatalCount} Fatal Issue{fatalCount === 1 ? '' : 's'}
                            </>
                          )}
                        </span>
                      </div>
                      {advisoryCount > 0 && (
                        <div className="flex justify-between text-amber-400 text-[11px]">
                          <span>Advisory Warnings:</span>
                          <span>{advisoryCount} note{advisoryCount === 1 ? '' : 's'}</span>
                        </div>
                      )}
                    </div>

                    {/* Trade-offs */}
                    {cand.trade_offs && cand.trade_offs.length > 0 && (
                      <div className="border-t border-slate-800/80 pt-2 space-y-1">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                          Trade-offs:
                        </span>
                        <ul className="text-[11px] text-slate-300 space-y-0.5">
                          {cand.trade_offs.map((to, i) => (
                            <li key={i} className="line-clamp-2">• {to}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      onClick={() => handlePreview(cand)}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                      data-testid={`preview-btn-${cand.id}`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isSelected ? 'Previewing' : '3D Preview'}</span>
                    </button>
                    <button
                      onClick={() => handleApply(cand)}
                      disabled={!isValid}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow shadow-emerald-600/20"
                      data-testid={`apply-btn-${cand.id}`}
                      title={isValid ? 'Apply this candidate to 3D scene' : 'Cannot apply invalid candidate'}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
