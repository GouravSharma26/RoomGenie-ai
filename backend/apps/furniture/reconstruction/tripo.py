import json
import logging
import re
import time
import urllib.error
import urllib.request
from typing import Any
from django.conf import settings

from apps.furniture.reconstruction.base import BaseImageTo3DAdapter, ReconstructionResult
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError

logger = logging.getLogger(__name__)


def sanitize_sensitive_text(text: str, secret: str = '') -> str:
    """Strips API keys, bearer tokens, and sensitive query strings from messages."""
    sanitized = text
    if secret:
        sanitized = sanitized.replace(secret, "[REDACTED]")
    sanitized = re.sub(r'Bearer\s+[a-zA-Z0-9_\-\.]+', 'Bearer [REDACTED]', sanitized)
    sanitized = re.sub(r'(api[-_]?key|key|token|secret)\s*[:=]\s*[^\s,;]+', r'\1=[REDACTED]', sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r'https?://[^\s"]+', '[URL_REDACTED]', sanitized)
    return sanitized[:255]


def stream_download_model(
    model_url: str,
    max_size_bytes: int = 15 * 1024 * 1024,
    chunk_size: int = 64 * 1024,
    timeout: float = 30.0
) -> bytes:
    """
    Streams a 3D model from a remote URL in chunks.
    Enforces maximum size bounds during streaming without reading the entire payload into memory.
    Treats Content-Length as advisory and immediately terminates/closes the response if exceeded.
    """
    req = urllib.request.Request(
        model_url,
        headers={"User-Agent": "RoomGenie-AI/1.0"}
    )
    resp = urllib.request.urlopen(req, timeout=timeout)
    try:
        # 1. Advisory Content-Length header check
        content_length_header = None
        if hasattr(resp, 'headers') and hasattr(resp.headers, 'get'):
            content_length_header = resp.headers.get('Content-Length')
        elif hasattr(resp, 'getheader'):
            content_length_header = resp.getheader('Content-Length')

        if content_length_header is not None:
            declared_len = None
            try:
                declared_len = int(content_length_header)
            except (ValueError, TypeError):
                declared_len = None

            if declared_len is not None and declared_len > max_size_bytes:
                raise GLBValidationError(
                    f"Model Content-Length header ({declared_len} bytes) exceeds maximum allowed limit of {max_size_bytes} bytes."
                )

        # 2. Stream chunk-by-chunk and strictly enforce byte bounds
        chunks = bytearray()
        while True:
            chunk = resp.read(chunk_size)
            if not chunk or not isinstance(chunk, (bytes, bytearray)):
                break
            chunks.extend(chunk)
            if len(chunks) > max_size_bytes:
                raise GLBValidationError(
                    f"Model download exceeded maximum allowed limit of {max_size_bytes} bytes during streaming (received {len(chunks)} bytes)."
                )
        return bytes(chunks)
    finally:
        resp.close()


class TripoImageTo3DAdapter(BaseImageTo3DAdapter):
    """
    Image-to-3D adapter for Tripo API (model v3.1-20260211).
    External paid AI requests are STRICTLY gated by:
    1. IMAGE_TO_3D_ALLOW_PAID_REQUESTS=True in settings
    2. Valid TRIPO_API_KEY (non-empty, non-placeholder)
    
    If either is missing, falls back deterministically to MockImageTo3DAdapter,
    ensuring zero accidental external credit consumption during tests or development.
    """

    BASE_URL = "https://api.tripo3d.ai/v2/openapi"

    def __init__(
        self,
        api_key: str | None = None,
        model_name: str | None = None,
        allow_paid: bool | None = None
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, 'TRIPO_API_KEY', '')
        self.model_name = model_name or getattr(settings, 'TRIPO_MODEL', 'v3.1-20260211')
        if allow_paid is not None:
            self.allow_paid = allow_paid
        else:
            self.allow_paid = getattr(settings, 'IMAGE_TO_3D_ALLOW_PAID_REQUESTS', False)
        self.mock_fallback = MockImageTo3DAdapter()

    def generate_furniture_model(
        self,
        image_path: str,
        category: str = 'seating',
        prompt_label: str = '',
        reference_dimensions: dict[str, float] | None = None,
        context: dict[str, Any] | None = None
    ) -> ReconstructionResult:
        start_time = time.time()
        context = context or {}

        # 1. Require explicit paid provider authorization
        if not self.allow_paid:
            logger.info("Tripo paid requests disabled by policy; falling back to mock provider.")
            result = self.mock_fallback.generate_furniture_model(
                image_path=image_path,
                category=category,
                prompt_label=prompt_label,
                reference_dimensions=reference_dimensions,
                context=context
            )
            result.provider = 'mock'
            result.raw_metadata['fallback_used'] = True
            result.raw_metadata['fallback_reason'] = 'paid_requests_not_authorized'
            return result

        # 2. Check for configured live API key
        if not self.api_key or self.api_key.startswith('tsk_placeholder'):
            logger.info("Tripo API key unconfigured; falling back to mock provider.")
            result = self.mock_fallback.generate_furniture_model(
                image_path=image_path,
                category=category,
                prompt_label=prompt_label,
                reference_dimensions=reference_dimensions,
                context=context
            )
            result.provider = 'mock'
            result.raw_metadata['fallback_used'] = True
            result.raw_metadata['fallback_reason'] = 'tripo_api_key_not_configured'
            return result

        # 3. Live Tripo integration
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "RoomGenie-AI/1.0"
        }

        try:
            # Step A: Initiate Task
            create_payload = {
                "type": "image_to_model",
                "model_version": self.model_name,
                "file": {
                    "type": "jpg",
                    "file_token": context.get("file_token", "")
                }
            }

            req = urllib.request.Request(
                f"{self.BASE_URL}/task",
                data=json.dumps(create_payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )

            # Enforce 15-second network timeout on task creation
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                task_data = json.loads(resp.read().decode('utf-8'))

            if task_data.get('code') != 0 or 'data' not in task_data:
                raise RuntimeError(f"Tripo task initiation failed: {task_data.get('message', 'Unknown error')}")

            task_id = task_data['data']['task_id']

            # Step B: Poll task status with hard timeout (max 60 seconds)
            poll_timeout = float(getattr(settings, 'IMAGE_TO_3D_TIMEOUT_SECONDS', 60))
            poll_start = time.time()
            model_url = None

            while time.time() - poll_start < poll_timeout:
                poll_req = urllib.request.Request(
                    f"{self.BASE_URL}/task/{task_id}",
                    headers=headers,
                    method='GET'
                )
                with urllib.request.urlopen(poll_req, timeout=15.0) as poll_resp:
                    status_data = json.loads(poll_resp.read().decode('utf-8'))

                t_status = status_data.get('data', {}).get('status')
                if t_status == 'success':
                    model_url = status_data['data'].get('output', {}).get('model')
                    break
                elif t_status in ('failed', 'cancelled'):
                    raise RuntimeError(f"Tripo task {task_id} failed with status: {t_status}")

                time.sleep(2.0)

            if not model_url:
                raise TimeoutError(f"Tripo 3D model reconstruction timed out after {poll_timeout:.0f} seconds.")

            # Step C: Stream output model download with bounded byte limits
            max_size = int(getattr(settings, 'IMAGE_TO_3D_MAX_OUTPUT_SIZE', 15 * 1024 * 1024))
            raw_glb_bytes = stream_download_model(model_url, max_size_bytes=max_size, timeout=30.0)

            # Step D: Strict glTF 2.0 Binary validation
            validation = GLBValidator.validate(raw_glb_bytes, max_size_bytes=max_size)

            latency = int((time.time() - start_time) * 1000)
            dims = validation.get('approximate_dimensions') or reference_dimensions or {'width_m': 1.0, 'height_m': 1.0, 'depth_m': 1.0}

            return ReconstructionResult(
                model_bytes=raw_glb_bytes,
                format='glb',
                approximate_dimensions=dims,
                provider='tripo',
                model_name=self.model_name,
                latency_ms=latency,
                suggested_catalogue_fallback_id=self.mock_fallback.CATALOGUE_FALLBACKS.get(category, 'sofa-modern-3seater'),
                raw_metadata={'task_id': task_id, 'model_version': self.model_name}
            )

        except Exception as exc:
            # Redact secrets, auth tokens, and sensitive URLs
            safe_err = sanitize_sensitive_text(str(exc), secret=self.api_key)
            logger.warning("Tripo reconstruction failed, falling back to mock: %s", safe_err)

            fallback_res = self.mock_fallback.generate_furniture_model(
                image_path=image_path,
                category=category,
                prompt_label=prompt_label,
                reference_dimensions=reference_dimensions,
                context=context
            )
            fallback_res.provider = 'mock'
            fallback_res.raw_metadata['fallback_used'] = True
            fallback_res.raw_metadata['fallback_reason'] = f"tripo_error: {safe_err[:120]}"
            return fallback_res
