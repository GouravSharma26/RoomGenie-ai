import base64
import json
import logging
import mimetypes
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from django.conf import settings

from apps.rooms.vision.base import BaseRoomVisionAdapter, RoomAnalysisResult
from apps.rooms.vision.mock import MockRoomVisionAdapter

logger = logging.getLogger(__name__)


class GeminiRoomVisionAdapter(BaseRoomVisionAdapter):
    """
    Vision analysis adapter using Google Gemini API (model baseline: gemini-3.8-flash).
    Analyzes verified room images and extracts structured room observations.
    Falls back gracefully to MockRoomVisionAdapter when API key is missing or network fails.
    """

    def __init__(self):
        self.api_key = getattr(settings, 'GEMINI_API_KEY', '')
        self.model_name = getattr(settings, 'GEMINI_MODEL', 'gemini-3.8-flash')
        self.mock_fallback = MockRoomVisionAdapter()

    def analyze_room_photo(
        self,
        image_path: str,
        context: dict[str, Any] | None = None
    ) -> RoomAnalysisResult:
        start_time = time.time()
        context = context or {}

        # 1. Fallback if no API key is set
        if not self.api_key:
            logger.info("GEMINI_API_KEY not configured; using MockRoomVisionAdapter.")
            result = self.mock_fallback.analyze_room_photo(image_path, context=context)
            result.raw_metadata['fallback_used'] = True
            result.raw_metadata['fallback_reason'] = 'gemini_api_key_not_configured'
            return result

        p = Path(image_path)
        if not p.exists() or not p.is_file():
            raise FileNotFoundError(f"Room photo file not found at {image_path}")

        # 2. Read image and encode as base64
        mime_type, _ = mimetypes.guess_type(str(p))
        if not mime_type:
            mime_type = 'image/jpeg'

        try:
            with open(p, 'rb') as f:
                img_bytes = f.read()
            b64_data = base64.b64encode(img_bytes).decode('utf-8')
        except OSError as exc:
            raise OSError(f"Failed to read room photo for analysis: {exc}")

        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_name}:generateContent"
        )

        prompt_instruction = (
            "Analyze this interior room photograph as an architectural interior designer. "
            "Output your findings exclusively as a valid JSON object matching this exact schema:\n"
            "{\n"
            '  "room_type": "living_room" | "bedroom" | "home_office" | "dining_room" | "other",\n'
            '  "estimated_room_shape": "rectangular" | "square" | "l_shaped" | "open_concept",\n'
            '  "estimated_dimensions_approx_m": {"width_m": float, "length_m": float, "height_m": float},\n'
            '  "overall_confidence": 0.0 to 1.0,\n'
            '  "architectural_features": {\n'
            '    "flooring": "string description",\n'
            '    "wall_finish": "string description",\n'
            '    "lighting": "string description",\n'
            '    "windows_count": integer,\n'
            '    "doors_count": integer\n'
            "  },\n"
            '  "detected_furniture": [\n'
            "    {\n"
            '      "category": "seating" | "table" | "storage" | "bed" | "decor" | "other",\n'
            '      "label": "string name",\n'
            '      "estimated_spatial_zone": "string zone",\n'
            '      "color": "#hex code",\n'
            '      "material": "string material",\n'
            '      "confidence": 0.0 to 1.0,\n'
            '      "bounding_box": {"ymin": 0.0-1.0, "xmin": 0.0-1.0, "ymax": 0.0-1.0, "xmax": 0.0-1.0},\n'
            '      "approximate_dimensions_m": {"width_m": float, "length_m": float, "height_m": float},\n'
            '      "suggested_catalogue_asset_id": null\n'
            "    }\n"
            "  ],\n"
            '  "color_palette": [\n'
            '    {"hex": "#RRGGBB", "name": "Color Name", "role": "dominant_walls | primary_furniture | accent"}\n'
            "  ],\n"
            '  "style_description": "concise style summary",\n'
            '  "spatial_summary": "layout and circulation summary",\n'
            '  "recommendations": ["suggestion 1", "suggestion 2"],\n'
            '  "uncertainty_notes": "Note that exact dimensions cannot be measured from a single 2D photo.",\n'
            '  "requires_user_confirmation": true\n'
            "}\n\n"
            "Important: Do NOT wrap in markdown backticks or text outside JSON. Return only the JSON object."
        )

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt_instruction},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": b64_data,
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            }
        }

        data_json = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            endpoint,
            data=data_json,
            headers={
                'Content-Type': 'application/json',
                'x-goog-api-key': self.api_key,
            },
            method='POST'
        )

        try:
            with urllib.request.urlopen(req, timeout=25.0) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                raw_text = (
                    resp_data.get('candidates', [{}])[0]
                    .get('content', {})
                    .get('parts', [{}])[0]
                    .get('text', '{}')
                )

                # Clean markdown backticks if present
                clean_text = raw_text.strip()
                if clean_text.startswith('```json'):
                    clean_text = clean_text[7:]
                elif clean_text.startswith('```'):
                    clean_text = clean_text[3:]
                if clean_text.endswith('```'):
                    clean_text = clean_text[:-3]

                observations = json.loads(clean_text.strip())

                latency = int((time.time() - start_time) * 1000)
                return RoomAnalysisResult(
                    observations=observations,
                    provider='gemini',
                    model=self.model_name,
                    latency_ms=latency,
                    raw_metadata={'usage_metadata': resp_data.get('usageMetadata', {})}
                )
        except Exception as exc:
            # Safely record fallback without exposing URLs, API keys or secret credentials
            err_type = exc.__class__.__name__
            logger.warning(f"Gemini room vision analysis failed ({err_type}); falling back to mock provider.")
            result = self.mock_fallback.analyze_room_photo(image_path, context=context)
            result.raw_metadata['fallback_used'] = True
            result.raw_metadata['fallback_reason'] = f"gemini_provider_error: {err_type}"
            return result
