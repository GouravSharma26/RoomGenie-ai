import os
import time
from typing import Any
from django.conf import settings

from apps.furniture.reconstruction.base import BaseImageTo3DAdapter, ReconstructionResult
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError


class TripoImageTo3DAdapter(BaseImageTo3DAdapter):
    """
    Image-to-3D adapter for Tripo API (model v3.1-20260211).
    Performs external AI reconstruction when TRIPO_API_KEY is configured.
    Falls back gracefully to MockImageTo3DAdapter if no key is present or on failure,
    preserving application stability and logging audit metadata safely without secrets.
    """

    BASE_URL = "https://api.tripo3d.ai/v2/openapi"

    def __init__(self, api_key: str | None = None, model_name: str | None = None):
        self.api_key = api_key if api_key is not None else getattr(settings, 'TRIPO_API_KEY', '')
        self.model_name = model_name or getattr(settings, 'TRIPO_MODEL', 'v3.1-20260211')
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

        # 1. Fallback to Mock if API key is not configured or in development mode
        if not self.api_key or self.api_key.startswith('tsk_placeholder'):
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

        # 2. Live Tripo integration
        import urllib.request
        import urllib.error
        import json

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
                    # When live, requires uploaded GCS/S3 image URL or multipart upload token
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
            poll_start = time.time()
            model_url = None

            while time.time() - poll_start < 60.0:
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
                raise TimeoutError("Tripo 3D model reconstruction timed out after 60 seconds.")

            # Step C: Download output model and validate
            with urllib.request.urlopen(model_url, timeout=30.0) as model_resp:
                raw_glb_bytes = model_resp.read()

            # Strict GLB validation
            validation = GLBValidator.validate(raw_glb_bytes)

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
            # Do not leak API key in error message
            safe_err = str(exc).replace(self.api_key, "[REDACTED]")
            # Fall back to mock adapter with safe audit reasoning
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
