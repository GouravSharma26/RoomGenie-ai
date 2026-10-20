from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ReconstructionResult:
    """
    Standardized result payload from an image-to-3D reconstruction adapter.
    """
    model_bytes: bytes
    format: str = 'glb'
    approximate_dimensions: dict[str, float] = field(default_factory=dict)
    provider: str = 'unknown'
    model_name: str = 'unknown'
    latency_ms: int = 0
    suggested_catalogue_fallback_id: str = 'sofa-modern-3seater'
    raw_metadata: dict[str, Any] = field(default_factory=dict)


class BaseImageTo3DAdapter(ABC):
    """
    Abstract interface for image-to-3D furniture reconstruction providers.
    All providers (Tripo, Mock, etc.) must implement this interface.
    """

    @abstractmethod
    def generate_furniture_model(
        self,
        image_path: str,
        category: str = 'seating',
        prompt_label: str = '',
        reference_dimensions: dict[str, float] | None = None,
        context: dict[str, Any] | None = None
    ) -> ReconstructionResult:
        """
        Reconstructs an approximate 3D furniture model from an input image file.
        Returns a ReconstructionResult containing verified GLB binary bytes and metadata.
        Does NOT alter active 3D scenes or database state.
        """
        pass
