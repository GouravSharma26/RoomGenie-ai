import React, { useState, useRef, useEffect } from 'react';
import { 
  RotateCcw, 
  Trash2, 
  HelpCircle, 
  Compass, 
  Layers, 
  Cloud, 
  DollarSign,
  Sparkles,
  Camera,
  Smartphone,
  Activity,
  Undo2,
  Redo2,
  Magnet,
  ChevronDown
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { SUPPORTED_GRID_SIZES } from '../../spatial';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import { getActiveSession } from '../../services/evaluationTelemetry';

interface EditorHeaderProps {
  onOpenHelp: () => void;
  onOpenSaveLoad: () => void;
  onOpenBudgetBreakdown?: () => void;
  onOpenAiAssistant?: () => void;
  onOpenPhotoVision?: () => void;
  onOpenPhotoTo3D?: () => void;
  onOpenArPlacement?: () => void;
  onOpenEvaluationTrial?: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
  onOpenHelp,
  onOpenSaveLoad,
  onOpenBudgetBreakdown,
  onOpenAiAssistant,
  onOpenPhotoVision,
  onOpenPhotoTo3D,
  onOpenArPlacement,
  onOpenEvaluationTrial,
}) => {
  const room = useEditorStore((state) => state.scene.room);
  const objects = useEditorStore((state) => state.scene.objects);
  const setRoomDimensions = useEditorStore((state) => state.setRoomDimensions);
  const triggerCameraReset = useEditorStore((state) => state.triggerCameraReset);
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const clearScene = useEditorStore((state) => state.clearScene);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.history.length > 0);
  const canRedo = useEditorStore((state) => state.future.length > 0);
  const snapConfig = useEditorStore((state) => state.snapConfig);
  const toggleSnapEnabled = useEditorStore((state) => state.toggleSnapEnabled);
  const toggleWallSnap = useEditorStore((state) => state.toggleWallSnap);
  const toggleAlignmentSnap = useEditorStore((state) => state.toggleAlignmentSnap);
  const toggleGridSnap = useEditorStore((state) => state.toggleGridSnap);
  const setGridSize = useEditorStore((state) => state.setGridSize);

  const [showSnapMenu, setShowSnapMenu] = useState(false);
  const snapMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (snapMenuRef.current && !snapMenuRef.current.contains(e.target as Node)) {
        setShowSnapMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Deterministic price calculation from catalogue
  const totalBudgetPaise = objects.reduce((total, obj) => {
    const catalogItem = SAMPLE_CATALOG.find((item) => item.id === obj.assetId);
    return total + (catalogItem && catalogItem.pricePaise !== null ? catalogItem.pricePaise : 0);
  }, 0);

  const unpricedCount = objects.filter((obj) => {
    const catalogItem = SAMPLE_CATALOG.find((item) => item.id === obj.assetId);
    return !catalogItem || catalogItem.pricePaise === null;
  }).length;

  const totalBudgetRupees = (totalBudgetPaise / 100).toLocaleString('en-IN');

  const handleDimensionChange = (key: 'width' | 'length' | 'height', val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setRoomDimensions({ [key]: num });
    }
  };

  return (
    <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-4 z-20">
      {/* Title & Dimension Inputs */}
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-white block">
              3D Room Editor
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-slate-400">
                {objects.length} item{objects.length === 1 ? '' : 's'} placed &bull; ₹{totalBudgetRupees}
                {unpricedCount > 0 && (
                  <span className="text-amber-400 font-medium ml-1">
                    (+{unpricedCount} unpriced)
                  </span>
                )}
              </span>
              {onOpenBudgetBreakdown && (
                <button
                  onClick={onOpenBudgetBreakdown}
                  title="View Authoritative Budget Breakdown & Room Containment"
                  className="px-1.5 py-0.2 rounded bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 hover:text-white text-[9px] font-semibold transition inline-flex items-center gap-0.5"
                >
                  <DollarSign className="w-2.5 h-2.5" />
                  Breakdown
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Room Size Dimensions Form */}
        <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-1.5 text-xs text-slate-300">
          <span className="text-slate-400 font-medium text-[11px] mr-1">Room (m):</span>
          <div className="flex items-center gap-1">
            <label className="text-slate-500 font-mono text-[10px]">W</label>
            <input
              type="number"
              min="2"
              max="20"
              step="0.5"
              value={room.width}
              onChange={(e) => handleDimensionChange('width', e.target.value)}
              className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white font-mono focus:border-indigo-500 outline-none"
              title="Room Width in metres"
            />
          </div>
          <span className="text-slate-600">&times;</span>
          <div className="flex items-center gap-1">
            <label className="text-slate-500 font-mono text-[10px]">L</label>
            <input
              type="number"
              min="2"
              max="20"
              step="0.5"
              value={room.length}
              onChange={(e) => handleDimensionChange('length', e.target.value)}
              className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white font-mono focus:border-indigo-500 outline-none"
              title="Room Length in metres"
            />
          </div>
          <span className="text-slate-600">&times;</span>
          <div className="flex items-center gap-1">
            <label className="text-slate-500 font-mono text-[10px]">H</label>
            <input
              type="number"
              min="2"
              max="6"
              step="0.1"
              value={room.height}
              onChange={(e) => handleDimensionChange('height', e.target.value)}
              className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white font-mono focus:border-indigo-500 outline-none"
              title="Room Height in metres"
            />
          </div>
        </div>
      </div>

      {/* Quick Action Tools */}
      <div className="flex items-center gap-2">
        {/* Undo Button */}
        <button
          onClick={undo}
          disabled={!canUndo}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
          title="Undo last action (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Undo</span>
        </button>

        {/* Redo Button */}
        <button
          onClick={redo}
          disabled={!canRedo}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
          title="Redo last undone action (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Redo</span>
        </button>

        {/* Reset Camera Button */}
        <button
          onClick={triggerCameraReset}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
          title="Reset 3D camera to default perspective view"
        >
          <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
          <span>Reset Camera</span>
        </button>

        {/* View Mode Toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'perspective' ? 'top' : 'perspective')}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
          title="Switch between 3D Perspective and 2D Top Floor-plan View"
        >
          <Compass className="w-3.5 h-3.5 text-indigo-400" />
          <span>{viewMode === 'perspective' ? 'Top View' : '3D View'}</span>
        </button>

        {/* Smart Magnetic Snapping Dropdown */}
        <div className="relative" ref={snapMenuRef}>
          <button
            onClick={() => setShowSnapMenu((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition active:scale-95 ${
              snapConfig.enabled
                ? 'bg-indigo-950/80 border-indigo-600/70 text-indigo-300 hover:bg-indigo-900/80'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
            title="Configure Smart Magnetic Snapping (Wall, Alignment, Grid)"
          >
            <Magnet className={`w-3.5 h-3.5 ${snapConfig.enabled ? 'text-indigo-400' : 'text-slate-500'}`} />
            <span>Snap: {snapConfig.enabled ? 'ON' : 'OFF'}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {showSnapMenu && (
            <div className="absolute right-0 mt-2 w-72 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl p-3.5 space-y-3 z-50 text-xs text-slate-200">
              {/* Header & Master Toggle */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Magnet className="w-4 h-4 text-indigo-400" />
                  <span className="font-semibold text-white text-xs">Smart Snapping</span>
                </div>
                <button
                  onClick={toggleSnapEnabled}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    snapConfig.enabled ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                  title="Toggle master snapping"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      snapConfig.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Sub-toggles */}
              <div className="space-y-2 pt-0.5">
                {/* Wall Snapping */}
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-slate-200 group-hover:text-white">Wall Snapping</span>
                    <span className="text-[10px] text-slate-400">Flush attachment (15cm)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={snapConfig.wallSnap}
                    onChange={toggleWallSnap}
                    disabled={!snapConfig.enabled}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0 disabled:opacity-40"
                  />
                </label>

                {/* Alignment Snapping */}
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-slate-200 group-hover:text-white">Object Alignment</span>
                    <span className="text-[10px] text-slate-400">Center & edge match (5cm)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={snapConfig.alignmentSnap}
                    onChange={toggleAlignmentSnap}
                    disabled={!snapConfig.enabled}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0 disabled:opacity-40"
                  />
                </label>

                {/* Grid Snapping */}
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-slate-200 group-hover:text-white">Floor Grid Snap</span>
                    <span className="text-[10px] text-slate-400">Quantize coordinates</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={snapConfig.gridSnap}
                    onChange={toggleGridSnap}
                    disabled={!snapConfig.enabled}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0 disabled:opacity-40"
                  />
                </label>
              </div>

              {/* Grid Size Increment Selector */}
              {snapConfig.gridSnap && (
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1.5">
                    Grid Increment:
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {SUPPORTED_GRID_SIZES.map((size) => (
                      <button
                        key={size.value}
                        onClick={() => setGridSize(size.value)}
                        disabled={!snapConfig.enabled}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition text-center border ${
                          snapConfig.gridSize === size.value
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                        } disabled:opacity-40`}
                      >
                        {size.label.replace(' (Standard)', '')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Room Photo Vision Analysis Trigger */}
        {onOpenPhotoVision && (
          <button
            onClick={onOpenPhotoVision}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
            title="Upload and analyze room photo with AI vision"
          >
            <Camera className="w-3.5 h-3.5 text-pink-400" />
            <span>Room Photo</span>
          </button>
        )}

        {/* Photo-to-3D Reconstruction Trigger */}
        {onOpenPhotoTo3D && (
          <button
            onClick={onOpenPhotoTo3D}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
            title="Reconstruct 3D furniture models from photographs"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Photo to 3D</span>
          </button>
        )}

        {/* AR Real-World Placement Trigger */}
        {onOpenArPlacement && (
          <button
            onClick={onOpenArPlacement}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
            title="Preview furniture in real-world space using Augmented Reality (AR)"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span>AR View</span>
          </button>
        )}

        {/* Study Evaluation Trial Trigger */}
        {onOpenEvaluationTrial && (
          <button
            onClick={onOpenEvaluationTrial}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 transition active:scale-95 border ${
              getActiveSession()
                ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300 hover:bg-emerald-600/30 shadow-emerald-900/20'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title="Open Research Evaluation Protocol & Telemetry Modal"
          >
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              {getActiveSession() ? `Trial: ${getActiveSession()?.participantId}` : 'Study Trial'}
            </span>
          </button>
        )}

        {/* AI Design Assistant Trigger */}
        <button
          onClick={onOpenAiAssistant}
          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/25 flex items-center gap-1.5 transition active:scale-95 border border-purple-400/40"
          title="Open AI Interior Design Assistant"
        >
          <Sparkles className="w-3.5 h-3.5 text-yellow-300 animate-pulse" />
          <span>AI Designer</span>
        </button>

        {/* Save & Load Designs Button */}
        <button
          onClick={onOpenSaveLoad}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm flex items-center gap-1.5 transition active:scale-95 border border-indigo-500/50"
          title="Save or Load room design snapshots to backend database"
        >
          <Cloud className="w-3.5 h-3.5" />
          <span>Save &amp; Load</span>
        </button>

        {/* Clear Scene Button */}
        {objects.length > 0 && (
          <button
            onClick={clearScene}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 text-xs font-medium border border-slate-700/80 hover:border-rose-800/50 flex items-center gap-1 transition"
            title="Remove all furniture objects from room"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}

        {/* Controls Help Modal Trigger */}
        <button
          onClick={onOpenHelp}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="View Keyboard & Mouse Navigation Controls"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
