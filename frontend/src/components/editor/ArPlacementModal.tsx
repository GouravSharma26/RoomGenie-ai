import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Smartphone,
  X,
  Scan,
  RotateCw,
  Maximize2,
  Move,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Copy,
  Info,
  Shield,
  Layers
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import {
  checkArCapability,
  generateSceneViewerIntentUrl,
  generateMobileHandoffUrl,
  clampArPlacement,
  type ArCapabilityResult,
  type ArPlacementTransform,
} from '../../services/arService';
import { startWebXrArSession, type WebXrSessionController } from '../../services/webXrArSession';
import { ModelPreviewCanvas } from './ModelPreviewCanvas';

interface ArPlacementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArPlacementModal: React.FC<ArPlacementModalProps> = ({ isOpen, onClose }) => {
  const scene = useEditorStore((state) => state.scene);
  const selectedId = useEditorStore((state) => state.selectedId);
  const currentDesignId = useEditorStore((state) => state.currentDesignId);

  // AR capability detection state
  const [capability, setCapability] = useState<ArCapabilityResult | null>(null);
  const [loadingCapability, setLoadingCapability] = useState<boolean>(true);

  // Selected item for AR placement
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);

  // Simulated / live placement transform (metres, radians, scale)
  const [transform, setTransform] = useState<ArPlacementTransform>({
    position: [0, 0, -1.5],
    rotationY: 0,
    scale: 1.0,
    surfaceDetected: false,
  });

  // Handoff link copying state
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [webXrError, setWebXrError] = useState<string | null>(null);
  const [isLaunchingWebXr, setIsLaunchingWebXr] = useState<boolean>(false);
  const [xrSessionController, setXrSessionController] = useState<WebXrSessionController | null>(null);
  const [isPlacedInXr, setIsPlacedInXr] = useState<boolean>(false);
  const arOverlayRef = useRef<HTMLDivElement>(null);

  // Determine active item to place
  const activePlacedItem = useMemo(() => {
    if (selectedPlacementId) {
      return scene.objects.find((o) => o.id === selectedPlacementId) || null;
    }
    if (selectedId) {
      return scene.objects.find((o) => o.id === selectedId) || null;
    }
    return scene.objects[0] || null;
  }, [scene.objects, selectedPlacementId, selectedId]);

  const activeCatalogItem = useMemo(() => {
    if (activePlacedItem) {
      return SAMPLE_CATALOG.find((c) => c.id === activePlacedItem.assetId) || null;
    }
    if (selectedCatalogId) {
      return SAMPLE_CATALOG.find((c) => c.id === selectedCatalogId) || null;
    }
    return SAMPLE_CATALOG[0] || null;
  }, [activePlacedItem, selectedCatalogId]);

  // Dimensions baseline
  const baseDimensions: [number, number, number] = useMemo(() => {
    if (activePlacedItem) return activePlacedItem.dimensions;
    if (activeCatalogItem) return activeCatalogItem.dimensions;
    return [0.8, 0.8, 0.8];
  }, [activePlacedItem, activeCatalogItem]);

  // Scaled dimensions
  const scaledDimensions: [number, number, number] = useMemo(() => {
    return [
      Number((baseDimensions[0] * transform.scale).toFixed(2)),
      Number((baseDimensions[1] * transform.scale).toFixed(2)),
      Number((baseDimensions[2] * transform.scale).toFixed(2)),
    ];
  }, [baseDimensions, transform.scale]);

  const activeModelUrl = useMemo(() => {
    if (activePlacedItem?.modelUrl) return activePlacedItem.modelUrl;
    if (activeCatalogItem?.modelUrl) return activeCatalogItem.modelUrl;
    return null;
  }, [activePlacedItem, activeCatalogItem]);

  const itemName = activePlacedItem?.name || activeCatalogItem?.name || 'Furniture Item';
  const isCustomReconstruction = activePlacedItem?.isCustomReconstruction || false;
  const reconstructionJobId = activePlacedItem?.reconstructionJobId;

  // Run hardware & browser capability detection on mount or open
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    checkArCapability()
      .then((res) => {
        if (active) {
          setCapability(res);
          setLoadingCapability(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoadingCapability(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyHandoffLink = () => {
    const handoffUrl = generateMobileHandoffUrl({
      designId: currentDesignId,
      selectedAssetId: activePlacedItem?.assetId || activeCatalogItem?.id,
    });
    navigator.clipboard.writeText(handoffUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleLaunchWebXr = async () => {
    try {
      setIsLaunchingWebXr(true);
      setWebXrError(null);
      setTransform((prev) => ({ ...prev, surfaceDetected: false }));
      setIsPlacedInXr(false);
      const controller = await startWebXrArSession({
        modelUrl: activeModelUrl,
        dimensions: baseDimensions,
        domOverlayContainer: arOverlayRef.current,
        onSurfaceDetectedChange: (detected) => {
          setTransform((prev) => ({ ...prev, surfaceDetected: detected }));
        },
        onPlaced: (pos, rotY, s) => {
          setIsPlacedInXr(true);
          setTransform((prev) => ({
            ...prev,
            position: pos,
            rotationY: rotY,
            scale: s,
            surfaceDetected: true,
          }));
        },
        onSessionEnd: () => {
          setIsLaunchingWebXr(false);
          setXrSessionController(null);
        },
        onError: (err) => {
          setWebXrError(err.message);
        },
      });
      setXrSessionController(controller);
    } catch (err: any) {
      setIsLaunchingWebXr(false);
      setWebXrError(
        err?.message ||
          'Failed to launch WebXR session. Please ensure camera permissions are granted and ARCore is installed.'
      );
    }
  };

  const handleEndWebXr = async () => {
    if (xrSessionController) {
      await xrSessionController.endSession();
    }
  };

  const handleCloseModal = () => {
    if (xrSessionController) {
      void xrSessionController.endSession();
    }
    onClose();
  };

  const handleUpdateTransform = (updates: Partial<ArPlacementTransform>) => {
    const updated = clampArPlacement(transform, updates);
    setTransform(updated);
    if (xrSessionController) {
      if (updates.rotationY !== undefined) {
        xrSessionController.setRotationY(updated.rotationY);
      }
      if (updates.scale !== undefined) {
        xrSessionController.setScale(updated.scale);
      }
    }
  };

  const handoffUrl = generateMobileHandoffUrl({
    designId: currentDesignId,
    selectedAssetId: activePlacedItem?.assetId || activeCatalogItem?.id,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
      data-testid="ar-placement-modal"
    >
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Augmented Reality (AR) Furniture Placement
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-medium">
                  Phase 7 WebXR
                </span>
              </div>
              <p className="text-xs text-slate-400">
                1:1 Metric floor-plane placement with ARCore / WebXR hit-testing and physical manual adjustments
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseModal}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            aria-label="Close AR Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content Grid */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Item Selection & Interactive AR Surface Simulator (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* Placed Furniture Item Selector */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
                Select Furniture Asset for AR Placement
              </label>
              {scene.objects.length > 0 ? (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {scene.objects.map((obj) => {
                    const isSelected = activePlacedItem?.id === obj.id;
                    return (
                      <button
                        key={obj.id}
                        onClick={() => {
                          setSelectedPlacementId(obj.id);
                          setSelectedCatalogId(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition ${
                          isSelected
                            ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{obj.name}</span>
                        {obj.isCustomReconstruction && (
                          <span className="text-[9px] px-1 rounded bg-purple-500/20 text-purple-300 font-mono">
                            AI 3D
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">
                    No items placed in current scene. Pick a catalogue model to test in AR:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SAMPLE_CATALOG.slice(0, 4).map((cat) => {
                      const isSelected = activeCatalogItem?.id === cat.id;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => {
                            setSelectedCatalogId(cat.id);
                            setSelectedPlacementId(null);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition ${
                            isSelected
                              ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span>{cat.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 3D AR Reticle & Placement Canvas */}
            <div className="relative bg-slate-950 border border-slate-800 rounded-xl overflow-hidden h-72 flex flex-col justify-end shadow-inner">
              {/* Active 3D Model Preview */}
              <div className="absolute inset-0">
                {!xrSessionController ? (
                  <ModelPreviewCanvas
                    modelUrl={activeModelUrl}
                    dimensions={scaledDimensions}
                    autoRotate={false}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-300 p-4 text-center">
                    <span className="w-4 h-4 rounded-full bg-cyan-400 animate-ping mb-3" />
                    <p className="text-xs font-semibold text-white">Live WebXR Camera View Active</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                      Background 3D preview is paused to maximize mobile GPU frame rates and hit-test responsiveness.
                    </p>
                  </div>
                )}
              </div>

              {/* Reticle / Floor Surface Alignment HUD */}
              <div className="relative z-10 p-3 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {transform.surfaceDetected ? (
                    <div className="flex items-center gap-1.5" data-testid="surface-detected-indicator">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="text-xs font-medium text-emerald-300 flex items-center gap-1">
                        <Scan className="w-3.5 h-3.5" />
                        Floor Plane Acquired (Y = 0.00 m)
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5" data-testid="surface-searching-indicator">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-xs font-medium text-amber-300 flex items-center gap-1">
                        <Scan className="w-3.5 h-3.5" />
                        Searching for floor surface...
                      </span>
                    </div>
                  )}

                  {/* Surface simulator toggle button */}
                  <button
                    type="button"
                    onClick={() =>
                      setTransform((prev) => ({ ...prev, surfaceDetected: !prev.surfaceDetected }))
                    }
                    className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80 transition"
                    title="Toggle floor surface detection state in simulator"
                  >
                    {transform.surfaceDetected ? 'Simulate Surface Lost' : 'Simulate Surface Found'}
                  </button>
                </div>

                <div className="text-[11px] font-mono text-slate-300 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                  Size: {scaledDimensions[0]}m &times; {scaledDimensions[1]}m &times; {scaledDimensions[2]}m
                </div>
              </div>
            </div>

            {/* Manual Adjustment Controls (Move, Rotate, Scale) */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Move className="w-3.5 h-3.5 text-cyan-400" />
                  Manual Physical Adjustments
                </span>
                <button
                  onClick={() =>
                    setTransform({
                      position: [0, 0, -1.5],
                      rotationY: 0,
                      scale: 1.0,
                      surfaceDetected: true,
                    })
                  }
                  className="text-[11px] text-slate-400 hover:text-white transition underline"
                >
                  Reset Adjustments
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                {/* Surface Position X */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>Floor Offset X</span>
                    <span className="text-white">{transform.position[0].toFixed(2)}m</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Floor Offset X"
                    min="-2.0"
                    max="2.0"
                    step="0.05"
                    value={transform.position[0]}
                    onChange={(e) =>
                      handleUpdateTransform({
                        position: [parseFloat(e.target.value), 0, transform.position[2]],
                      })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Yaw Rotation */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      <RotateCw className="w-3 h-3 text-cyan-400" />
                      Yaw Rotation
                    </span>
                    <span className="text-white">
                      {Math.round((transform.rotationY * 180) / Math.PI)}&deg;
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Yaw Rotation"
                    min="0"
                    max={2 * Math.PI}
                    step="0.05"
                    value={transform.rotationY}
                    onChange={(e) =>
                      handleUpdateTransform({ rotationY: parseFloat(e.target.value) })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Uniform Scale */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      <Maximize2 className="w-3 h-3 text-cyan-400" />
                      Scale
                    </span>
                    <span className="text-white">{transform.scale.toFixed(2)}&times;</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Scale Multiplier"
                    min="0.5"
                    max="2.0"
                    step="0.05"
                    value={transform.scale}
                    onChange={(e) =>
                      handleUpdateTransform({ scale: parseFloat(e.target.value) })
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Device Capabilities, Mobile Handoff, Fallback Messaging & Limitations (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Hardware & Browser Capability Status Card */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                Target Device Diagnostics
              </span>

              {loadingCapability ? (
                <div className="py-4 text-center text-xs text-slate-400 animate-pulse">
                  Probing WebXR hardware capabilities...
                </div>
              ) : capability?.isWebXrSupported ? (
                <div className="space-y-3">
                  {xrSessionController ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300">
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-400 animate-pulse" />
                        <div>
                          <h4 className="text-xs font-bold text-white">
                            WebXR AR Camera Live
                          </h4>
                          <p className="text-[11px] text-emerald-300/90 mt-0.5 leading-relaxed">
                            {isPlacedInXr
                              ? 'Furniture object placed on floor surface. Use manual adjustment controls below.'
                              : transform.surfaceDetected
                              ? 'Floor plane acquired! Tap camera viewport to place furniture.'
                              : 'Scanning room... Point camera at textured floor with good ambient lighting.'}
                          </p>
                        </div>
                      </div>

                      {isPlacedInXr && (
                        <button
                          type="button"
                          onClick={() => xrSessionController.repositionToReticle()}
                          className="w-full py-2.5 px-4 rounded-xl bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-700/80 text-cyan-200 text-xs font-semibold flex items-center justify-center gap-2 transition active:scale-98"
                        >
                          <Move className="w-4 h-4 text-cyan-400" />
                          <span>Reposition to Reticle</span>
                        </button>
                      )}

                      <button
                        onClick={handleEndWebXr}
                        className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-700 text-slate-200 hover:text-rose-300 font-semibold text-xs flex items-center justify-center gap-2 transition"
                      >
                        <span>End AR Camera Session</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300">
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-400" />
                        <div>
                          <h4 className="text-xs font-bold text-white">
                            WebXR Immersive-AR Compatible
                          </h4>
                          <p className="text-[11px] text-emerald-300/90 mt-0.5">
                            {capability.statusDescription}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleLaunchWebXr}
                        disabled={isLaunchingWebXr}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition active:scale-98"
                      >
                        <Smartphone className="w-4 h-4" />
                        <span>{isLaunchingWebXr ? 'Launching AR Camera...' : 'Launch WebXR AR Session'}</span>
                      </button>
                    </>
                  )}

                  {webXrError && (
                    <div className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-800/40 p-2.5 rounded-lg">
                      {webXrError}
                    </div>
                  )}
                </div>
              ) : (
                /* Desktop / Unsupported Device Fallback */
                <div className="space-y-3" data-testid="ar-unsupported-fallback">
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-300">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        {capability?.statusTitle || 'Desktop Environment Detected'}
                      </h4>
                      <p className="text-[11px] text-amber-300/90 mt-0.5 leading-relaxed">
                        {capability?.statusDescription ||
                          'This computer browser lacks camera-based optical SLAM hardware. Real-world AR placement requires an ARCore (Google Pixel, Samsung Galaxy) or ARKit (iPhone) mobile device.'}
                      </p>
                    </div>
                  </div>

                  {/* Mobile Device Handoff via QR & Direct Link */}
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300">
                        Scan or Open on Reference Device
                      </span>
                      <span className="text-[10px] text-slate-400">Android 10+ / iOS 15+</span>
                    </div>

                    {/* Clean SVG QR Illustration */}
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-16 bg-white p-1 rounded-lg shrink-0 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" className="w-14 h-14 text-slate-950">
                          <rect x="2" y="2" width="6" height="6" fill="currentColor" />
                          <rect x="16" y="2" width="6" height="6" fill="currentColor" />
                          <rect x="2" y="16" width="6" height="6" fill="currentColor" />
                          <rect x="10" y="4" width="4" height="2" fill="currentColor" />
                          <rect x="4" y="10" width="2" height="4" fill="currentColor" />
                          <rect x="10" y="10" width="4" height="4" fill="currentColor" />
                          <rect x="18" y="10" width="4" height="2" fill="currentColor" />
                          <rect x="10" y="18" width="4" height="4" fill="currentColor" />
                          <rect x="16" y="16" width="6" height="6" fill="currentColor" />
                        </svg>
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <p className="text-[10px] text-slate-400 leading-tight">
                          Point your mobile camera at this screen or copy the direct session link.
                        </p>
                        <button
                          onClick={handleCopyHandoffLink}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
                        >
                          <Copy className="w-3 h-3 text-cyan-400" />
                          <span>{copiedLink ? 'Link Copied!' : 'Copy Mobile AR Link'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Private Reconstructed Model vs External Scene Viewer Notice */}
                  {isCustomReconstruction ? (
                    <div className="p-3 bg-purple-950/40 border border-purple-800/40 rounded-lg text-[11px] text-purple-300 space-y-1">
                      <div className="font-semibold text-purple-200 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-purple-400" />
                        Private Authenticated Asset
                      </div>
                      <p className="text-purple-300/80 leading-relaxed">
                        This model was reconstructed via AI and streams securely in-memory. External apps (like Google Scene Viewer) cannot pass RoomGenie authentication headers. Use in-browser WebXR AR on your mobile device to view this model.
                      </p>
                    </div>
                  ) : activeModelUrl && !activeModelUrl.startsWith('blob:') ? (
                    <a
                      href={generateSceneViewerIntentUrl(activeModelUrl, itemName, handoffUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Launch Google Scene Viewer (Android)</span>
                    </a>
                  ) : null}
                </div>
              )}
            </div>

            {/* Tracking, Scale & Lighting Limitations (Plan Acceptance Criteria) */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                Physical &amp; Environmental Limitations
              </span>
              <ul className="text-[11px] text-slate-400 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-slate-200 shrink-0">1. Tracking:</span>
                  <span>
                    Optical SLAM requires textured surfaces. Solid white tiles, dark rooms, or reflective glass cause tracking loss.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-slate-200 shrink-0">2. Scale:</span>
                  <span>
                    Spatial estimation variance is expected within &plusmn;2% to 5%. Dimensions are visual aids, not surveyor certifications.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-slate-200 shrink-0">3. Lighting:</span>
                  <span>
                    Primary directional irradiance is simulated from camera frames; secondary bounces and ambient shadows are approximate.
                  </span>
                </li>
              </ul>
            </div>

            {/* Asset Security & Authenticated Boundary */}
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 flex items-start gap-2 text-[11px] text-slate-400">
              <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-300">Authenticated Streaming: </span>
                {isCustomReconstruction ? (
                  <span>
                    This AI reconstructed asset ({reconstructionJobId?.slice(0, 8)}...) is streamed privately in-session. It is never exposed via unauthenticated public URLs.
                  </span>
                ) : (
                  <span>
                    Standard architectural asset licensed under CC0 1.0 Universal with SI metric units.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Native WebXR DOM Overlay for Mobile Camera Viewport */}
      <div
        ref={arOverlayRef}
        id="webxr-ar-overlay"
        className={
          xrSessionController
            ? 'fixed inset-0 pointer-events-none z-[10000] flex flex-col justify-between p-4'
            : 'hidden'
        }
      >
        {/* Top Floating Status HUD */}
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-2xl backdrop-blur-md">
            {transform.surfaceDetected ? (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-semibold text-emerald-300">
                  {isPlacedInXr ? 'Furniture Placed' : 'Floor Acquired — Tap to Place'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-xs font-semibold text-amber-300">
                  Scanning floor... Point camera down
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleEndWebXr}
            className="px-3.5 py-2 rounded-full bg-rose-950/90 hover:bg-rose-900 border border-rose-700/90 text-rose-200 text-xs font-bold shadow-2xl backdrop-blur-md transition active:scale-95"
            aria-label="Exit AR Session"
          >
            End AR
          </button>
        </div>

        {/* Bottom Floating Action Bar */}
        {isPlacedInXr && (
          <div className="flex items-center justify-center pointer-events-auto pb-6">
            <button
              type="button"
              onClick={() => xrSessionController?.repositionToReticle()}
              className="px-5 py-2.5 rounded-2xl bg-cyan-600/95 hover:bg-cyan-500 text-white text-xs font-bold shadow-2xl border border-cyan-400/60 backdrop-blur-md flex items-center gap-2 transition active:scale-95"
            >
              <Move className="w-4 h-4" />
              <span>Reposition to Reticle</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
