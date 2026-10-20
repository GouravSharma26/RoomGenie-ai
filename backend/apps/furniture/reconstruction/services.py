import logging
import math
import os
import re
import time
from pathlib import Path
from typing import Any
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.furniture.models import FurnitureAsset, FurnitureReconstructionJob
from apps.furniture.reconstruction.base import BaseImageTo3DAdapter, ReconstructionResult
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter
from apps.furniture.reconstruction.tripo import TripoImageTo3DAdapter, sanitize_sensitive_text
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDER_MODES = {'mock', 'tripo'}

# Canonical fallback catalog mapping
CANONICAL_FALLBACKS: dict[str, str] = {
    'seating': 'sofa-modern-3seater',
    'tables': 'table-oak-coffee',
    'storage': 'storage-bookshelf-tall',
    'beds': 'bed-queen-platform',
    'decor': 'decor-plant-floor-vase',
}

KEYWORD_FALLBACKS: list[tuple[tuple[str, ...], str]] = [
    (('chair', 'armchair', 'recliner', 'stool'), 'chair-accent-armchair'),
    (('desk', 'workstation', 'office table'), 'desk-workspace-study'),
    (('wardrobe', 'closet', 'armoire'), 'storage-wardrobe-2door'),
    (('shelf', 'bookshelf', 'bookcase', 'rack'), 'storage-bookshelf-tall'),
    (('bed', 'mattress', 'cot'), 'bed-queen-platform'),
    (('coffee table', 'side table', 'tea table'), 'table-oak-coffee'),
    (('plant', 'vase', 'lamp', 'decor', 'art'), 'decor-plant-floor-vase'),
    (('sofa', 'couch', 'loveseat', 'settee'), 'sofa-modern-3seater'),
]


def validate_reference_dimensions(dimensions: dict[str, Any] | None) -> dict[str, float]:
    """
    Validates that reference dimensions, if provided, contain finite, strictly positive,
    and reasonable bounded values (0.05m to 10.0m).
    Rejects booleans, NaN, infinity, non-numeric types, negative values, and zero.
    """
    if not dimensions:
        return {}
    if not isinstance(dimensions, dict):
        raise ValueError("Reference dimensions must be a dictionary.")

    valid_dims: dict[str, float] = {}
    for axis in ('width_m', 'height_m', 'depth_m'):
        if axis in dimensions:
            val = dimensions[axis]
            if isinstance(val, bool) or not isinstance(val, (int, float)):
                raise ValueError(
                    f"Dimension '{axis}' must be a finite positive number, received {type(val).__name__}."
                )
            val_float = float(val)
            if not math.isfinite(val_float) or math.isnan(val_float):
                raise ValueError(f"Dimension '{axis}' must be a finite number.")
            if val_float <= 0.0:
                raise ValueError(f"Dimension '{axis}' must be strictly positive (greater than 0).")
            if val_float < 0.05 or val_float > 10.0:
                raise ValueError(
                    f"Dimension '{axis}' ({val_float}m) is out of bounds (allowed range: 0.05m to 10.0m)."
                )
            valid_dims[axis] = round(val_float, 2)

    return valid_dims


def resolve_catalogue_fallback(category: str, prompt_label: str = '') -> str:
    """
    Deterministic resolution of an appropriate canonical FurnitureAsset fallback ID
    based on requested category and prompt label keywords.
    Verifies that the resolved ID corresponds to an active FurnitureAsset in the catalog.
    """
    candidate_id = None
    normalized_label = (prompt_label or '').lower().strip()
    if normalized_label:
        for keywords, asset_id in KEYWORD_FALLBACKS:
            if any(kw in normalized_label for kw in keywords):
                candidate_id = asset_id
                break

    if not candidate_id:
        normalized_cat = (category or '').lower().strip()
        candidate_id = CANONICAL_FALLBACKS.get(normalized_cat, 'sofa-modern-3seater')

    # Verify candidate against active canonical assets in database if available
    try:
        if FurnitureAsset.objects.filter(id=candidate_id, is_active=True).exists():
            return candidate_id
        # Fallback to standard canonical sofa if active
        if FurnitureAsset.objects.filter(id='sofa-modern-3seater', is_active=True).exists():
            return 'sofa-modern-3seater'
        # Otherwise pick any active asset
        active_asset = FurnitureAsset.objects.filter(is_active=True).first()
        if active_asset:
            return active_asset.id
    except Exception:
        pass

    return candidate_id


def get_image_to_3d_adapter(mode: str | None = None) -> BaseImageTo3DAdapter:
    """
    Factory function returning the configured image-to-3D provider adapter.
    Strictly validates provider mode and rejects unknown modes with ValueError.
    """
    raw_mode = mode if mode is not None else getattr(settings, 'IMAGE_TO_3D_PROVIDER_MODE', 'mock')
    effective_mode = str(raw_mode).lower().strip()
    if effective_mode not in SUPPORTED_PROVIDER_MODES:
        raise ValueError(
            f"Unsupported image-to-3D provider mode: '{effective_mode}'. Supported modes: {sorted(SUPPORTED_PROVIDER_MODES)}."
        )

    if effective_mode == 'tripo':
        return TripoImageTo3DAdapter()
    return MockImageTo3DAdapter()


def create_reconstruction_job(
    user: Any,
    photo_upload: Any = None,
    target_category: str = 'seating',
    prompt_label: str = '',
    provider: str | None = None,
    reference_dimensions: dict[str, float] | None = None
) -> FurnitureReconstructionJob:
    """
    Creates a new FurnitureReconstructionJob in 'queued' state.
    Strictly validates provider mode and reference dimensions before persisting.
    """
    raw_provider = provider if provider is not None else getattr(settings, 'IMAGE_TO_3D_PROVIDER_MODE', 'mock')
    effective_provider = str(raw_provider).lower().strip()
    if effective_provider not in SUPPORTED_PROVIDER_MODES:
        raise ValueError(
            f"Unsupported image-to-3D provider: '{effective_provider}'. Supported modes: {sorted(SUPPORTED_PROVIDER_MODES)}."
        )

    # Validate finite, positive, bounded reference dimensions
    validated_dims = validate_reference_dimensions(reference_dimensions)

    valid_categories = {c[0] for c in FurnitureAsset.CATEGORY_CHOICES}
    category = target_category if target_category in valid_categories else 'seating'
    clean_label = (prompt_label or '').strip()[:120]
    fallback_id = resolve_catalogue_fallback(category, clean_label)

    model_name = getattr(settings, 'TRIPO_MODEL', 'v3.1-20260211') if effective_provider == 'tripo' else 'mock-image-to-3d-v1'

    job = FurnitureReconstructionJob.objects.create(
        owner=user,
        photo_upload=photo_upload,
        target_category=category,
        prompt_label=clean_label,
        status=FurnitureReconstructionJob.STATUS_QUEUED,
        provider=effective_provider,
        model_name=model_name,
        approximate_dimensions=validated_dims,
        suggested_catalogue_fallback_id=fallback_id,
        raw_metadata={'initial_dimensions': validated_dims} if validated_dims else {}
    )
    return job


def run_reconstruction_job(
    job: FurnitureReconstructionJob,
    adapter: BaseImageTo3DAdapter | None = None,
    input_image_path: str | None = None,
    context: dict[str, Any] | None = None
) -> FurnitureReconstructionJob:
    """
    Executes a 3D furniture reconstruction job lifecycle:
    1. Validates and marks job 'processing'.
    2. Invokes the image-to-3D provider adapter.
    3. Validates the generated GLB binary data (Khronos glTF 2.0 Binary spec).
    4. Writes model bytes atomically to a private user-scoped storage path under MEDIA_ROOT.
    5. Updates model metadata, dimensions, and latency.
    6. Marks job 'completed'.

    Guarantees that errors, provider timeouts, or validation rejections cleanly transition
    the job to 'failed' with safe diagnostics, cleaning up partial disk artifacts.
    Jobs are never left stuck in 'processing'.
    """
    start_time = time.time()
    context = context or {}

    # 1. State transition to processing
    try:
        job.transition_to(FurnitureReconstructionJob.STATUS_PROCESSING)
    except Exception as exc:
        logger.error("Failed to transition job %s to processing: %s", job.id, exc)
        return job

    # 2. Determine source image path
    image_path = input_image_path
    if not image_path and job.photo_upload:
        image_path = job.photo_upload.file_path
    if not image_path:
        image_path = "placeholder_source.jpg"

    adapter_instance = adapter or get_image_to_3d_adapter(mode=job.provider)
    tmp_dest_path: Path | None = None
    final_dest_path: Path | None = None

    try:
        # 3. Invoke provider adapter
        result: ReconstructionResult = adapter_instance.generate_furniture_model(
            image_path=image_path,
            category=job.target_category,
            prompt_label=job.prompt_label,
            reference_dimensions=job.approximate_dimensions or None,
            context=context
        )

        model_bytes = result.model_bytes
        if not model_bytes:
            raise GLBValidationError("Provider returned empty 3D model payload.")

        # 4. Strictly validate binary GLB structure and maximum size limit
        max_size = getattr(settings, 'IMAGE_TO_3D_MAX_OUTPUT_SIZE', 15 * 1024 * 1024)
        validation_info = GLBValidator.validate(model_bytes, max_size_bytes=max_size)

        # 5. Atomic file write to private user-isolated directory
        media_root = Path(getattr(settings, 'MEDIA_ROOT', settings.BASE_DIR / 'media')).resolve()
        user_model_dir = media_root / 'reconstructed_models' / str(job.owner.id)
        user_model_dir.mkdir(parents=True, exist_ok=True)

        storage_filename = f"{job.id.hex}.glb"
        final_dest_path = user_model_dir / storage_filename
        tmp_dest_path = user_model_dir / f"{job.id.hex}.tmp"

        # Write to temporary file first, then atomically rename
        with open(tmp_dest_path, 'wb') as f:
            f.write(model_bytes)

        if final_dest_path.exists():
            final_dest_path.unlink()
        tmp_dest_path.rename(final_dest_path)
        tmp_dest_path = None  # successfully renamed

        # 6. Compute extracted dimensions and latency
        extracted_dims = validation_info.get('approximate_dimensions') or result.approximate_dimensions or {}
        latency = int((time.time() - start_time) * 1000)

        # 7. Update job fields and mark completed
        rel_path = f"reconstructed_models/{job.owner.id}/{storage_filename}"
        job.model_file_path = rel_path
        job.file_size_bytes = len(model_bytes)
        job.approximate_dimensions = extracted_dims
        job.provider = result.provider
        job.model_name = result.model_name
        job.latency_ms = latency
        if result.suggested_catalogue_fallback_id:
            job.suggested_catalogue_fallback_id = result.suggested_catalogue_fallback_id

        meta = dict(job.raw_metadata or {})
        meta.update(result.raw_metadata or {})
        meta['validated'] = True
        job.raw_metadata = meta

        job.transition_to(FurnitureReconstructionJob.STATUS_COMPLETED)
        job.save()
        return job

    except GLBValidationError as val_err:
        # Corrupt, oversized, or invalid GLB output
        logger.warning("GLB validation failed for job %s: %s", job.id, val_err)
        _cleanup_file_safely(tmp_dest_path)
        _cleanup_file_safely(final_dest_path)
        safe_msg = sanitize_sensitive_text(str(val_err))
        job.transition_to(
            FurnitureReconstructionJob.STATUS_FAILED,
            error_category='validation_failed',
            error_message=safe_msg
        )
        return job

    except TimeoutError as timeout_err:
        logger.warning("Reconstruction timeout for job %s: %s", job.id, timeout_err)
        _cleanup_file_safely(tmp_dest_path)
        _cleanup_file_safely(final_dest_path)
        job.transition_to(
            FurnitureReconstructionJob.STATUS_FAILED,
            error_category='timeout',
            error_message="Reconstruction provider request timed out."
        )
        return job

    except Exception as exc:
        safe_msg = sanitize_sensitive_text(str(exc))
        logger.error("Reconstruction unexpected error for job %s: %s", job.id, safe_msg)
        _cleanup_file_safely(tmp_dest_path)
        _cleanup_file_safely(final_dest_path)
        job.transition_to(
            FurnitureReconstructionJob.STATUS_FAILED,
            error_category='provider_error',
            error_message=safe_msg or "Internal reconstruction processing failure."
        )
        return job


def delete_reconstruction_job_file(job: FurnitureReconstructionJob) -> bool:
    """
    Safely deletes the private GLB file associated with a reconstruction job.
    Returns True if a file was deleted, False if already absent or error.
    """
    try:
        abs_path = job.get_absolute_model_path()
        if abs_path and abs_path.exists() and abs_path.is_file():
            abs_path.unlink()
            return True
    except Exception as exc:
        logger.warning("Failed to delete model file for job %s: %s", job.id, exc)
    return False


def _cleanup_file_safely(path: Path | None) -> None:
    """Helper to remove orphaned or partial temporary files without raising errors."""
    if path and path.exists():
        try:
            path.unlink()
        except OSError:
            pass
