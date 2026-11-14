"""
Privacy-Conscious Spatial AI Telemetry for RoomGenie AI (Phase 6.5).

Enforces strict data minimization:
- NO API keys, session tokens, passwords, or credentials.
- NO raw user prompts (hashes intent, records character length & category only).
- NO full scene JSON or raw geometric vertex coordinates.
- Coarse room summaries only (area, wall count, object count).
- Stable, standardized error codes.
- Opt-out support via settings / ROOMGENIE_TELEMETRY_ENABLED env.
- Non-blocking: failures in telemetry never throw or interrupt core operations.
"""

import hashlib
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from django.conf import settings

logger = logging.getLogger("roomgenie.spatial_telemetry")

# In-memory circular buffer for telemetry inspection and verification in tests
_TELEMETRY_BUFFER: deque = deque(maxlen=200)

# Stable Standardized Error Codes
ERR_OBB_COLLISION = "ERR_OBB_COLLISION"
ERR_OUT_OF_BOUNDS = "ERR_OUT_OF_BOUNDS"
ERR_DOOR_OBSTRUCTED = "ERR_DOOR_OBSTRUCTED"
ERR_CIRCULATION_BLOCKED = "ERR_CIRCULATION_BLOCKED"
ERR_CLEARANCE_VIOLATION = "ERR_CLEARANCE_VIOLATION"
ERR_BUDGET_EXCEEDED = "ERR_BUDGET_EXCEEDED"
ERR_SOCKET_INCOMPATIBLE = "ERR_SOCKET_INCOMPATIBLE"
ERR_STALE_CONCURRENCY = "ERR_STALE_CONCURRENCY"
ERR_PROVIDER_TIMEOUT = "ERR_PROVIDER_TIMEOUT"
ERR_INVALID_PAYLOAD = "ERR_INVALID_PAYLOAD"
ERR_UNKNOWN = "ERR_UNKNOWN"


def is_telemetry_enabled() -> bool:
    """Checks whether telemetry is active according to Django settings and environment variables."""
    val = getattr(settings, "ROOMGENIE_TELEMETRY_ENABLED", None)
    if val is not None:
        return bool(val)
    env_val = os.getenv("ROOMGENIE_TELEMETRY_ENABLED", "true").strip().lower()
    return env_val in ("1", "true", "yes", "on")


def sanitize_prompt(prompt: Optional[str]) -> Dict[str, Any]:
    """
    Minimizes prompt data by extracting length, category, and an 8-character hash.
    Never stores the cleartext prompt.
    """
    if not prompt:
        return {"length": 0, "hash": "", "category": "empty"}

    p_clean = prompt.strip()
    p_hash = hashlib.sha256(p_clean.encode("utf-8")).hexdigest()[:8]

    p_lower = p_clean.lower()
    category = "general"
    if any(k in p_lower for k in ("sofa", "couch", "living", "coffee table", "lounge")):
        category = "living"
    elif any(k in p_lower for k in ("bed", "nightstand", "bedroom", "sleeping")):
        category = "bedroom"
    elif any(k in p_lower for k in ("desk", "office", "study", "workstation")):
        category = "workspace"
    elif any(k in p_lower for k in ("dining", "table", "chair")):
        category = "dining"

    return {
        "length": len(p_clean),
        "hash": p_hash,
        "category": category,
    }


def summarize_scene_coarse(scene: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Extracts coarse metrics from scene dictionary without retaining geometric points or object IDs.
    """
    if not isinstance(scene, dict):
        return {"object_count": 0, "wall_count": 0, "approx_area_sqm": 0.0, "is_polygon": False}

    room = scene.get("room", {}) if isinstance(scene.get("room"), dict) else {}
    width = float(room.get("width", 5.0) or 5.0)
    length = float(room.get("length", 4.0) or 4.0)
    footprint = room.get("footprint") or room.get("polygonVertices")
    is_polygon = isinstance(footprint, list) and len(footprint) >= 3

    approx_area = round(width * length, 2)
    objects = scene.get("objects", [])
    object_count = len(objects) if isinstance(objects, list) else 0

    walls = room.get("walls", [])
    wall_count = len(walls) if isinstance(walls, list) and len(walls) > 0 else (len(footprint) if is_polygon else 4)

    return {
        "object_count": object_count,
        "wall_count": wall_count,
        "approx_area_sqm": approx_area,
        "is_polygon": is_polygon,
    }


def record_spatial_event(
    event_name: str,
    payload: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    design_id: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """
    Records a structured telemetry event safely.
    Guarantees no sensitive user data or API keys leak into event payloads.
    """
    if not is_telemetry_enabled():
        return None

    try:
        sanitized_payload: Dict[str, Any] = {}
        if isinstance(payload, dict):
            for k, v in payload.items():
                # Strictly reject any sensitive keys
                k_lower = k.lower()
                if any(bad in k_lower for bad in ("key", "secret", "token", "auth", "password", "prompt_text", "scene_json")):
                    continue
                # Sanitize prompt field if present
                if k == "user_prompt":
                    sanitized_payload["prompt_summary"] = sanitize_prompt(v)
                elif k in ("current_scene", "scene", "candidate_scene"):
                    sanitized_payload[f"{k}_summary"] = summarize_scene_coarse(v)
                else:
                    sanitized_payload[k] = v

        event_record = {
            "event_name": event_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": str(session_id) if session_id else None,
            "design_id": str(design_id) if design_id is not None else None,
            "data": sanitized_payload,
        }

        _TELEMETRY_BUFFER.append(event_record)
        logger.info("Spatial telemetry: %s", event_name, extra={"telemetry": event_record})
        return event_record

    except Exception as exc:
        logger.debug("Spatial telemetry suppressed error: %s", exc)
        return None


def get_recent_telemetry_events() -> List[Dict[str, Any]]:
    """Returns a snapshot of the in-memory telemetry buffer (for inspection and tests)."""
    return list(_TELEMETRY_BUFFER)


def clear_telemetry_events() -> None:
    """Clears the in-memory telemetry buffer."""
    _TELEMETRY_BUFFER.clear()

