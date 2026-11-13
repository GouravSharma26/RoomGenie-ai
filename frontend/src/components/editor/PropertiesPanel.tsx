import React, { useState } from 'react';
import { 
  Sliders, 
  Copy, 
  Trash2, 
  X, 
  RotateCw, 
  Move, 
  Maximize, 
  Palette, 
  Info,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Magnet,
  Link2,
  Unlink,
  Plus
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import type { Vector3Tuple, DoorSwingType } from '../../types/scene';
import { 
  defaultSocketRegistry, 
  getParentRelationship, 
  getDirectChildren,
  getCanonicalRoomGeometry,
  deriveWallProperties,
} from '../../spatial';

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
  const selectedWallId = useEditorStore((state) => state.selectedWallId);
  const selectedOpeningId = useEditorStore((state) => state.selectedOpeningId);

  const selectWall = useEditorStore((state) => state.selectWall);
  const selectOpening = useEditorStore((state) => state.selectOpening);
  const addWallOpening = useEditorStore((state) => state.addWallOpening);
  const updateWallOpening = useEditorStore((state) => state.updateWallOpening);
  const deleteWallOpening = useEditorStore((state) => state.deleteWallOpening);

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
  const spatialValidations = useEditorStore((state) => state.spatialValidations);
  const resolveSelectedPlacement = useEditorStore((state) => state.resolveSelectedPlacement);
  const snapConfig = useEditorStore((state) => state.snapConfig);
  const scene = useEditorStore((state) => state.scene);
  const detachObjectFromSocket = useEditorStore((state) => state.detachObjectFromSocket);
  const setRelationshipGap = useEditorStore((state) => state.setRelationshipGap);

  // Local feedback state for architectural editing
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [wallError, setWallError] = useState<string | null>(null);

  const canonicalRoom = getCanonicalRoomGeometry(room);

  // ==========================================
  // 1. ARCHITECTURAL OPENING INSPECTOR
  // ==========================================
  if (selectedOpeningId) {
    const selectedOpening = (canonicalRoom.openings || []).find((o) => o.id === selectedOpeningId);
    const hostWall = canonicalRoom.walls.find((w) => w.id === selectedOpening?.wallId);
    const derivedWall = hostWall ? deriveWallProperties(hostWall, canonicalRoom.height) : null;

    if (!selectedOpening) {
      return (
        <aside className="w-80 bg-slate-900/95 border-l border-slate-800 p-6 flex flex-col justify-center items-center text-center shrink-0 z-10">
          <p className="text-xs text-slate-400">Opening no longer exists.</p>
          <button
            onClick={() => selectOpening(null)}
            className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200"
          >
            Clear Selection
          </button>
        </aside>
      );
    }

    const handleWidthChange = (val: number) => {
      setOpeningError(null);
      const res = updateWallOpening(selectedOpening.id, { width: val });
      if (!res.success && res.error) setOpeningError(res.error);
    };

    const handleHeightChange = (val: number) => {
      setOpeningError(null);
      const res = updateWallOpening(selectedOpening.id, { height: val });
      if (!res.success && res.error) setOpeningError(res.error);
    };

    const handleDistanceChange = (val: number) => {
      setOpeningError(null);
      const res = updateWallOpening(selectedOpening.id, { distanceAlongWall: val });
      if (!res.success && res.error) setOpeningError(res.error);
    };

    const handleSillChange = (val: number) => {
      setOpeningError(null);
      const res = updateWallOpening(selectedOpening.id, { sillHeight: val });
      if (!res.success && res.error) setOpeningError(res.error);
    };

    const handleSwingChange = (swingVal: DoorSwingType) => {
      setOpeningError(null);
      const res = updateWallOpening(selectedOpening.id, { swing: swingVal });
      if (!res.success && res.error) setOpeningError(res.error);
    };

    const handleDelete = () => {
      deleteWallOpening(selectedOpening.id);
    };

    return (
      <aside className="w-80 bg-slate-900/95 border-l border-slate-800 flex flex-col h-full overflow-y-auto shrink-0 z-10 p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div>
            <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider block">
              Architectural Opening
            </span>
            <h3 className="font-bold text-white text-base mt-0.5 capitalize">
              {selectedOpening.type === 'door' ? 'Door' : 'Window'}
            </h3>
            <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
              ID: {selectedOpening.id}
            </span>
          </div>
          <button
            onClick={() => selectOpening(null)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Deselect"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Host Wall Info Badge */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 space-y-1">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-400">Host Wall:</span>
            <button
              onClick={() => selectWall(selectedOpening.wallId)}
              className="font-mono text-indigo-400 hover:underline"
            >
              {selectedOpening.wallId}
            </button>
          </div>
          {derivedWall && (
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Wall Length:</span>
              <span className="text-slate-200">{derivedWall.length.toFixed(2)}m</span>
            </div>
          )}
        </div>

        {/* Validation Error Banner */}
        {openingError && (
          <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{openingError}</span>
          </div>
        )}

        {/* Position Along Wall */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-medium">Position Along Wall</span>
            <span className="font-mono text-cyan-400 text-[11px]">
              {selectedOpening.distanceAlongWall.toFixed(2)}m
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={derivedWall ? Math.max(0.1, derivedWall.length - selectedOpening.width) : 6}
            step={0.05}
            value={selectedOpening.distanceAlongWall}
            onChange={(e) => handleDistanceChange(parseFloat(e.target.value))}
            className="w-full accent-cyan-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>0.00m (Start)</span>
            <span>{derivedWall ? (derivedWall.length - selectedOpening.width).toFixed(2) : ''}m</span>
          </div>
        </div>

        {/* Dimensions (Width & Height) */}
        <div className="space-y-3">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            Opening Dimensions
          </span>

          {/* Width */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Width</span>
              <span className="font-mono text-slate-200">{selectedOpening.width.toFixed(2)}m</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={derivedWall ? Math.max(0.7, derivedWall.length - 0.2) : 3.0}
              step={0.05}
              value={selectedOpening.width}
              onChange={(e) => handleWidthChange(parseFloat(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* Height */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Height</span>
              <span className="font-mono text-slate-200">{selectedOpening.height.toFixed(2)}m</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={canonicalRoom.height - (selectedOpening.sillHeight ?? 0)}
              step={0.05}
              value={selectedOpening.height}
              onChange={(e) => handleHeightChange(parseFloat(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* Window Sill Height */}
          {selectedOpening.type === 'window' && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Sill Height (Elevation)</span>
                <span className="font-mono text-slate-200">
                  {(selectedOpening.sillHeight ?? 0.9).toFixed(2)}m
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={Math.max(0.2, canonicalRoom.height - selectedOpening.height - 0.1)}
                step={0.05}
                value={selectedOpening.sillHeight ?? 0.9}
                onChange={(e) => handleSillChange(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          )}
        </div>

        {/* Door Swing Metadata */}
        {selectedOpening.type === 'door' && (
          <div className="space-y-2 pt-1 border-t border-slate-800">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Door Swing Direction
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(['inward-left', 'inward-right', 'outward-left', 'outward-right'] as DoorSwingType[]).map(
                (dir) => (
                  <button
                    key={dir}
                    onClick={() => handleSwingChange(dir)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition ${
                      selectedOpening.swing === dir
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {dir.replace('-', ' ')}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Delete Opening Action */}
        <div className="pt-3 border-t border-slate-800">
          <button
            onClick={handleDelete}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 text-rose-300 hover:text-white text-xs font-medium transition"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Delete Opening</span>
          </button>
        </div>
      </aside>
    );
  }

  // ==========================================
  // 2. ARCHITECTURAL WALL INSPECTOR
  // ==========================================
  if (selectedWallId) {
    const selectedWall = canonicalRoom.walls.find((w) => w.id === selectedWallId);
    const derivedWall = selectedWall ? deriveWallProperties(selectedWall, canonicalRoom.height) : null;
    const hostedOpenings = (canonicalRoom.openings || []).filter((o) => o.wallId === selectedWallId);

    if (!selectedWall || !derivedWall) {
      return (
        <aside className="w-80 bg-slate-900/95 border-l border-slate-800 p-6 flex flex-col justify-center items-center text-center shrink-0 z-10">
          <p className="text-xs text-slate-400">Selected wall not found.</p>
          <button
            onClick={() => selectWall(null)}
            className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200"
          >
            Clear Selection
          </button>
        </aside>
      );
    }

    const handleAddDoor = () => {
      setWallError(null);
      const res = addWallOpening(selectedWallId, 'door');
      if (!res.success && res.error) setWallError(res.error);
    };

    const handleAddWindow = () => {
      setWallError(null);
      const res = addWallOpening(selectedWallId, 'window');
      if (!res.success && res.error) setWallError(res.error);
    };

    return (
      <aside className="w-80 bg-slate-900/95 border-l border-slate-800 flex flex-col h-full overflow-y-auto shrink-0 z-10 p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div>
            <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider block">
              Architectural Wall
            </span>
            <h3 className="font-bold text-white text-base mt-0.5">
              {derivedWall.id}
            </h3>
            <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
              {derivedWall.length.toFixed(2)}m long &middot; {derivedWall.height.toFixed(2)}m tall
            </span>
          </div>
          <button
            onClick={() => selectWall(null)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Deselect"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wall Geometric Parameters Card */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs">
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Length:</span>
            <span className="font-mono text-slate-100">{derivedWall.length.toFixed(2)}m</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Height:</span>
            <span className="font-mono text-slate-100">{derivedWall.height.toFixed(2)}m</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Thickness:</span>
            <span className="font-mono text-slate-100">{(derivedWall.thickness * 100).toFixed(0)}cm</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Start Point:</span>
            <span className="font-mono text-slate-400">[{derivedWall.startPoint.join(', ')}]</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">End Point:</span>
            <span className="font-mono text-slate-400">[{derivedWall.endPoint.join(', ')}]</span>
          </div>
        </div>

        {/* Error Notice */}
        {wallError && (
          <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{wallError}</span>
          </div>
        )}

        {/* Add Openings Action Bar */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            Add Openings
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleAddDoor}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Door</span>
            </button>
            <button
              onClick={handleAddWindow}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Window</span>
            </button>
          </div>
        </div>

        {/* Hosted Openings List */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
              Openings on Wall ({hostedOpenings.length})
            </span>
          </div>

          {hostedOpenings.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">
              No doors or windows on this wall segment.
            </p>
          ) : (
            <div className="space-y-1.5">
              {hostedOpenings.map((op) => (
                <div
                  key={op.id}
                  onClick={() => selectOpening(op.id)}
                  className="p-2.5 rounded-xl bg-slate-950/50 hover:bg-slate-800/60 border border-slate-800 flex items-center justify-between cursor-pointer transition text-xs"
                >
                  <div>
                    <span className="font-semibold text-white capitalize block text-[11px]">
                      {op.type} ({op.width}m &times; {op.height}m)
                    </span>
                    <span className="text-[10px] text-slate-400">
                      at {op.distanceAlongWall}m from start
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteWallOpening(op.id);
                    }}
                    className="p-1 text-slate-500 hover:text-rose-400 transition"
                    title="Delete Opening"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    );
  }

  // ==========================================
  // 3. FURNITURE ITEM INSPECTOR
  // ==========================================
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

      {/* Spatial Constraint Status Card */}
      {(() => {
        const currentValidation = spatialValidations[selectedObject.id];
        if (!currentValidation) return null;

        if (!currentValidation.valid) {
          const groundingWarn = currentValidation.warnings?.find((w) => /floating|sunken/i.test(w));
          return (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs space-y-2">
              <div className="flex items-center gap-2 text-rose-400 font-semibold text-[11px]">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>Spatial Conflict Detected</span>
              </div>
              {currentValidation.collisions.length > 0 && (
                <div className="text-[11px] text-rose-200/90 pl-6">
                  Intersecting with {currentValidation.collisions.length} other item{currentValidation.collisions.length > 1 ? 's' : ''}
                </div>
              )}
              {currentValidation.boundaryViolations.length > 0 && (
                <div className="text-[11px] text-rose-200/90 pl-6">
                  {currentValidation.boundaryViolations[0]}
                </div>
              )}
              {groundingWarn && (
                <div className="text-[11px] text-amber-300/90 pl-6">
                  {groundingWarn}
                </div>
              )}
              {currentValidation.suggestedPosition && (
                <button
                  onClick={() => resolveSelectedPlacement()}
                  className="mt-1 w-full py-1.5 px-3 rounded-lg bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 text-xs font-medium flex items-center justify-center gap-1.5 transition"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Auto-Resolve Placement</span>
                </button>
              )}
            </div>
          );
        }

        return (
          <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span className="text-[11px] font-medium">Placement Valid (Collision & Bounds Cleared)</span>
          </div>
        );
      })()}

      {/* Semantic Relationships & Sockets Section */}
      {(() => {
        const parentRel = getParentRelationship(scene, selectedObject.id);
        const directChildren = getDirectChildren(scene, selectedObject.id);
        const allAnchorSockets = defaultSocketRegistry.getSocketsForAsset(selectedObject.assetId);
        const occupiedSocketIds = new Set(directChildren.map((r) => r.socketId));
        const availableSockets = allAnchorSockets.filter((s) => !occupiedSocketIds.has(s.id));

        const hasRelationships = Boolean(parentRel || directChildren.length > 0 || availableSockets.length > 0);
        if (!hasRelationships) return null;

        return (
          <div className="space-y-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            {/* 1. If Child Item Attached to an Anchor */}
            {parentRel && (() => {
              const anchor = objects.find((o) => o.id === parentRel.anchorObjectId);
              const socket = anchor ? defaultSocketRegistry.getSocketDefinition(anchor.assetId, parentRel.socketId) : undefined;
              const socketName = socket?.name || parentRel.socketId;
              const minGap = socket?.minGap ?? 0.1;
              const maxGap = socket?.maxGap ?? 1.5;

              return (
                <div className="space-y-3" data-testid="attached-relationship-card">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                      <Link2 className="w-3.5 h-3.5 text-indigo-400" />
                      Attached to Anchor
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 font-mono">
                      Child
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Anchor:</span>
                      <span className="font-medium text-white">{anchor?.name || 'Unknown Item'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Socket:</span>
                      <span className="font-mono text-indigo-300">{socketName}</span>
                    </div>
                  </div>

                  {/* Spacing Gap Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Spacing Gap</span>
                      <span className="font-mono text-white">{(parentRel.gap ?? 0.05).toFixed(2)}m</span>
                    </div>
                    <input
                      type="range"
                      aria-label="Spacing Gap"
                      min={minGap}
                      max={maxGap}
                      step="0.05"
                      value={parentRel.gap ?? 0.05}
                      onChange={(e) => setRelationshipGap(selectedObject.id, parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  {/* Detach Action */}
                  <button
                    onClick={() => detachObjectFromSocket(selectedObject.id)}
                    className="w-full py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/60 text-xs text-slate-300 hover:text-rose-300 flex items-center justify-center gap-1.5 transition"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Detach from Socket</span>
                  </button>
                </div>
              );
            })()}

            {/* 2. If Anchor Item with Attached Children */}
            {directChildren.length > 0 && (
              <div className="space-y-2.5" data-testid="connected-group-card">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <Magnet className="w-3.5 h-3.5 text-indigo-400" />
                    Connected Furniture Group ({directChildren.length})
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 text-slate-400 border border-slate-800 font-mono">
                    {directChildren.length} Attached
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-900/50 p-2 rounded-lg">
                  Group Movement Active: Repositioning or rotating this {selectedObject.name} moves all attached items together.
                </p>

                <div className="space-y-1.5">
                  {directChildren.map((rel) => {
                    const child = objects.find((o) => o.id === rel.childObjectId);
                    const socket = defaultSocketRegistry.getSocketDefinition(selectedObject.assetId, rel.socketId);
                    return (
                      <div
                        key={rel.id}
                        className="flex items-center justify-between bg-slate-900/90 p-2 rounded-lg border border-slate-800 text-xs"
                      >
                        <div>
                          <div className="font-medium text-white text-[11px]">{child?.name || 'Child Item'}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {socket?.name || rel.socketId} &bull; {(rel.gap ?? 0.05).toFixed(2)}m
                          </div>
                        </div>
                        <button
                          onClick={() => detachObjectFromSocket(rel.childObjectId)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
                          title={`Detach ${child?.name || 'Item'}`}
                          aria-label={`Detach ${child?.name || 'Item'}`}
                        >
                          <Unlink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Available Sockets Display */}
            {availableSockets.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-slate-800/60" data-testid="available-sockets-card">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Available Sockets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {availableSockets.map((s) => (
                    <span
                      key={s.id}
                      className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700/60 text-[10px] text-slate-300 font-mono flex items-center gap-1"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Position Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <Move className="w-3.5 h-3.5" />
          <span>Position (Metres)</span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">X (Width)</span>
            <span className="font-mono text-slate-200">{posX.toFixed(2)}m</span>
          </div>
          <input
            type="range"
            min={-halfW + 0.2}
            max={halfW - 0.2}
            step={snapConfig.enabled ? snapConfig.gridSize : 0.05}
            value={posX}
            onPointerDown={() => startInteraction(selectedObject.id)}
            onPointerUp={() => endInteraction()}
            onChange={(e) => handlePositionXChange(parseFloat(e.target.value))}
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Z (Depth)</span>
            <span className="font-mono text-slate-200">{posZ.toFixed(2)}m</span>
          </div>
          <input
            type="range"
            min={-halfL + 0.2}
            max={halfL - 0.2}
            step={snapConfig.enabled ? snapConfig.gridSize : 0.05}
            value={posZ}
            onPointerDown={() => startInteraction(selectedObject.id)}
            onPointerUp={() => endInteraction()}
            onChange={(e) => handlePositionZChange(parseFloat(e.target.value))}
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>
      </div>

      {/* Rotation Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <RotateCw className="w-3.5 h-3.5" />
          <span>Rotation</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Heading (Y)</span>
          <span className="font-mono text-xs text-slate-200">{normalizedRotY}&deg;</span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {[0, 90, 180, 270].map((deg) => (
            <button
              key={deg}
              onClick={() => handleRotationYChange(deg)}
              className={`py-1.5 rounded-lg text-xs font-medium border transition ${
                normalizedRotY === deg
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                  : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {deg}&deg;
            </button>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => handleRotateStep(-45)}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:text-white transition"
          >
            -45&deg;
          </button>
          <button
            onClick={() => handleRotateStep(45)}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:text-white transition"
          >
            +45&deg;
          </button>
        </div>
      </div>

      {/* Uniform Scale */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
            <Maximize className="w-3.5 h-3.5" />
            <span>Scale</span>
          </div>
          <span className="font-mono text-slate-200">{scaleUniform.toFixed(2)}x</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2.0}
          step={0.05}
          value={scaleUniform}
          onPointerDown={() => startInteraction(selectedObject.id)}
          onPointerUp={() => endInteraction()}
          onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
          className="w-full accent-indigo-500 cursor-pointer"
        />
      </div>

      {/* Color Overrides */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <Palette className="w-3.5 h-3.5" />
          <span>Color Tint</span>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => updateColor(selectedObject.id, c.value)}
              className={`w-7 h-7 rounded-full border-2 transition transform hover:scale-110 ${
                activeColor.toLowerCase() === c.value.toLowerCase()
                  ? 'border-white scale-105 shadow-md'
                  : 'border-transparent opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: c.value }}
              title={c.name}
            />
          ))}
        </div>
      </div>

      {/* Duplicate / Delete Actions */}
      <div className="pt-2 border-t border-slate-800 flex gap-2">
        <button
          onClick={() => duplicateSelected()}
          className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>Duplicate</span>
        </button>
        <button
          onClick={() => deleteSelected()}
          className="flex-1 py-2 px-3 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 border border-rose-800/80 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
      </div>
    </aside>
  );
};
