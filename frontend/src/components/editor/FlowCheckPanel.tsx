import React, { useState } from 'react';
import { 
  Footprints, 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle2, 
  ChevronUp, 
  ChevronDown, 
  X 
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import type { CirculationIssue } from '../../spatial/occupancy/walkabilityTypes';

interface FlowCheckPanelProps {
  onClose?: () => void;
}

export const FlowCheckPanel: React.FC<FlowCheckPanelProps> = ({ onClose }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const walkabilityAnalysis = useEditorStore((state) => state.walkabilityAnalysis);
  const showWalkabilityOverlay = useEditorStore((state) => state.showWalkabilityOverlay);
  const toggleWalkabilityOverlay = useEditorStore((state) => state.toggleWalkabilityOverlay);
  const selectObject = useEditorStore((state) => state.selectObject);

  if (!showWalkabilityOverlay || !walkabilityAnalysis) {
    return null;
  }

  const { circulation } = walkabilityAnalysis;
  const { walkabilityScore, issues, accessibleFurnitureCount, totalFurnitureCount, narrowestPassageMeters } =
    circulation;

  const getScoreBadgeColor = (score: number) => {
    if (score >= 85) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (score >= 65) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  };

  const handleFocusFurniture = (issue: CirculationIssue) => {
    if (issue.affectedFurnitureIds && issue.affectedFurnitureIds.length > 0) {
      selectObject(issue.affectedFurnitureIds[0]);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4 pointer-events-none">
      <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto transition-all duration-300">
        {/* Header Bar */}
        <div className="px-5 py-3.5 flex items-center justify-between bg-slate-950/70 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Footprints className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-white tracking-tight">Flow Check</h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${getScoreBadgeColor(
                    walkabilityScore
                  )}`}
                >
                  {issues.length === 0
                    ? `Optimal Flow · ${walkabilityScore}/100`
                    : `${issues.length} issue${issues.length > 1 ? 's' : ''} to fix`}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {accessibleFurnitureCount}/{totalFurnitureCount} items reachable &bull; Narrowest corridor:{' '}
                {(narrowestPassageMeters * 100).toFixed(0)}cm
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose || toggleWalkabilityOverlay}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
              title="Close Flow Check"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Expandable Issue List */}
        {isExpanded && (
          <div className="p-4 max-h-64 overflow-y-auto space-y-2.5 divide-y divide-slate-800/50">
            {issues.length === 0 ? (
              <div className="py-4 flex items-center gap-3 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-200">Excellent Room Circulation</p>
                  <p className="text-[11px] text-slate-400">
                    All furniture items are freely accessible from the entrance with clear pathways.
                  </p>
                </div>
              </div>
            ) : (
              issues.map((issue) => {
                const isError = issue.severity === 'error';
                return (
                  <div
                    key={issue.id}
                    className="pt-2.5 first:pt-0 flex items-start justify-between gap-3 group"
                  >
                    <div className="flex items-start gap-2.5">
                      {isError ? (
                        <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-200 group-hover:text-white transition">
                            {issue.title}
                          </p>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase ${
                              isError
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {issue.severity}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                          {issue.description}
                        </p>
                        {issue.recommendation && (
                          <p className="text-[10px] text-indigo-300/90 mt-1 italic">
                            Tip: {issue.recommendation}
                          </p>
                        )}
                      </div>
                    </div>

                    {issue.affectedFurnitureIds && issue.affectedFurnitureIds.length > 0 && (
                      <button
                        onClick={() => handleFocusFurniture(issue)}
                        className="flex-shrink-0 px-2 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md border border-slate-700 transition"
                      >
                        Focus
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
