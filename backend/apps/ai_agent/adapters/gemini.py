import json
import logging
import time
import urllib.request
import urllib.error
from typing import Any
from django.conf import settings
from apps.ai_agent.adapters.base import BaseDesignLLMAdapter, DesignProposalResult
from apps.ai_agent.adapters.mock import MockDesignLLMAdapter
from apps.ai_agent.tools import get_available_tool_definitions

logger = logging.getLogger(__name__)


class GeminiDesignLLMAdapter(BaseDesignLLMAdapter):
    """
    Live adapter for Google Gemini API (model baseline: gemini-3.8-flash).
    Sends structured tool definitions and scene context.
    Falls back gracefully to MockDesignLLMAdapter if API key is not configured or network fails.
    """

    def __init__(self):
        self.api_key = getattr(settings, 'GEMINI_API_KEY', '')
        self.model_name = getattr(settings, 'GEMINI_MODEL', 'gemini-3.8-flash')
        self.mock_fallback = MockDesignLLMAdapter()

    def generate_design_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
    ) -> DesignProposalResult:
        start_time = time.time()

        # If no API key is provided, use deterministic mock fallback
        if not self.api_key:
            logger.info("GEMINI_API_KEY not configured; executing MockDesignLLMAdapter.")
            result = self.mock_fallback.generate_design_proposal(
                user_prompt, current_scene, conversation_history, catalogue_context
            )
            result.raw_metadata['fallback_reason'] = 'no_gemini_api_key'
            return result

        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_name}:generateContent?key={self.api_key}"
        )

        system_instruction = (
            "You are RoomGenie AI, an expert interior architect and 3D spatial design assistant. "
            "You help users furnish and arrange their 3D rooms using available catalogue assets. "
            "Coordinate system: Y is up (floor at Y=0), X and Z are floor plane in metres. "
            "Always return your proposed furniture changes by invoking the provided tools. "
            "Keep suggestions tasteful, functional, and ergonomically balanced."
        )

        # Context summary
        room = current_scene.get('room', {'width': 5.0, 'length': 4.0, 'height': 2.8}) if isinstance(current_scene, dict) else {}
        objects = current_scene.get('objects', []) if isinstance(current_scene, dict) else []

        context_prompt = (
            f"Room Envelope: {room.get('width', 5)}m wide × {room.get('length', 4)}m long × {room.get('height', 2.8)}m high.\n"
            f"Currently placed items ({len(objects)} items): {json.dumps(objects, default=str)}\n"
            f"Available catalogue items: {json.dumps(catalogue_context or [], default=str)}\n\n"
            f"User request: {user_prompt}"
        )

        tools_declaration = [
            {
                'functionDeclarations': [
                    {
                        'name': t['name'],
                        'description': t['description'],
                        'parameters': t['parameters'],
                    }
                    for t in get_available_tool_definitions()
                ]
            }
        ]

        payload = {
            'systemInstruction': {
                'parts': [{'text': system_instruction}]
            },
            'contents': [
                {
                    'role': 'user',
                    'parts': [{'text': context_prompt}]
                }
            ],
            'tools': tools_declaration,
            'generationConfig': {
                'temperature': 0.2,
                'maxOutputTokens': 1024,
            }
        }

        try:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                resp_data = json.loads(response.read().decode('utf-8'))

            latency = int((time.time() - start_time) * 1000)
            return self._parse_gemini_response(resp_data, latency)

        except Exception as exc:
            logger.warning("Gemini API call failed (%s). Falling back to mock adapter.", exc)
            fallback_res = self.mock_fallback.generate_design_proposal(
                user_prompt, current_scene, conversation_history, catalogue_context
            )
            fallback_res.raw_metadata['fallback_reason'] = f"gemini_error: {str(exc)}"
            return fallback_res

    def _parse_gemini_response(self, resp_data: dict[str, Any], latency_ms: int) -> DesignProposalResult:
        text_parts = []
        proposed_actions = []

        candidates = resp_data.get('candidates', [])
        if candidates:
            content = candidates[0].get('content', {})
            parts = content.get('parts', [])
            for part in parts:
                if 'text' in part:
                    text_parts.append(part['text'])
                if 'functionCall' in part:
                    fn_call = part['functionCall']
                    fn_name = fn_call.get('name')
                    fn_args = fn_call.get('args', {})
                    action_dict = {'type': fn_name, **fn_args}
                    proposed_actions.append(action_dict)

        full_text = "\n".join(text_parts).strip() or "I have prepared spatial recommendations for your room."

        return DesignProposalResult(
            text_response=full_text,
            proposed_actions=proposed_actions,
            provider='gemini',
            model=self.model_name,
            latency_ms=latency_ms,
            raw_metadata={'candidates_count': len(candidates)},
        )
