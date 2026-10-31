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
    Supports resilient candidate model fallback (e.g., gemini-3-flash-preview, gemini-2.5-flash)
    if the primary model experiences high upstream demand (HTTP 503) or timeouts.
    Falls back gracefully to MockDesignLLMAdapter if API key is not configured or all network attempts fail.
    """

    def __init__(self):
        self.api_key = getattr(settings, 'GEMINI_API_KEY', '')
        self.model_name = getattr(settings, 'GEMINI_MODEL', 'gemini-3.8-flash')
        self.fallback_models = getattr(
            settings,
            'GEMINI_FALLBACK_MODELS',
            ['gemini-3-flash-preview', 'gemini-2.5-flash']
        )
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
        encoded_payload = json.dumps(payload).encode('utf-8')

        # Build candidate models sequence: primary model followed by resilient fallbacks
        models_to_try = [self.model_name]
        for fb in self.fallback_models:
            if fb and fb not in models_to_try:
                models_to_try.append(fb)

        errors_encountered = []

        for model_candidate in models_to_try:
            endpoint = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model_candidate}:generateContent?key={self.api_key}"
            )
            model_start = time.time()
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=encoded_payload,
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=8) as response:
                    resp_data = json.loads(response.read().decode('utf-8'))

                latency = int((time.time() - start_time) * 1000)
                raw_meta = {
                    'primary_model': self.model_name,
                    'model_used': model_candidate,
                    'fallback_triggered': model_candidate != self.model_name,
                }
                if errors_encountered:
                    raw_meta['previous_model_errors'] = errors_encountered

                return self._parse_gemini_response(
                    resp_data=resp_data,
                    latency_ms=latency,
                    model_name=model_candidate,
                    raw_meta=raw_meta
                )

            except Exception as exc:
                err_msg = f"{model_candidate}: {str(exc)}"
                errors_encountered.append(err_msg)
                logger.warning(
                    "Gemini API model %s failed (%s). Checking next candidate model.",
                    model_candidate,
                    exc
                )

        # If all candidate models failed, gracefully fall back to Mock adapter
        logger.warning(
            "All Gemini API model candidates failed (%s). Falling back to mock adapter.",
            "; ".join(errors_encountered)
        )
        fallback_res = self.mock_fallback.generate_design_proposal(
            user_prompt, current_scene, conversation_history, catalogue_context
        )
        fallback_res.raw_metadata['fallback_reason'] = f"gemini_error: {'; '.join(errors_encountered)}"
        return fallback_res

    def _parse_gemini_response(
        self,
        resp_data: dict[str, Any],
        latency_ms: int,
        model_name: str,
        raw_meta: dict[str, Any] | None = None
    ) -> DesignProposalResult:
        text_parts = []
        proposed_actions = []

        candidates = resp_data.get('candidates', [])
        if candidates:
            content = candidates[0].get('content', {})
            parts = content.get('parts', [])
            for part in parts:
                if 'text' in part and part['text'].strip():
                    text_parts.append(part['text'].strip())
                if 'functionCall' in part:
                    fn_call = part['functionCall']
                    fn_name = fn_call.get('name')
                    fn_args = fn_call.get('args', {})
                    action_dict = {'type': fn_name, **fn_args}
                    proposed_actions.append(action_dict)

        full_text = "\n".join(text_parts).strip()
        if not full_text:
            if proposed_actions:
                summaries = []
                for act in proposed_actions:
                    act_type = act.get('type')
                    if act_type == 'add_furniture':
                        asset = act.get('asset_id', 'item')
                        pos = act.get('position')
                        pos_str = f" at [{pos[0]:.1f}m, {pos[2]:.1f}m]" if isinstance(pos, list) and len(pos) >= 3 else ""
                        summaries.append(f"adding {asset}{pos_str}")
                    elif act_type == 'move_object':
                        summaries.append(f"repositioning object {act.get('object_id', '')}")
                    elif act_type == 'replace_furniture':
                        summaries.append(f"replacing with {act.get('new_asset_id', '')}")
                    elif act_type == 'set_material':
                        summaries.append(f"setting color to {act.get('color', '')}")
                    elif act_type == 'clear_room':
                        summaries.append("clearing room layout")
                action_summary = ", ".join(summaries) if summaries else "layout adjustments"
                full_text = f"I have formulated design recommendations for your room: {action_summary}. Please review the 3D preview and approve to apply."
            else:
                full_text = "I have prepared spatial recommendations for your room."

        metadata = raw_meta or {}
        metadata['candidates_count'] = len(candidates)

        return DesignProposalResult(
            text_response=full_text,
            proposed_actions=proposed_actions,
            provider='gemini',
            model=model_name,
            latency_ms=latency_ms,
            raw_metadata=metadata,
        )
