"""
RoomGenie AI — AI & Spatial Observability Service (Phase 8.3).
Provides structured logging and operational telemetry for agent operations.
Guarantees:
- Never raises exceptions: logging failure never interrupts business logic.
- Sanitizes private user prompts (hashes and records category/length only).
- Never logs API keys, access tokens, passwords, or session cookies.
- Correlates operations with request_id.
"""
import hashlib
import logging
import time
from typing import Any
from config.middleware import get_current_request_id

logger = logging.getLogger('apps.ai_agent.observability')


def hash_prompt(prompt: str) -> str:
    """Computes a privacy-preserving 8-character SHA-256 hash of a prompt."""
    if not prompt:
        return 'empty'
    return hashlib.sha256(prompt.strip().encode('utf-8')).hexdigest()[:8]


def categorize_prompt(prompt: str) -> str:
    """Categorizes prompt by primary room domain without storing prompt text."""
    p = prompt.lower()
    if any(k in p for k in ('sofa', 'couch', 'living', 'tv', 'coffee table', 'armchair')):
        return 'living'
    if any(k in p for k in ('bed', 'nightstand', 'wardrobe', 'bedroom', 'mattress')):
        return 'bedroom'
    if any(k in p for k in ('desk', 'study', 'office', 'workspace', 'chair', 'bookshelf')):
        return 'workspace'
    if any(k in p for k in ('dining', 'dining table')):
        return 'dining'
    return 'general'


class OperationalLogger:
    """
    Central operational logger for AI agent, spatial optimizer, and persistence workflows.
    """

    @staticmethod
    def log_ai_generation_request(
        user_prompt: str,
        room_summary: dict[str, Any],
        provider: str,
        model: str,
        candidate_count: int = 3,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            summary = {
                'event': 'ai_generation_requested',
                'request_id': req_id,
                'prompt_hash': hash_prompt(user_prompt),
                'prompt_length': len(user_prompt or ''),
                'prompt_category': categorize_prompt(user_prompt or ''),
                'room_objects': room_summary.get('object_count', 0),
                'room_area_sqm': room_summary.get('approx_area', 0),
                'provider': provider,
                'model': model,
                'candidate_count': candidate_count,
            }
            logger.info("AI generation requested: %s", summary)
        except Exception:
            pass

    @staticmethod
    def log_ai_generation_success(
        duration_ms: int,
        candidates_count: int,
        valid_candidates_count: int,
        provider: str,
        model: str,
        top_score: float | None = None,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            summary = {
                'event': 'ai_generation_succeeded',
                'request_id': req_id,
                'duration_ms': duration_ms,
                'candidates_count': candidates_count,
                'valid_candidates_count': valid_candidates_count,
                'provider': provider,
                'model': model,
                'top_score': round(top_score, 1) if top_score is not None else None,
            }
            logger.info("AI generation succeeded: %s", summary)
        except Exception:
            pass

    @staticmethod
    def log_ai_generation_failure(
        duration_ms: int,
        error_code: str,
        error_message: str,
        provider: str,
        model: str,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            summary = {
                'event': 'ai_generation_failed',
                'request_id': req_id,
                'duration_ms': duration_ms,
                'error_code': error_code,
                'error_message': error_message[:200] if error_message else '',
                'provider': provider,
                'model': model,
            }
            logger.error("AI generation failed: %s", summary)
        except Exception:
            pass

    @staticmethod
    def log_gemini_timeout(
        duration_ms: int,
        model: str,
        timeout_seconds: float,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            logger.warning(
                "Gemini request timed out after %dms (timeout limit=%ss, model=%s, req_id=%s)",
                duration_ms,
                timeout_seconds,
                model,
                req_id
            )
        except Exception:
            pass

    @staticmethod
    def log_gemini_rate_limit(
        model: str,
        retry_after: float | None = None,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            logger.warning(
                "Gemini rate limit (HTTP 429) encountered for model=%s (retry_after=%s, req_id=%s)",
                model,
                retry_after,
                req_id
            )
        except Exception:
            pass

    @staticmethod
    def log_fallback_activated(
        reason: str,
        original_provider: str,
        fallback_provider: str,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            logger.warning(
                "Fallback provider activated (reason=%s, from=%s, to=%s, req_id=%s)",
                reason[:200],
                original_provider,
                fallback_provider,
                req_id
            )
        except Exception:
            pass

    @staticmethod
    def log_optimization_completed(
        iterations: int,
        duration_ms: float,
        initial_score: float,
        final_score: float,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            summary = {
                'event': 'spatial_optimization_completed',
                'request_id': req_id,
                'iterations': iterations,
                'duration_ms': round(duration_ms, 1),
                'initial_score': round(initial_score, 1),
                'final_score': round(final_score, 1),
                'improvement': round(final_score - initial_score, 1),
            }
            logger.info("Spatial optimization completed: %s", summary)
        except Exception:
            pass

    @staticmethod
    def log_persistence_failure(
        design_id: Any,
        error_code: str,
        error_reason: str,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            logger.error(
                "Design persistence failed (design_id=%s, code=%s, reason=%s, req_id=%s)",
                design_id,
                error_code,
                error_reason[:200],
                req_id
            )
        except Exception:
            pass

    @staticmethod
    def log_stale_proposal_conflict(
        design_id: Any,
        expected_hash: str,
        actual_hash: str,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            logger.warning(
                "Stale proposal conflict detected (design_id=%s, expected_hash=%s, actual_hash=%s, req_id=%s)",
                design_id,
                expected_hash[:8] if expected_hash else '',
                actual_hash[:8] if actual_hash else '',
                req_id
            )
        except Exception:
            pass

    @staticmethod
    def log_auth_failure(
        endpoint: str,
        reason: str,
        request_id: str | None = None,
    ) -> None:
        try:
            req_id = request_id or get_current_request_id() or 'no-req'
            logger.warning(
                "Authentication/Authorization failed at %s (reason=%s, req_id=%s)",
                endpoint,
                reason[:100],
                req_id
            )
        except Exception:
            pass
