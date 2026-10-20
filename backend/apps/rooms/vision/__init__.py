from django.conf import settings
from apps.rooms.vision.base import BaseRoomVisionAdapter, RoomAnalysisResult
from apps.rooms.vision.mock import MockRoomVisionAdapter
from apps.rooms.vision.gemini import GeminiRoomVisionAdapter


def get_room_vision_adapter() -> BaseRoomVisionAdapter:
    """
    Factory function returning the configured vision analysis adapter.
    Defaults to MockRoomVisionAdapter for local development and automated tests.
    """
    mode = getattr(settings, 'ROOM_VISION_PROVIDER_MODE', getattr(settings, 'AI_PROVIDER_MODE', 'mock')).lower()
    if mode == 'gemini':
        return GeminiRoomVisionAdapter()
    return MockRoomVisionAdapter()


__all__ = [
    'BaseRoomVisionAdapter',
    'RoomAnalysisResult',
    'MockRoomVisionAdapter',
    'GeminiRoomVisionAdapter',
    'get_room_vision_adapter',
]
