import React, { useState, useRef } from 'react';
import { 
  Camera, 
  X, 
  UploadCloud, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  Trash2, 
  Maximize2, 
  Palette, 
  Home, 
  Layers, 
  Loader2, 
  ArrowRight,
  ShieldAlert,
  Info,
  Check,
  RefreshCw
} from 'lucide-react';
import { 
  uploadRoomPhoto, 
  analyzeRoomPhoto, 
  type RoomPhotoAnalysisResponse, 
  type DetectedFurniture,
  type ColorPaletteItem
} from '../../services/visionApi';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import { resolveCatalogueAssetId, isCatalogueAssetMapped } from '../../editor3d/data/catalogueMapping';
import { useEditorStore } from '../../editor3d/store/editorStore';

interface RoomPhotoVisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId?: string;
}

type ModalStep = 'upload' | 'analyzing' | 'review' | 'confirmed';

export const RoomPhotoVisionModal: React.FC<RoomPhotoVisionModalProps> = ({
  isOpen,
  onClose,
  roomId,
}) => {
  const setRoomDimensions = useEditorStore((state) => state.setRoomDimensions);
  const addFurniture = useEditorStore((state) => state.addFurniture);

  const [step, setStep] = useState<ModalStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [roomTypeHint, setRoomTypeHint] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<RoomPhotoAnalysisResponse | null>(null);

  // Review & Edit state
  const [itemsToApply, setItemsToApply] = useState<DetectedFurniture[]>([]);
  const [applyRoomDimensions, setApplyRoomDimensions] = useState<boolean>(true);
  const [showConfirmPrompt, setShowConfirmPrompt] = useState<boolean>(false);
  const [appliedCount, setAppliedCount] = useState<number>(0);
  const [unmappedCount, setUnmappedCount] = useState<number>(0);
  const [unmappedLabels, setUnmappedLabels] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (file: File) => {
    setErrorMsg(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('File size exceeds 10MB limit. Please upload a smaller image.');
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const resetUpload = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMsg(null);
    setAnalysisResult(null);
    setItemsToApply([]);
    setAppliedCount(0);
    setUnmappedCount(0);
    setUnmappedLabels([]);
    setStep('upload');
    setShowConfirmPrompt(false);
  };

  const handleStartAnalysis = async () => {
    if (!selectedFile) return;

    setErrorMsg(null);
    setStep('analyzing');

    try {
      // 1. Upload photo securely to Django backend
      const uploadRes = await uploadRoomPhoto(selectedFile, roomId);

      // 2. Trigger vision analysis adapter
      const analysisRes = await analyzeRoomPhoto(
        uploadRes.upload_id,
        roomId,
        roomTypeHint || undefined
      );

      setAnalysisResult(analysisRes);

      // 3. Populate editable items with resolved canonical catalogue IDs
      const detected = (analysisRes.observations?.detected_furniture || []).map((item) => ({
        ...item,
        selected: true,
        // Canonical mapping: resolve aliases and match to SAMPLE_CATALOG
        suggested_catalogue_asset_id: resolveCatalogueAssetId(item.suggested_catalogue_asset_id),
      }));
      setItemsToApply(detected);
      setStep('review');
    } catch (err: any) {
      setErrorMsg(err.message || 'Vision analysis failed. Please try again.');
      setStep('upload');
    }
  };

  const toggleItemSelection = (index: number) => {
    setItemsToApply((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, selected: !item.selected } : item))
    );
  };

  const removeItem = (index: number) => {
    setItemsToApply((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateItemCatalogueAsset = (index: number, assetId: string) => {
    setItemsToApply((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, suggested_catalogue_asset_id: assetId || null } : item
      )
    );
  };

  const handleApplyToScene = () => {
    if (!analysisResult?.observations) return;

    let placedCount = 0;
    const skippedLabels: string[] = [];

    // 1. Update room dimensions if user opted in and dimensions exist
    const approxDims = analysisResult.observations.estimated_dimensions_approx_m;
    if (applyRoomDimensions && approxDims) {
      setRoomDimensions({
        ...(approxDims.width_m ? { width: approxDims.width_m } : {}),
        ...(approxDims.length_m ? { length: approxDims.length_m } : {}),
        ...(approxDims.height_m ? { height: approxDims.height_m } : {}),
      });
    }

    // 2. Add approved furniture items to the 3D scene, tracking mapped vs unmapped
    const selectedItems = itemsToApply.filter((item) => item.selected);
    for (const item of selectedItems) {
      const assetId = item.suggested_catalogue_asset_id;
      const resolvedId = resolveCatalogueAssetId(assetId);

      if (!resolvedId) {
        skippedLabels.push(item.label);
        continue;
      }

      const catalogMatch = SAMPLE_CATALOG.find((cat) => cat.id === resolvedId);
      if (catalogMatch) {
        addFurniture(catalogMatch);
        placedCount++;
      } else {
        skippedLabels.push(item.label);
      }
    }

    setAppliedCount(placedCount);
    setUnmappedCount(skippedLabels.length);
    setUnmappedLabels(skippedLabels);
    setShowConfirmPrompt(false);
    setStep('confirmed');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl shadow-indigo-500/10 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vision-modal-title"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 id="vision-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                Room-Photo Vision Analysis
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Advisory AI
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Extract spatial features, detected furniture, and color palettes without silent 3D changes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1">
                <span className="font-semibold block">Analysis or Upload Error</span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          {/* STEP 1: UPLOAD PHOTO */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Dropzone */}
              {!previewUrl ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-indigo-500/60 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-950/40 hover:bg-slate-950/70 transition group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  />
                  <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-105 transition border border-indigo-500/20">
                    <UploadCloud className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-semibold text-slate-200">
                    Click to select or drag &amp; drop a room photo
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Supports JPEG, PNG, and WebP (up to 10MB)
                  </p>
                  <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
                    <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Ephemeral storage: Photos automatically expire after 1 hour</span>
                  </div>
                </div>
              ) : (
                /* Image Preview */
                <div className="space-y-4">
                  <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 max-h-72 flex items-center justify-center">
                    <img
                      src={previewUrl}
                      alt="Selected room preview"
                      className="object-contain max-h-72 w-full"
                    />
                    <button
                      onClick={resetUpload}
                      className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-rose-900/80 text-slate-300 hover:text-white text-xs border border-slate-700 backdrop-blur-md flex items-center gap-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Change Photo</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span>File: <strong className="text-slate-200">{selectedFile?.name}</strong></span>
                    <span>Size: <strong className="text-slate-200">{((selectedFile?.size || 0) / 1024 / 1024).toFixed(2)} MB</strong></span>
                  </div>
                </div>
              )}

              {/* Optional Room Hint */}
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <label htmlFor="room-hint-select" className="text-xs font-semibold text-slate-200 block">
                    Room Type Hint (Optional)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Guides the vision model when layout cues are ambiguous
                  </span>
                </div>
                <select
                  id="room-hint-select"
                  value={roomTypeHint}
                  onChange={(e) => setRoomTypeHint(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
                >
                  <option value="">Auto-Detect Room Type</option>
                  <option value="living_room">Living Room</option>
                  <option value="bedroom">Bedroom</option>
                  <option value="home_office">Home Office</option>
                  <option value="dining_room">Dining Room</option>
                </select>
              </div>

              {/* Privacy & Uncertainty Notice */}
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-800/40 text-indigo-300 text-xs flex items-start gap-2.5">
                <Info className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Non-destructive Advisory Vision:</strong> RoomGenie AI analyzes room photographs to generate structured observations. Inferred dimensions and furniture detections are purely suggestions. The 3D scene is <em>never</em> silently changed without your explicit review and confirmation.
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: ANALYZING STATE */}
          {step === 'analyzing' && (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-5">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-500/20">
                  <Sparkles className="w-8 h-8 animate-pulse text-indigo-300" />
                </div>
                <Loader2 className="w-20 h-20 text-indigo-500/30 animate-spin absolute -top-2 -left-2" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h3 className="text-base font-bold text-white">Analyzing Room Photograph</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Running vision model adapter, inferring spatial layout, detecting architectural features, and extracting color palettes...
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW OBSERVATIONS */}
          {step === 'review' && analysisResult?.observations && (
            <div className="space-y-6">
              {/* Fallback Notice */}
              {analysisResult.fallback_used && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <span className="font-semibold block">Fallback Vision Mode Active</span>
                    <span className="text-[11px] text-amber-200/80">
                      Vision analysis completed via offline mock adapter ({analysisResult.fallback_reason || 'live provider unconfigured'}).
                    </span>
                  </div>
                </div>
              )}

              {/* Spatial Uncertainty Disclaimer Banner */}
              <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-700/50 text-indigo-200 text-xs flex items-start gap-3">
                <ShieldAlert className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
                <div className="space-y-1 text-[11px] leading-relaxed">
                  <span className="font-bold text-indigo-300 block">
                    Spatial Uncertainty Disclaimer
                  </span>
                  <p>
                    {analysisResult.observations.uncertainty_notes ||
                      'Exact physical dimensions cannot be determined from a single uncalibrated 2D photograph. All bounding regions and dimension estimates are qualitative suggestions.'}
                  </p>
                </div>
              </div>

              {/* Room Overview & Inferred Dimensions */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Room Type & Confidence */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <Home className="w-4 h-4 text-indigo-400" />
                    <span className="font-medium">Detected Room Type</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-white capitalize">
                      {analysisResult.observations.room_type.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {Math.round(analysisResult.observations.overall_confidence * 100)}% Match
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 capitalize block">
                    Shape: {analysisResult.observations.estimated_room_shape || 'Rectangular'}
                  </span>
                </div>

                {/* Approximate Dimensions */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <Maximize2 className="w-4 h-4 text-purple-400" />
                    <span className="font-medium">Approximate Dimensions</span>
                  </div>
                  {analysisResult.observations.estimated_dimensions_approx_m ? (
                    <div>
                      <div className="text-base font-bold text-white font-mono">
                        {analysisResult.observations.estimated_dimensions_approx_m.width_m}m &times;{' '}
                        {analysisResult.observations.estimated_dimensions_approx_m.length_m}m &times;{' '}
                        {analysisResult.observations.estimated_dimensions_approx_m.height_m}m
                      </div>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer text-[11px] text-slate-300">
                        <input
                          type="checkbox"
                          checked={applyRoomDimensions}
                          onChange={(e) => setApplyRoomDimensions(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                        />
                        <span>Update 3D room size</span>
                      </label>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">No dimension estimates provided</span>
                  )}
                </div>

                {/* Architectural Features */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Layers className="w-4 h-4 text-blue-400" />
                    <span className="font-medium">Architecture</span>
                  </div>
                  <div className="text-[11px] text-slate-300 space-y-0.5">
                    <div>Flooring: <span className="text-white capitalize">{analysisResult.observations.architectural_features?.flooring || 'Standard'}</span></div>
                    <div>Walls: <span className="text-white capitalize">{analysisResult.observations.architectural_features?.wall_finish || 'Plastered'}</span></div>
                    <div>Openings: <span className="text-white">{analysisResult.observations.architectural_features?.windows_count ?? 1} win &bull; {analysisResult.observations.architectural_features?.doors_count ?? 1} door</span></div>
                  </div>
                </div>
              </div>

              {/* Color Palette Swatches */}
              {analysisResult.observations.color_palette?.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Palette className="w-4 h-4 text-pink-400" />
                    <span>Dominant Color Palette</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {analysisResult.observations.color_palette.map((color: ColorPaletteItem, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
                        <div
                          className="w-6 h-6 rounded-md border border-white/20 shrink-0 shadow-sm"
                          style={{ backgroundColor: color.hex }}
                        />
                        <div className="overflow-hidden">
                          <span className="text-[11px] font-medium text-white block truncate">
                            {color.name}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono block">
                            {color.hex}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detected Furniture Items Checklist */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Detected Furniture Suggestions ({itemsToApply.filter((i) => i.selected).length}/{itemsToApply.length} selected)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Select items to apply to your 3D layout, or map them to different 3D catalogue models
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {itemsToApply.map((item, index) => {
                    const approx = item.approximate_dimensions_m;
                    const isMapped = isCatalogueAssetMapped(item.suggested_catalogue_asset_id);
                    return (
                      <div
                        key={index}
                        className={`p-3.5 rounded-xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          item.selected
                            ? isMapped
                              ? 'bg-slate-950/80 border-indigo-500/40 shadow-sm'
                              : 'bg-amber-950/20 border-amber-500/40 shadow-sm'
                            : 'bg-slate-950/20 border-slate-800/80 opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3 flex-1">
                          <input
                            type="checkbox"
                            checked={Boolean(item.selected)}
                            onChange={() => toggleItemSelection(index)}
                            className="mt-1 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                          />
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-white">{item.label}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 font-medium capitalize">
                                {item.category}
                              </span>
                              <span className="text-[10px] text-emerald-400 font-medium">
                                {Math.round(item.confidence * 100)}%
                              </span>
                              {!isMapped && item.selected && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                  Unmapped 3D Model
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                              {item.estimated_spatial_zone && (
                                <span>Zone: <strong className="text-slate-300 capitalize">{item.estimated_spatial_zone.replace(/_/g, ' ')}</strong></span>
                              )}
                              {approx && (
                                <span>
                                  Est. Size: <strong className="text-slate-300 font-mono">{approx.width_m}m &times; {approx.length_m}m</strong>
                                </span>
                              )}
                            </div>
                            {!isMapped && item.selected && (
                              <p className="text-[11px] text-amber-300/90 flex items-center gap-1">
                                <span>No 3D catalogue model mapped. Select a replacement model below to add it to your 3D scene.</span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Catalogue Mapping Dropdown & Remove Button */}
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <select
                            value={item.suggested_catalogue_asset_id || ''}
                            onChange={(e) => updateItemCatalogueAsset(index, e.target.value)}
                            disabled={!item.selected}
                            aria-label={`Catalogue model for ${item.label}`}
                            className={`bg-slate-900 border text-xs text-white rounded-lg px-2.5 py-1 focus:border-indigo-500 outline-none max-w-[200px] ${
                              !isMapped && item.selected
                                ? 'border-amber-500/70 text-amber-200'
                                : 'border-slate-700'
                            }`}
                          >
                            <option value="">No 3D Model (Skip 3D Scene)</option>
                            {SAMPLE_CATALOG.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name} ({cat.category})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeItem(index)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                            title="Reject and remove suggestion"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recommendations */}
              {analysisResult.observations.recommendations?.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                  <span className="text-xs font-bold text-slate-200 block">
                    AI Interior Design Tips
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                    {analysisResult.observations.recommendations.map((rec: string, idx: number) => (
                      <li key={idx} className="leading-relaxed">{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: CONFIRMED STATE */}
          {step === 'confirmed' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${
                appliedCount > 0
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-emerald-500/10'
                  : 'bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-amber-500/10'
              }`}>
                {appliedCount > 0 ? <CheckCircle2 className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
              </div>
              <div className="space-y-1 max-w-md">
                <h3 className="text-base font-bold text-white">
                  {appliedCount > 0 ? 'Suggestions Applied to 3D Scene' : 'Scene Processing Complete'}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {appliedCount > 0
                    ? `Successfully added ${appliedCount} approved furniture model${appliedCount === 1 ? '' : 's'} to your interactive 3D room canvas.`
                    : 'No new 3D furniture models were added to your scene.'}
                </p>
                {unmappedCount > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left text-xs text-amber-300">
                    <span className="font-semibold block text-amber-200">
                      {unmappedCount} selected item{unmappedCount === 1 ? '' : 's'} skipped (no 3D model mapped):
                    </span>
                    <span className="text-[11px] text-amber-300/80">
                      {unmappedLabels.join(', ')}
                    </span>
                  </div>
                )}
                {applyRoomDimensions && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Room dimensions were updated based on approximate observations.
                  </p>
                )}
              </div>
              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition"
                >
                  Return to 3D Editor
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          {step === 'upload' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleStartAnalysis}
                disabled={!selectedFile}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition"
              >
                <Sparkles className="w-4 h-4" />
                <span>Upload &amp; Analyze</span>
              </button>
            </>
          )}

          {step === 'review' && (
            <>
              <button
                onClick={resetUpload}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Upload Another Photo</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowConfirmPrompt(true)}
                  disabled={itemsToApply.filter((i) => i.selected).length === 0 && !applyRoomDimensions}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    Apply Confirmed Items ({itemsToApply.filter((i) => i.selected).length})
                  </span>
                </button>
              </div>
            </>
          )}

          {step === 'confirmed' && (
            <div className="ml-auto">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Explicit Confirmation Dialog Overlay */}
        {showConfirmPrompt && (() => {
          const selectedItems = itemsToApply.filter((i) => i.selected);
          const mappedItems = selectedItems.filter((i) => isCatalogueAssetMapped(i.suggested_catalogue_asset_id));
          const unmappedItems = selectedItems.filter((i) => !isCatalogueAssetMapped(i.suggested_catalogue_asset_id));

          return (
            <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                  <ArrowRight className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">
                    Confirm 3D Room Updates
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    You are about to add{' '}
                    <strong className="text-white">
                      {selectedItems.length} furniture item{selectedItems.length === 1 ? '' : 's'}
                    </strong>{' '}
                    to your active 3D room canvas
                    {applyRoomDimensions ? ' and update the room dimensions' : ''}.
                    {mappedItems.length < selectedItems.length ? (
                      <span className="block mt-1 text-amber-300">
                        ({mappedItems.length} mapped 3D model{mappedItems.length === 1 ? '' : 's'} will be placed; {unmappedItems.length} unmapped item{unmappedItems.length === 1 ? '' : 's'} will be skipped)
                      </span>
                    ) : (
                      <span className="block mt-1 text-emerald-400">
                        (All {mappedItems.length} items map directly to active 3D catalogue models)
                      </span>
                    )}
                    {' '}Existing furniture items will not be overwritten.
                  </p>
                </div>

                {unmappedItems.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <span className="font-semibold block text-amber-200">
                        {unmappedItems.length} selected item{unmappedItems.length === 1 ? '' : 's'} unmapped ({unmappedItems.map(i => i.label).join(', ')}):
                      </span>
                      <span className="text-[11px] text-amber-300/80">
                        These items have no 3D catalogue model assigned and will be skipped unless you pick a model from the dropdown.
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowConfirmPrompt(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  >
                    Back to Review
                  </button>
                  <button
                    onClick={handleApplyToScene}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>Yes, Apply to Scene</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
