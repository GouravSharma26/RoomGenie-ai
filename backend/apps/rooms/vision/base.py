from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RoomAnalysisResult:
    """
    Standardized result payload from a room vision analysis adapter.
    All providers must return observations matching the canonical schema.
    """
    observations: dict[str, Any]
    provider: str = 'unknown'
    model: str = 'unknown'
    latency_ms: int = 0
    raw_metadata: dict[str, Any] = field(default_factory=dict)


class BaseRoomVisionAdapter(ABC):
    """
    Abstract interface for room-photo vision analysis providers.
    All vision providers (Gemini, Mock, etc.) must implement this interface.
    The persistence and HTTP layers interact solely through this interface.
    """

    @abstractmethod
    def analyze_room_photo(
        self,
        image_path: str,
        context: dict[str, Any] | None = None
    ) -> RoomAnalysisResult:
        """
        Analyzes a verified local room photo file and produces structured room observations.
        Does NOT alter or persist any 3D scene state.
        """
        pass
