import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertTriangle, Layers, DollarSign, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { estimateBudget, type BudgetEstimateResponse } from '../../services/designApi';

interface BudgetBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BudgetBreakdownModal: React.FC<BudgetBreakdownModalProps> = ({ isOpen, onClose }) => {
  const scene = useEditorStore((state) => state.scene);
  const [estimate, setEstimate] = useState<BudgetEstimateResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const loadEstimate = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const result = await estimateBudget({ scene_json: scene });
      setEstimate(result);
    } catch (err: any) {
      setApiError(err.message || 'Failed to fetch authoritative budget from server.');
    } finally {
      setIsLoading(false);
    }
  }, [scene]);

  useEffect(() => {
    if (!isOpen) return;
    let isSubscribed = true;

    void Promise.resolve().then(async () => {
      if (!isSubscribed) return;
      setIsLoading(true);
      setApiError(null);
      try {
        const result = await estimateBudget({ scene_json: scene });
        if (isSubscribed) {
          setEstimate(result);
        }
      } catch (err: any) {
        if (isSubscribed) {
          setApiError(err.message || 'Failed to fetch authoritative budget from server.');
        }
      } finally {
        if (isSubscribed) {
          setIsLoading(false);
        }
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, scene]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">
                Deterministic Budget & Cost Estimate
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Authoritative backend calculation in integer paise • INR (₹)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
              <RefreshCw className="w-7 h-7 text-indigo-400 animate-spin" />
              <p className="text-xs">Calculating authoritative budget and boundary constraints...</p>
            </div>
          ) : estimate ? (
            <>
              {/* Grand Total Hero Card */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/60 to-slate-900 border border-indigo-800/40 flex items-center justify-between">
                <div>
                  <span className="text-xs text-indigo-300 font-medium">Estimated Furniture Cost</span>
                  <div className="text-2xl font-black text-white font-mono mt-0.5">
                    ₹{Number(estimate.total_inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {estimate.priced_items_count} of {estimate.total_items} items priced
                  </span>
                </div>

                <div className="text-right">
                  {estimate.has_unknown_prices ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {estimate.unpriced_items_count} Unpriced / Custom
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      100% Verified Known Prices
                    </span>
                  )}
                </div>
              </div>

              {/* Unknown Prices Alert */}
              {estimate.has_unknown_prices && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/50 flex items-start gap-2.5 text-xs text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Missing or Unpriced Assets</span>
                    <span className="text-amber-300/80 text-[11px] leading-relaxed">
                      {estimate.unpriced_items_count} item(s) in this room do not have listed catalogue prices.
                      As per project rules, missing prices are clearly marked as &quot;Price on Request&quot; rather than invented.
                    </span>
                  </div>
                </div>
              )}

              {/* Category Breakdown */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-2.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  Category Subtotals
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {Object.entries(estimate.category_breakdown).map(([catKey, cat]) => (
                    <div
                      key={catKey}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between"
                    >
                      <span className="text-[11px] text-slate-400 capitalize">{cat.category}</span>
                      <div className="mt-1">
                        <span className="text-sm font-bold text-white font-mono">
                          ₹{Number(cat.subtotal_inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {cat.item_count} item{cat.item_count > 1 ? 's' : ''}
                          {cat.has_unpriced && ' • + unpriced'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Room Boundary Containment Check */}
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start justify-between">
                <div className="flex items-start gap-2.5">
                  {estimate.room_constraints.is_valid ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="text-xs font-semibold text-white block">
                      Room Envelope Containment
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {estimate.room_constraints.is_valid
                        ? `All ${estimate.total_items} items are fully contained inside room boundaries (${scene.room.width}m × ${scene.room.length}m × ${scene.room.height}m).`
                        : `${estimate.room_constraints.violations_count} boundary violation(s) detected.`}
                    </span>
                  </div>
                </div>

                {!estimate.room_constraints.is_valid && (
                  <span className="text-[10px] font-bold text-rose-400 bg-rose-950/40 border border-rose-800/50 px-2 py-0.5 rounded">
                    Collision
                  </span>
                )}
              </div>

              {/* Placed Items Table */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-2.5">
                  Itemized Room Furniture
                </h4>
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-medium text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3">Item Name</th>
                        <th className="py-2.5 px-3">Dimensions</th>
                        <th className="py-2.5 px-3 text-right">Price (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {estimate.items.map((item) => (
                        <tr key={item.placement_id} className="hover:bg-slate-900/40 transition">
                          <td className="py-2.5 px-3 text-slate-200">
                            <div className="font-medium text-white">{item.name}</div>
                            <span className="text-[10px] text-slate-500 capitalize">{item.category}</span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                            {item.dimensions[0]}m × {item.dimensions[1]}m × {item.dimensions[2]}m
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            {item.is_known_price ? (
                              <span className="text-white font-semibold">
                                ₹{Number(item.price_inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            ) : (
                              <span className="text-amber-400 text-[10px] bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-800/40">
                                Price on request
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">
              {apiError ? (
                <div className="text-rose-400">{apiError}</div>
              ) : (
                'No items placed in this room design yet.'
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            onClick={loadEstimate}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Recalculate
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
