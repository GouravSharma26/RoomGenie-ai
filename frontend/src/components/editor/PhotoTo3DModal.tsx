import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Upload, 
  Boxes, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  RotateCcw, 
  Sliders, 
  RefreshCw, 
  Maximize2, 
  PackageCheck 
} from 'lucide-react';
import { uploadRoomPhoto } from '../../services/visionApi';
import { 
  createReconstructionJob, 
  pollReconstructionJob, 
  fetchReconstructedModelBlobUrl,
  type ReconstructionJob 
} from '../../services/photoTo3dApi';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import { ModelPreviewCanvas } from './ModelPreviewCanvas';
import type { Vector3Tuple } from '../../types/scene';

export interface PhotoTo3DModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPhotoUploadId?: string | null;
  initialCategory?: 'seating' | 'tables' | 'storage' | 'beds' | 'decor';
  initialLabel?: string;
  initialDimensions?: Vector3Tuple;
}

const CATEGORY_DEFAULT_DIMS: Record<'seating' | 'tables' | 'storage' | 'beds' | 'decor', Vector3Tuple> = {
  seating: [0.9, 0.85, 0.85],
  tables: [1.2, 0.45, 0.6],
  storage: [1.0, 1.8, 0.4],
  beds: [1.8, 1.1, 2.1],
  decor: [0.4, 0.8, 0.4],
};

const PRESET_COLORS = [
  { name: 'Indigo Modern', hex: '#4f46e5' },
  { name: 'Scandinavian Emerald', hex: '#059669' },
  { name: 'Warm Amber Oak', hex: '#b45309' },
  { name: 'Minimalist Slate', hex: '#334155' },
  { name: 'Walnut Wood', hex: '#78350f' },
  { name: 'Velvet Ruby', hex: '#e11d48' },
];

/**
 * Inner dialog component that mounts fresh whenever opened.
 */
const PhotoTo3DDialog: React.FC<Omit<PhotoTo3DModalProps, 'isOpen'>> = ({
  onClose,
  initialPhotoUploadId = null,
  initialCategory = 'seating',
  initialLabel = '',
  initialDimensions,
}) => {
  const [step, setStep] = useState<'configure' | 'processing' | 'review'>('configure');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoUploadId, setPhotoUploadId] = useState<string | null>(initialPhotoUploadId);

  // Form options
  const [category, setCategory] = useState<'seating' | 'tables' | 'storage' | 'beds' | 'decor'>(initialCategory);
  const [promptLabel, setPromptLabel] = useState<string>(initialLabel);
  const [provider, setProvider] = useState<'mock' | 'tripo'>('mock');
  const [dimensions, setDimensions] = useState<Vector3Tuple>(
    initialDimensions || CATEGORY_DEFAULT_DIMS[initialCategory]
  );

  // Material tuning
  const [color, setColor] = useState<string>('#4f46e5');
  const [roughness, setRoughness] = useState<number>(0.6);
  const [metalness, setMetalness] = useState<number>(0.1);

  // Execution & Output state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [job, setJob] = useState<ReconstructionJob | null>(null);
  const [modelBlobUrl, setModelBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useFallbackAsset, setUseFallbackAsset] = useState<boolean>(false);
  const [placedSuccess, setPlacedSuccess] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addCustomPlacement = useEditorStore((state) => state.addCustomPlacement);
  const addFurniture = useEditorStore((state) => state.addFurniture);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (modelBlobUrl && modelBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(modelBlobUrl);
      }
    };
  }, [modelBlobUrl]);

  const handleCategoryChange = (newCat: 'seating' | 'tables' | 'storage' | 'beds' | 'decor') => {
    setCategory(newCat);
    setDimensions(CATEGORY_DEFAULT_DIMS[newCat]);
  };

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.type.startsWith('image/')) {
      setError('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Image file exceeds the 10 MB maximum size limit.');
      return;
    }

    setError(null);
    setFile(selectedFile);
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
  };

  const handleDimensionChange = (index: 0 | 1 | 2, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0.05 && num <= 10.0) {
      const nextDims: Vector3Tuple = [...dimensions];
      nextDims[index] = Math.round(num * 100) / 100;
      setDimensions(nextDims);
    }
  };

  const handleStartReconstruction = async () => {
    setError(null);
    setIsProcessing(true);
    setStep('processing');
    setStatusMessage('Initiating reconstruction pipeline...');

    try {
      let uploadIdToUse = photoUploadId;

      // 1. Upload photo if newly selected
      if (file && !uploadIdToUse) {
        setStatusMessage('Uploading reference furniture photo...');
        const uploadResult = await uploadRoomPhoto(file);
        uploadIdToUse = uploadResult.upload_id;
        setPhotoUploadId(uploadResult.upload_id);
      }

      // 2. Create reconstruction job
      setStatusMessage('Queuing 3D reconstruction job...');
      const createdJob = await createReconstructionJob({
        photo_upload_id: uploadIdToUse,
        target_category: category,
        prompt_label: promptLabel.trim() || `${category} Model`,
        reference_dimensions: {
          width_m: dimensions[0],
          height_m: dimensions[1],
          depth_m: dimensions[2],
        },
        provider,
        auto_process: true,
        sync: false, // Poll asynchronously for realistic feedback
      });

      setJob(createdJob);

      // 3. Poll for completion
      setStatusMessage('Synthesizing 3D mesh geometry & textures...');
      const finishedJob = await pollReconstructionJob(
        createdJob.id,
        (currentJob) => {
          if (currentJob.status === 'processing') {
            setStatusMessage('Reconstructing Khronos glTF 2.0 binary mesh...');
          }
        },
        30,
        1000
      );

      setJob(finishedJob);

      if (finishedJob.status === 'failed') {
        setError(
          finishedJob.error_message ||
            'Reconstruction engine failed to generate 3D model. You can switch to our verified catalogue fallback.'
        );
        setIsProcessing(false);
        return;
      }

      // 4. Download private validated model blob
      setStatusMessage('Validating and streaming GLB model...');
      const blobUrl = await fetchReconstructedModelBlobUrl(finishedJob.id);
      setModelBlobUrl(blobUrl);

      // Update dimensions if extracted by validator
      if (finishedJob.approximate_dimensions?.width_m) {
        setDimensions([
          finishedJob.approximate_dimensions.width_m,
          finishedJob.approximate_dimensions.height_m || dimensions[1],
          finishedJob.approximate_dimensions.depth_m || dimensions[2],
        ]);
      }

      setIsProcessing(false);
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during reconstruction.');
      setIsProcessing(false);
    }
  };

  const handlePlaceInRoom = () => {
    if (useFallbackAsset && job?.suggested_catalogue_fallback_id) {
      const fallbackItem = SAMPLE_CATALOG.find(
        (item) => item.id === job.suggested_catalogue_fallback_id
      );
      if (fallbackItem) {
        addFurniture(fallbackItem);
      }
    } else {
      // Place custom reconstructed model
      addCustomPlacement({
        assetId: job?.suggested_catalogue_fallback_id || `custom-${category}`,
        name: promptLabel.trim() || `Reconstructed ${category}`,
        dimensions,
        modelUrl: modelBlobUrl || undefined,
        materialOverrides: {
          color,
          roughness,
          metalness,
        },
        isCustomReconstruction: true,
      });
    }

    setPlacedSuccess(true);
    setTimeout(() => {
      onClose();
      // Reset state for next use
      setPlacedSuccess(false);
      setStep('configure');
    }, 800);
  };

  const suggestedFallback = job?.suggested_catalogue_fallback_id
    ? SAMPLE_CATALOG.find((item) => item.id === job.suggested_catalogue_fallback_id)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        id="photo-to-3d-modal"
        className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Photo-to-3D Furniture Reconstruction
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  Approximate 3D
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Transform furniture photos into architectural 3D GLB models with SI dimensions and catalogue fallback.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-start gap-3 text-xs leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Reconstruction Issue</span>
                <span>{error}</span>
                {suggestedFallback && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseFallbackAsset(true);
                      setStep('review');
                      setError(null);
                    }}
                    className="mt-2.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5 transition shadow"
                  >
                    <PackageCheck className="w-3.5 h-3.5" />
                    <span>Use Verified Catalogue Asset: {suggestedFallback.name}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 1: CONFIGURE */}
          {step === 'configure' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Photo Upload */}
              <div className="space-y-4">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  1. Source Photo
                </label>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
                  }}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center min-h-[220px] ${
                    previewUrl
                      ? 'border-indigo-500/50 bg-indigo-950/20'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-950/60'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
                    }}
                  />

                  {previewUrl ? (
                    <div className="space-y-3">
                      <img
                        src={previewUrl}
                        alt="Furniture Preview"
                        className="max-h-40 mx-auto rounded-xl object-contain shadow-md border border-slate-700/60"
                      />
                      <span className="text-[11px] text-indigo-400 font-medium block">
                        Click or drop another image to replace
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
                        <Upload className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-medium text-slate-200 block">
                        Drag &amp; drop furniture photo
                      </span>
                      <span className="text-xs text-slate-500 block">
                        JPEG, PNG, or WebP up to 10 MB
                      </span>
                    </div>
                  )}
                </div>

                {/* Prompt / Label Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Furniture Name / Label</label>
                  <input
                    type="text"
                    value={promptLabel}
                    onChange={(e) => setPromptLabel(e.target.value)}
                    placeholder="e.g. Vintage Leather Armchair"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-indigo-500 outline-none transition"
                  />
                </div>
              </div>

              {/* Right Column: Specifications & Parameters */}
              <div className="space-y-5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  2. Reconstruction Specifications
                </label>

                {/* Category Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Furniture Category</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['seating', 'tables', 'storage', 'beds', 'decor'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleCategoryChange(cat)}
                        className={`px-3 py-2 rounded-xl text-xs font-medium capitalize border transition ${
                          category === cat
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                            : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reference Dimensions Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-400">
                      Reference Dimensions (Metres)
                    </label>
                    <span className="text-[10px] text-slate-500 font-mono">0.05m &ndash; 10.0m</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <span className="text-[10px] text-slate-500 font-medium block mb-1">Width (m)</span>
                      <input
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.05"
                        value={dimensions[0]}
                        onChange={(e) => handleDimensionChange(0, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-medium block mb-1">Height (m)</span>
                      <input
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.05"
                        value={dimensions[1]}
                        onChange={(e) => handleDimensionChange(1, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 font-medium block mb-1">Depth (m)</span>
                      <input
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.05"
                        value={dimensions[2]}
                        onChange={(e) => handleDimensionChange(2, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Provider Engine Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Reconstruction Engine</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setProvider('mock')}
                      className={`p-3 rounded-xl border text-left transition ${
                        provider === 'mock'
                          ? 'bg-indigo-950/40 border-indigo-500 text-white'
                          : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      <span className="font-semibold text-xs block text-indigo-300">
                        Offline Engine (Mock)
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        Deterministic, immediate, procedural 3D box model.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider('tripo')}
                      className={`p-3 rounded-xl border text-left transition ${
                        provider === 'tripo'
                          ? 'bg-indigo-950/40 border-indigo-500 text-white'
                          : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      <span className="font-semibold text-xs block text-purple-300">
                        Tripo AI Cloud (v3.1)
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        External neural mesh (safeguarded; mock fallback).
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESSING */}
          {step === 'processing' && (
            <div className="py-12 px-4 text-center max-w-md mx-auto space-y-6">
              <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto shadow-xl shadow-indigo-500/10">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Reconstructing 3D Model
                </h3>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  {statusMessage || 'Processing neural geometry...'}
                </p>
              </div>

              {/* Progress Steps */}
              <div className="space-y-2 text-left bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 text-xs">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Photo Uploaded &amp; Validated</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Bounded Dimensions Set ({dimensions[0]} &times; {dimensions[1]} &times; {dimensions[2]}m)</span>
                </div>
                <div className="flex items-center gap-2 text-indigo-400 animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing GLB Mesh &amp; Materials</span>
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <div className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[9px]">4</div>
                  <span>glTF 2.0 Binary Validation &amp; Storage</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW & FINE-TUNING */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Approximate Output Notice Badge */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                  <div>
                    <span className="font-semibold">Approximate AI Reconstruction:</span>
                    <span className="ml-1 text-slate-300">
                      Geometry is an algorithmic estimate. Fine-tune dimensions below before placing into room.
                    </span>
                  </div>
                </div>
                {job && (
                  <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                    Latency: {job.latency_ms}ms &bull; {Math.round(job.file_size_bytes / 1024)} KB
                  </span>
                )}
              </div>

              {/* Viewport and Adjustments Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[380px]">
                {/* 3D Preview Viewport */}
                <div className="md:col-span-7 h-72 md:h-auto min-h-[320px] rounded-2xl overflow-hidden relative">
                  <ModelPreviewCanvas
                    modelUrl={useFallbackAsset ? (suggestedFallback?.modelUrl || null) : modelBlobUrl}
                    dimensions={dimensions}
                    color={color}
                    roughness={roughness}
                    metalness={metalness}
                  />
                </div>

                {/* Adjustments Panel */}
                <div className="md:col-span-5 space-y-4">
                  {/* Dimension Tuning */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                      Adjust Model Dimensions (m)
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block">Width</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="10"
                          value={dimensions[0]}
                          onChange={(e) => handleDimensionChange(0, e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block">Height</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="10"
                          value={dimensions[1]}
                          onChange={(e) => handleDimensionChange(1, e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block">Depth</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="10"
                          value={dimensions[2]}
                          onChange={(e) => handleDimensionChange(2, e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Material & Color Tuning */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <span className="text-xs font-semibold text-slate-300 block">
                      Material Finish &amp; Color
                    </span>
                    <div className="flex items-center gap-2">
                      {PRESET_COLORS.map((preset) => (
                        <button
                          key={preset.hex}
                          type="button"
                          onClick={() => setColor(preset.hex)}
                          title={preset.name}
                          className={`w-6 h-6 rounded-full border-2 transition ${
                            color.toLowerCase() === preset.hex.toLowerCase()
                              ? 'border-white scale-110 shadow-md'
                              : 'border-transparent hover:scale-105'
                          }`}
                          style={{ backgroundColor: preset.hex }}
                        />
                      ))}
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="w-6 h-6 rounded-full bg-transparent cursor-pointer border-0"
                        title="Custom Color Picker"
                      />
                    </div>

                    {/* Roughness and Metalness Sliders */}
                    <div className="grid grid-cols-2 gap-3 pt-1 text-[11px] text-slate-400">
                      <div>
                        <div className="flex justify-between mb-1">
                          <span>Roughness</span>
                          <span className="font-mono text-slate-300">{roughness}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={roughness}
                          onChange={(e) => setRoughness(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <span>Metalness</span>
                          <span className="font-mono text-slate-300">{metalness}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={metalness}
                          onChange={(e) => setMetalness(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Catalogue Fallback Toggle Card */}
                  {suggestedFallback && (
                    <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-300">Catalogue Match</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          Verified Model
                        </span>
                      </div>
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        Prefer a verified architectural asset over approximate reconstruction?
                      </p>
                      <button
                        type="button"
                        onClick={() => setUseFallbackAsset(!useFallbackAsset)}
                        className={`w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                          useFallbackAsset
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        <PackageCheck className="w-3.5 h-3.5" />
                        <span>
                          {useFallbackAsset ? `Using Catalogue: ${suggestedFallback.name}` : `Switch to: ${suggestedFallback.name}`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
          {step === 'configure' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartReconstruction}
                disabled={isProcessing}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition active:scale-95 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>Generate 3D Model</span>
              </button>
            </>
          )}

          {step === 'processing' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsProcessing(false);
                  setStep('configure');
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition"
              >
                Cancel Job
              </button>
            </div>
          )}

          {step === 'review' && (
            <>
              <button
                type="button"
                onClick={() => setStep('configure')}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Re-configure</span>
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handlePlaceInRoom}
                  disabled={placedSuccess}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/25 flex items-center gap-2 transition active:scale-95"
                >
                  {placedSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-white" />
                      <span>Placed in Room!</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-4 h-4" />
                      <span>Place in Room Canvas</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const PhotoTo3DModal: React.FC<PhotoTo3DModalProps> = ({ isOpen, ...rest }) => {
  if (!isOpen) return null;
  return <PhotoTo3DDialog key={`photo-3d-${rest.initialPhotoUploadId || 'new'}`} {...rest} />;
};
