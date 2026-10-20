"""
Furniture 3D Reconstruction package for RoomGenie AI.
Handles GLB validation, provider adapters (mock & Tripo), and reconstruction lifecycle.
"""
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError
from apps.furniture.reconstruction.base import BaseImageTo3DAdapter, ReconstructionResult
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter, build_procedural_furniture_glb
from apps.furniture.reconstruction.tripo import (
    TripoImageTo3DAdapter,
    stream_download_model,
    validate_download_url,
    SafeRedirectHandler,
)
from apps.furniture.reconstruction.services import (
    resolve_catalogue_fallback,
    get_image_to_3d_adapter,
    create_reconstruction_job,
    run_reconstruction_job,
    delete_reconstruction_job_file,
    validate_reference_dimensions,
)

__all__ = [
    'GLBValidator',
    'GLBValidationError',
    'BaseImageTo3DAdapter',
    'ReconstructionResult',
    'MockImageTo3DAdapter',
    'build_procedural_furniture_glb',
    'TripoImageTo3DAdapter',
    'stream_download_model',
    'validate_download_url',
    'SafeRedirectHandler',
    'resolve_catalogue_fallback',
    'get_image_to_3d_adapter',
    'create_reconstruction_job',
    'run_reconstruction_job',
    'delete_reconstruction_job_file',
    'validate_reference_dimensions',
]

