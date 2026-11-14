import json
import logging
import re
import time
import urllib.request
import urllib.error
from typing import Any
from django.conf import settings
from apps.ai_agent.adapters.base import BaseDesignLLMAdapter, DesignProposalResult
from apps.ai_agent.adapters.mock import MockDesignLLMAdapter
from apps.ai_agent.tools import get_available_tool_definitions
from apps.ai_agent.spatial_context import format_spatial_context_for_prompt
from apps.ai_agent.observability import OperationalLogger

logger = logging.getLogger(__name__)


def sanitize_sensitive_text(text: str, secret: str = "") -> str:
    """
    Sanitizes strings to prevent credential exposure in logs or response metadata.
    Redacts the secret API key if present and any key query parameters.
    """
    if not text:
        return ""
    sanitized = str(text)
    if secret and secret.strip():
        sanitized = sanitized.replace(secret.strip(), "[REDACTED]")
    # Redact URL query parameter patterns like ?key=... or &key=...
    sanitized = re.sub(r'([?&]key=)[^&\s]+', r'\1[REDACTED]', sanitized)
    # Redact x-goog-api-key headers if captured in string representation
    sanitized = re.sub(r'(x-goog-api-key["\']?\s*[:=]\s*["\']?)[^"\'\s,]+', r'\1[REDACTED]', sanitized, flags=re.IGNORECASE)
    return sanitized


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
        spatial_context: dict[str, Any] | None = None,
    ) -> DesignProposalResult:
        start_time = time.time()

        # If no API key is provided, use deterministic mock fallback
        if not self.api_key:
            logger.info("GEMINI_API_KEY not configured; executing MockDesignLLMAdapter.")
            result = self.mock_fallback.generate_design_proposal(
                user_prompt, current_scene, conversation_history, catalogue_context, spatial_context=spatial_context
            )
            result.raw_metadata['fallback_reason'] = 'no_gemini_api_key'
            return result

        system_instruction = (
            "You are RoomGenie AI, an expert interior architect and 3D spatial design assistant. "
            "You help users furnish and arrange their 3D rooms using available catalogue assets. "
            "Coordinate system: Y is up (floor at Y=0), X and Z are floor plane in metres. "
            "Always return your proposed furniture changes by invoking the provided tools. "
            "When connecting related furniture items (e.g. coffee tables or accent chairs to sofas, nightstands to beds, study chairs to desks), "
            "use 'attach_to_socket' with registered socket IDs (e.g., 'sofa-front-table', 'sofa-left-accent', 'sofa-right-accent', "
            "'bed-left-nightstand', 'bed-right-nightstand', 'desk-knee-well-chair') to guarantee physical and ergonomic spacing. "
            "When designing a functional room zone, use 'propose_zone_arrangement' specifying 'zone_type' and 'intent', "
            "and respect 'preserve_existing_furniture' requirements. "
            "Keep suggestions tasteful, functional, and ergonomically balanced."
        )

        # Context summary: high-signal spatial context when provided, with fallback to basic scene envelope
        spatial_summary = format_spatial_context_for_prompt(spatial_context, current_scene)
        context_prompt = (
            f"{spatial_summary}\n"
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
                f"{model_candidate}:generateContent"
            )
            model_start = time.time()
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=encoded_payload,
                    headers={
                        'Content-Type': 'application/json',
                        'x-goog-api-key': self.api_key,
                    },
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
                    raw_meta['previous_model_errors'] = [
                        sanitize_sensitive_text(err, self.api_key) for err in errors_encountered
                    ]

                return self._parse_gemini_response(
                    resp_data=resp_data,
                    latency_ms=latency,
                    model_name=model_candidate,
                    raw_meta=raw_meta
                )

            except Exception as exc:
                model_dur = int((time.time() - model_start) * 1000)
                if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                    OperationalLogger.log_gemini_rate_limit(model=model_candidate)
                elif isinstance(exc, (TimeoutError, urllib.error.URLError)) and ('timed out' in str(exc).lower() or isinstance(getattr(exc, 'reason', None), TimeoutError)):
                    OperationalLogger.log_gemini_timeout(duration_ms=model_dur, model=model_candidate, timeout_seconds=8)

                clean_exc = sanitize_sensitive_text(str(exc), self.api_key)
                err_msg = f"{model_candidate}: {clean_exc}"
                errors_encountered.append(err_msg)
                logger.warning(
                    "Gemini API model %s failed (%s). Checking next candidate model.",
                    model_candidate,
                    clean_exc
                )

        # If all candidate models failed, gracefully fall back to Mock adapter
        sanitized_summary = "; ".join(
            sanitize_sensitive_text(err, self.api_key) for err in errors_encountered
        )
        logger.warning(
            "All Gemini API model candidates failed (%s). Falling back to mock adapter.",
            sanitized_summary
        )
        OperationalLogger.log_fallback_activated(
            reason=sanitized_summary,
            original_provider='gemini',
            fallback_provider='mock'
        )
        fallback_res = self.mock_fallback.generate_design_proposal(
            user_prompt, current_scene, conversation_history, catalogue_context, spatial_context=spatial_context
        )
        fallback_res.provider = 'mock'
        fallback_res.model = 'deterministic-mock-v1'
        fallback_res.raw_metadata['fallback_triggered'] = True
        fallback_res.raw_metadata['fallback_reason'] = f"gemini_error: {sanitized_summary}"
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
                    elif act_type == 'attach_to_socket':
                        summaries.append(f"attaching {act.get('child_object_id', '')} to {act.get('anchor_object_id', '')} on socket {act.get('socket_id', '')}")
                    elif act_type == 'propose_zone_arrangement':
                        summaries.append(f"arranging {act.get('zone_type', 'functional')} zone")
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

    def generate_candidate_variants(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        candidate_count: int = 3,
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
        user_requirements: dict[str, Any] | None = None,
        preferences: Any = None,
    ) -> list[DesignProposalResult]:
        """
        Generates multiple distinct candidate layout proposals.
        If live Gemini API key is unavailable or encounters errors, falls back to MockDesignLLMAdapter.
        """
        if not self.api_key:
            return self.mock_fallback.generate_candidate_variants(
                user_prompt=user_prompt,
                current_scene=current_scene,
                candidate_count=candidate_count,
                conversation_history=conversation_history,
                catalogue_context=catalogue_context,
                spatial_context=spatial_context,
                user_requirements=user_requirements,
                preferences=preferences,
            )

        # Diverse stylistic/spatial directions for multi-candidate generation
        directions = [
            ("Option A: Balanced & Functional", "Focus on optimal ergonomic spacing and functional convenience."),
            ("Option B: Open Circulation", "Focus on maximizing open floor space and wide transit routes."),
            ("Option C: Focused & Cozy", "Focus on an intimate, defined zone arrangement."),
        ]

        variants: list[DesignProposalResult] = []
        for i in range(min(candidate_count, len(directions))):
            label, intent_hint = directions[i]
            augmented_prompt = f"{user_prompt}\nDesign directive for this variant: {intent_hint}"
            try:
                proposal = self.generate_design_proposal(
                    user_prompt=augmented_prompt,
                    current_scene=current_scene,
                    conversation_history=conversation_history,
                    catalogue_context=catalogue_context,
                    spatial_context=spatial_context,
                )
                proposal.candidate_label = label
                proposal.description = f"{label}: {intent_hint}"
                variants.append(proposal)
            except Exception as exc:
                logger.warning("Failed to generate Gemini variant %d: %s", i + 1, exc)

        if not variants:
            OperationalLogger.log_fallback_activated(
                reason="all_gemini_candidate_variants_failed",
                original_provider='gemini',
                fallback_provider='mock'
            )
            mock_variants = self.mock_fallback.generate_candidate_variants(
                user_prompt=user_prompt,
                current_scene=current_scene,
                candidate_count=candidate_count,
                conversation_history=conversation_history,
                catalogue_context=catalogue_context,
                spatial_context=spatial_context,
                user_requirements=user_requirements,
                preferences=preferences,
            )
            for mv in mock_variants:
                mv.provider = 'mock'
                mv.model = 'deterministic-mock-v1'
                if not mv.raw_metadata:
                    mv.raw_metadata = {}
                mv.raw_metadata['fallback_triggered'] = True
                mv.raw_metadata['fallback_reason'] = 'gemini_variants_failed'
            return mock_variants

        return variants

    def refine_candidate_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        failed_proposal: DesignProposalResult,
        validation_feedback: dict[str, Any],
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
        attempt: int = 1,
    ) -> DesignProposalResult:
        """
        Refines a proposal using live Gemini instructions or falls back to mock.
        """
        if not self.api_key:
            return self.mock_fallback.refine_candidate_proposal(
                user_prompt=user_prompt,
                current_scene=current_scene,
                failed_proposal=failed_proposal,
                validation_feedback=validation_feedback,
                catalogue_context=catalogue_context,
                spatial_context=spatial_context,
                attempt=attempt,
            )

        errors_summary = "; ".join(validation_feedback.get('errors', []))
        refinement_prompt = (
            f"{user_prompt}\n"
            f"PREVIOUS ATTEMPT FAILED VALIDATION (Attempt {attempt}): {errors_summary}.\n"
            f"Please revise your tool calls to fix these physical collisions, boundary breaches, or clearance issues."
        )
        try:
            refined = self.generate_design_proposal(
                user_prompt=refinement_prompt,
                current_scene=current_scene,
                catalogue_context=catalogue_context,
                spatial_context=spatial_context,
            )
            refined.candidate_label = failed_proposal.candidate_label
            return refined
        except Exception:
            return self.mock_fallback.refine_candidate_proposal(
                user_prompt=user_prompt,
                current_scene=current_scene,
                failed_proposal=failed_proposal,
                validation_feedback=validation_feedback,
                catalogue_context=catalogue_context,
                spatial_context=spatial_context,
                attempt=attempt,
            )

