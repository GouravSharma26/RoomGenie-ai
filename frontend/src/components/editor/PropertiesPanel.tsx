import React from 'react';
import { 
  Sliders, 
  Copy, 
  Trash2, 
  X, 
  RotateCw, 
  Move, 
  Maximize, 
  Palette, 
  Info 
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import type { Vector3Tuple } from '../../types/scene';

const PRESET_COLORS = [
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Amber Oak', value: '#b45309' },
  { name: 'Slate Gray', value: '#334155' },
  { name: 'Emerald', value: '#059669' },
  { name: 'Warm Cream', value: '#d6c7b2' },
  { name: 'Charcoal', value: '#18181b' },
];

export const PropertiesPanel: React.FC = () => {
  const selectedId = useEditorStore((state) => state.selectedId);
  const objects = useEditorStore((state) => state.scene.objects);
  const room = useEditorStore((state) => state.scene.room);
  const selectObject = useEditorStore((state) => state.selectObject);
  const updatePosition = useEditorStore((state) => state.updatePlacementPosition);
  const updateRotation = useEditorStore((state) => state.updatePlacementRotation);
  const updateScale = useEditorStore((state) => state.updatePlacementScale);
  const updateColor = useEditorStore((state) => state.updatePlacementColor);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const startInteraction = useEditorStore((state) => state.startInteraction);
  const endInteraction = useEditorStore((state) => state.endInteraction);

  const selectedObject = objects.find((obj) => obj.id === selectedId);

  if (!selectedObject) {
    return (
      <aside className="w-80 bg-slate-900/95 border-l border-slate-800 p-6 flex flex-col justify-center items-center text-center shrink-0 z-10">
        <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
          <Sliders className="w-6 h-6 text-slate-500" />
        </div>
        <h4 className="font-semibold text-white text-sm">No Object Selected</h4>
        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-[220px]">
          Click any furniture model in the 3D viewport to inspect and modify position, rotation, and dimensions.
        </p>
        <div className="mt-6 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-2 text-left">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <span>Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Backspace</kbd> or <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Delete</kbd> to remove selected items.</span>
        </div>
      </aside>
    );
  }

  const [posX, , posZ] = selectedObject.position;
  const rotYDeg = Math.round(((selectedObject.rotationEuler[1] % (Math.PI * 2)) * 180) / Math.PI);
  const normalizedRotY = ((rotYDeg % 360) + 360) % 360;
  const scaleUniform = selectedObject.scale[0];
  const activeColor = selectedObject.materialOverrides?.color || '#4f46e5';

  const handlePositionXChange = (val: number) => {
    updatePosition(selectedObject.id, [val, selectedObject.position[1], posZ]);
  };

  const handlePositionZChange = (val: number) => {
    updatePosition(selectedObject.id, [posX, selectedObject.position[1], val]);
  };

  const handleRotationYChange = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    updateRotation(selectedObject.id, [0, rad, 0]);
  };

  const handleRotateStep = (deltaDeg: number) => {
    const newDeg = (normalizedRotY + deltaDeg + 360) % 360;
    handleRotationYChange(newDeg);
  };

  const handleScaleChange = (s: number) => {
    const newScale: Vector3Tuple = [s, s, s];
    updateScale(selectedObject.id, newScale);
  };

  const halfW = room.width / 2;
  const halfL = room.length / 2;

  return (
    <aside className="w-80 bg-slate-900/95 border-l border-slate-800 flex flex-col h-full overflow-y-auto shrink-0 z-10 p-5 space-y-6">
      {/* Object Header & Deselect */}
      <div className="flex items-start justify-between border-b border-slate-800 pb-4">
        <div>
          <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider block">
            Selected Item
          </span>
          <h3 className="font-bold text-white text-base mt-0.5">
            {selectedObject.name}
          </h3>
          <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
            ID: {selectedObject.id.substring(0, 16)}...
          </span>
        </div>
        <button
          onClick={() => selectObject(null)}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Deselect"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Position Controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <span className="flex items-center gap-1.5">
            <Move className="w-3.5 h-3.5 text-indigo-400" />
            Position (Floor Metres)
          </span>
        </div>

        {/* X Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>X (Left / Right)</span>
            <span className="font-mono text-white">{posX.toFixed(2)}m</span>
          </div>
          <input
            type="range"
            min={-halfW + 0.3}
            max={halfW - 0.3}
            step="0.05"
            value={posX}
            onChange={(e) => handlePositionXChange(parseFloat(e.target.value))}
            onPointerDown={startInteraction}
            onPointerUp={endInteraction}
            onKeyDown={(e) => { if (e.key.startsWith('Arrow')) startInteraction(); }}
            onKeyUp={(e) => { if (e.key.startsWith('Arrow')) endInteraction(); }}
            onBlur={endInteraction}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        {/* Z Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Z (Forward / Back)</span>
            <span className="font-mono text-white">{posZ.toFixed(2)}m</span>
          </div>
          <input
            type="range"
            min={-halfL + 0.3}
            max={halfL - 0.3}
            step="0.05"
            value={posZ}
            onChange={(e) => handlePositionZChange(parseFloat(e.target.value))}
            onPointerDown={startInteraction}
            onPointerUp={endInteraction}
            onKeyDown={(e) => { if (e.key.startsWith('Arrow')) startInteraction(); }}
            onKeyUp={(e) => { if (e.key.startsWith('Arrow')) endInteraction(); }}
            onBlur={endInteraction}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
      </div>

      {/* Rotation Controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <span className="flex items-center gap-1.5">
            <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
            Rotation ({normalizedRotY}&deg;)
          </span>
        </div>

        <input
          type="range"
          min="0"
          max="360"
          step="5"
          value={normalizedRotY}
          onChange={(e) => handleRotationYChange(parseFloat(e.target.value))}
          onPointerDown={startInteraction}
          onPointerUp={endInteraction}
          onKeyDown={(e) => { if (e.key.startsWith('Arrow')) startInteraction(); }}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow')) endInteraction(); }}
          onBlur={endInteraction}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />

        {/* Quick Rotation Buttons */}
        <div className="grid grid-cols-4 gap-1.5">
          {[-90, -45, 45, 90].map((step) => (
            <button
              key={`rot-${step}`}
              onClick={() => handleRotateStep(step)}
              className="px-2 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[10px] font-mono rounded-lg border border-slate-700/80 transition"
            >
              {step > 0 ? `+${step}°` : `${step}°`}
            </button>
          ))}
        </div>
      </div>

      {/* Scale Multiplier Controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <span className="flex items-center gap-1.5">
            <Maximize className="w-3.5 h-3.5 text-indigo-400" />
            Scale Multiplier ({scaleUniform.toFixed(2)}&times;)
          </span>
          <button
            onClick={() => handleScaleChange(1.0)}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 transition"
          >
            Reset (1&times;)
          </button>
        </div>

        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.05"
          value={scaleUniform}
          onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
          onPointerDown={startInteraction}
          onPointerUp={endInteraction}
          onKeyDown={(e) => { if (e.key.startsWith('Arrow')) startInteraction(); }}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow')) endInteraction(); }}
          onBlur={endInteraction}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />

        <div className="text-[10px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 font-mono">
          Effective Size: {(selectedObject.dimensions[0] * scaleUniform).toFixed(2)}m W &times;{' '}
          {(selectedObject.dimensions[1] * scaleUniform).toFixed(2)}m H &times;{' '}
          {(selectedObject.dimensions[2] * scaleUniform).toFixed(2)}m D
        </div>
      </div>

      {/* Material Color Customization */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <span className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-indigo-400" />
            Material Color
          </span>
        </div>

        <div className="flex items-center gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c.name}
              onClick={() => updateColor(selectedObject.id, c.value)}
              className={`w-6 h-6 rounded-full border transition-all ${
                activeColor === c.value
                  ? 'border-white ring-2 ring-indigo-500 scale-110'
                  : 'border-slate-700 hover:scale-105'
              }`}
              style={{ backgroundColor: c.value }}
              title={c.name}
            />
          ))}
        </div>
      </div>

      {/* Actions: Duplicate & Delete */}
      <div className="pt-4 border-t border-slate-800 space-y-2">
        <button
          onClick={duplicateSelected}
          className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center justify-center gap-2 transition"
        >
          <Copy className="w-3.5 h-3.5 text-indigo-400" />
          Duplicate Furniture
        </button>

        <button
          onClick={deleteSelected}
          className="w-full py-2 rounded-xl bg-rose-950/30 hover:bg-rose-950/60 text-rose-400 text-xs font-medium border border-rose-800/40 flex items-center justify-center gap-2 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Object
        </button>
      </div>
    </aside>
  );
};
