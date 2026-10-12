import React from 'react';
import { 
  RotateCcw, 
  Trash2, 
  HelpCircle, 
  Compass, 
  Layers,
  Cloud
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';

interface EditorHeaderProps {
  onOpenHelp: () => void;
  onOpenSaveLoad: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({ onOpenHelp, onOpenSaveLoad }) => {
  const room = useEditorStore((state) => state.scene.room);
  const objects = useEditorStore((state) => state.scene.objects);
  const setRoomDimensions = useEditorStore((state) => state.setRoomDimensions);
  const triggerCameraReset = useEditorStore((state) => state.triggerCameraReset);
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const clearScene = useEditorStore((state) => state.clearScene);

  // Deterministic price calculation from catalogue
  const totalBudgetPaise = objects.reduce((total, obj) => {
    const catalogItem = SAMPLE_CATALOG.find((item) => item.id === obj.assetId);
    return total + (catalogItem ? catalogItem.pricePaise : 0);
  }, 0);

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
            <span className="text-[10px] text-slate-400 block">
              {objects.length} item{objects.length === 1 ? '' : 's'} placed &bull; ₹{totalBudgetRupees}
            </span>
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
