import React, { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  Check,
  Palette,
  Layers,
  Sparkles,
  ShieldCheck,
  RotateCcw,
  AlertTriangle,
  Coins,
} from 'lucide-react';
import type {
  DesignPreferences,
  InteriorStyle,
  ColourPreference,
  MaterialPreference,
  LayoutPreference,
  FunctionalPriority,
} from '../../types/preferenceTypes';
import { PREFERENCE_TAXONOMY_LABELS } from '../../types/preferenceTypes';
import type { CanonicalScene } from '../../types/scene';

interface PreferenceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPreferences: DesignPreferences;
  onSavePreferences: (updated: DesignPreferences, saveAsDefault: boolean) => Promise<void>;
  onResetPreferences: () => Promise<void>;
  scene?: CanonicalScene;
}

export const PreferenceSettingsModal: React.FC<PreferenceSettingsModalProps> = ({
  isOpen,
  onClose,
  currentPreferences,
  onSavePreferences,
  onResetPreferences,
  scene,
}) => {
  const [styles, setStyles] = useState<InteriorStyle[]>([]);
  const [colours, setColours] = useState<ColourPreference[]>([]);
  const [materials, setMaterials] = useState<MaterialPreference[]>([]);
  const [layouts, setLayouts] = useState<LayoutPreference[]>([]);
  const [priorities, setPriorities] = useState<FunctionalPriority[]>([]);
  const [preserveIds, setPreserveIds] = useState<string[]>([]);
  const [maxBudgetRupees, setMaxBudgetRupees] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStyles(currentPreferences.style_preferences || []);
      setColours(currentPreferences.colour_preferences || []);
      setMaterials(currentPreferences.material_preferences || []);
      setLayouts(currentPreferences.layout_preferences || []);
      setPriorities(currentPreferences.functional_priorities || []);
      setPreserveIds(currentPreferences.preservation_preferences?.preserve_object_ids || []);
      const paise = currentPreferences.budget_preferences?.max_budget_paise;
      setMaxBudgetRupees(paise ? String(Math.round(paise / 100)) : '');
    }
  }, [isOpen, currentPreferences]);

  if (!isOpen) return null;

  const toggleItem = <T,>(list: T[], item: T, setter: React.Dispatch<React.SetStateAction<T[]>>) => {
    if (list.includes(item)) {
      setter(list.filter((x) => x !== item));
    } else {
      setter([...list, item]);
    }
  };

  const handleApply = async (saveAsDefault: boolean) => {
    setIsSaving(true);
    try {
      const budgetPaise = maxBudgetRupees.trim() ? Math.round(Number(maxBudgetRupees) * 100) : undefined;
      const updated: DesignPreferences = {
        ...currentPreferences,
        style_preferences: styles,
        colour_preferences: colours,
        material_preferences: materials,
        layout_preferences: layouts,
        functional_priorities: priorities,
        budget_preferences: budgetPaise ? { max_budget_paise: budgetPaise, currency: 'INR' } : {},
        preservation_preferences: {
          preserve_object_ids: preserveIds,
          preserve_all_existing: preserveIds.length === (scene?.objects.length || 0) && preserveIds.length > 0,
        },
      };
      await onSavePreferences(updated, saveAsDefault);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      await onResetPreferences();
      setStyles([]);
      setColours([]);
      setMaterials([]);
      setLayouts([]);
      setPriorities([]);
      setPreserveIds([]);
      setMaxBudgetRupees('');
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const hasConflict =
    (layouts.includes('open_space') || layouts.includes('max_usable_floor')) &&
    priorities.includes('storage') &&
    layouts.length === 1 &&
    priorities.length === 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Design Preferences & Priorities</h2>
              <p className="text-xs text-slate-400">Customize style, palette, layout, and functional priorities</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm">
          {hasConflict && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <div>
                <strong>Potential Contradiction:</strong> 'Open & Spacious Floor' priority directly opposes heavy 'Storage' requirements. The AI will prioritize balanced circulation.
              </div>
            </div>
          )}

          {/* Interior Styles */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Interior Styles
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERENCE_TAXONOMY_LABELS.styles) as InteriorStyle[]).map((st) => {
                const selected = styles.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => toggleItem(styles, st, setStyles)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5 inline mr-1 text-indigo-400" />}
                    {PREFERENCE_TAXONOMY_LABELS.styles[st]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Palette & Colours */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <Palette className="w-4 h-4 text-emerald-400" />
              Colour Palette
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERENCE_TAXONOMY_LABELS.colours) as ColourPreference[]).map((cp) => {
                const selected = colours.includes(cp);
                return (
                  <button
                    key={cp}
                    type="button"
                    onClick={() => toggleItem(colours, cp, setColours)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />}
                    {PREFERENCE_TAXONOMY_LABELS.colours[cp]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Materials */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <Layers className="w-4 h-4 text-amber-400" />
              Primary Materials
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERENCE_TAXONOMY_LABELS.materials) as MaterialPreference[]).map((mp) => {
                const selected = materials.includes(mp);
                return (
                  <button
                    key={mp}
                    type="button"
                    onClick={() => toggleItem(materials, mp, setMaterials)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-amber-600/30 border-amber-500 text-amber-200 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5 inline mr-1 text-amber-400" />}
                    {PREFERENCE_TAXONOMY_LABELS.materials[mp]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Layout Intent */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <Sliders className="w-4 h-4 text-cyan-400" />
              Layout Intent & Space Distribution
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERENCE_TAXONOMY_LABELS.layouts) as LayoutPreference[]).map((lp) => {
                const selected = layouts.includes(lp);
                return (
                  <button
                    key={lp}
                    type="button"
                    onClick={() => toggleItem(layouts, lp, setLayouts)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-cyan-600/30 border-cyan-500 text-cyan-200 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5 inline mr-1 text-cyan-400" />}
                    {PREFERENCE_TAXONOMY_LABELS.layouts[lp]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Functional Priorities */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              Functional Priorities
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERENCE_TAXONOMY_LABELS.priorities) as FunctionalPriority[]).map((fp) => {
                const selected = priorities.includes(fp);
                return (
                  <button
                    key={fp}
                    type="button"
                    onClick={() => toggleItem(priorities, fp, setPriorities)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      selected
                        ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {selected && <Check className="w-3.5 h-3.5 inline mr-1 text-purple-400" />}
                    {PREFERENCE_TAXONOMY_LABELS.priorities[fp]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preservation & Budget Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
            {/* Preservation Checklist */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">
                Preserve Existing Furniture
              </label>
              {scene && scene.objects.length > 0 ? (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {scene.objects.map((obj) => {
                    const isPreserved = preserveIds.includes(obj.id);
                    return (
                      <label
                        key={obj.id}
                        className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer p-1.5 rounded hover:bg-slate-800/80"
                      >
                        <input
                          type="checkbox"
                          checked={isPreserved}
                          onChange={() => toggleItem(preserveIds, obj.id, setPreserveIds)}
                          className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900"
                        />
                        <span className="truncate">{obj.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No furniture items currently in scene.</p>
              )}
            </div>

            {/* Optional Budget Ceiling */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">
                Budget Cap (₹ INR)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Coins className="w-4 h-4" />
                </div>
                <input
                  type="number"
                  placeholder="e.g. 50000 (optional)"
                  value={maxBudgetRupees}
                  onChange={(e) => setMaxBudgetRupees(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-800/80 border border-slate-700/80 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Leave empty for unconstrained budget.</p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/95">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleApply(false)}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Use for this Request
            </button>
            <button
              type="button"
              onClick={() => handleApply(true)}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-colors"
            >
              Save as Default Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
