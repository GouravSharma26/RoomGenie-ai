"""
RoomGenie AI — Operational Health & Diagnostics Views (Phase 8.3 & 8.3.1).
Provides:
1. Minimal, unauthenticated public health check for uptime monitors (/api/v1/health/).
2. Protected, staff-only detailed operational diagnostics (/api/v1/health/diagnostics/).
"""
import time
from typing import Any
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework import status
from config.middleware import get_current_request_id

# Record process startup time
_SERVICE_START_TIME = timezone.now()

# In-memory migration status cache to prevent expensive repeated MigrationExecutor instantiation
_MIGRATION_CACHE: dict[str, Any] = {'count': -1, 'cached_at': 0.0}


def check_database_health() -> tuple[str, float]:
    """
    Check if the default database is connected and responsive,
    measuring round-trip query latency in milliseconds.
    Executes exactly ONE query.
    """
    start = time.perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1;')
            row = cursor.fetchone()
            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            if row and row[0] == 1:
                return 'connected', latency_ms
    except Exception:
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        return 'disconnected', latency_ms
    return 'disconnected', round((time.perf_counter() - start) * 1000, 2)


def check_database_connection() -> str:
    """Convenience helper returning 'connected' or 'disconnected'."""
    status_str, _ = check_database_health()
    return status_str


def check_unapplied_migrations(max_age_seconds: float = 60.0) -> int:
    """
    Returns count of unapplied migrations, or -1 if check fails.
    Caches result for max_age_seconds (default 60s) to eliminate repeated DB dependency graph builds.
    """
    now = time.monotonic()
    if now - _MIGRATION_CACHE['cached_at'] < max_age_seconds and _MIGRATION_CACHE['count'] >= 0:
        return _MIGRATION_CACHE['count']

    try:
        executor = MigrationExecutor(connection)
        targets = executor.loader.graph.leaf_nodes()
        plan = executor.migration_plan(targets)
        count = len(plan)
        _MIGRATION_CACHE['count'] = count
        _MIGRATION_CACHE['cached_at'] = now
        return count
    except Exception:
        return -1


@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """
    Minimal, unauthenticated public health endpoint for uptime monitoring.
    Performs exactly one lightweight database connectivity check without leaking
    infrastructure details, active AI configurations, or executing expensive migration graphs.
    """
    db_status = check_database_connection()
    is_healthy = db_status == 'connected'

    payload: dict[str, Any] = {
        'status': 'ok' if is_healthy else 'unhealthy',
        'service': 'RoomGenie AI Backend',
        'version': '0.1.0',
        'database': db_status,
        'timestamp': timezone.now().isoformat(),
        'request_id': getattr(request, 'request_id', get_current_request_id() or ''),
    }

    status_code = status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return Response(payload, status=status_code)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def health_diagnostics(request):
    """
    Staff-only operational diagnostics endpoint.
    Restricted exclusively to authenticated users with is_staff=True.
    Returns database latency, engine metadata, cached migration status, and AI configurations.
    Does not disclose API keys or secret credentials.
    """
    db_status, db_latency_ms = check_database_health()
    unapplied_migrations = check_unapplied_migrations()
    fallback_models = getattr(settings, 'GEMINI_FALLBACK_MODELS', [])
    ai_mode = getattr(settings, 'AI_PROVIDER_MODE', 'unknown')
    has_gemini_key = bool(getattr(settings, 'GEMINI_API_KEY', ''))

    payload: dict[str, Any] = {
        'status': 'ok' if db_status == 'connected' else 'degraded',
        'service': 'RoomGenie AI Backend',
        'version': '0.1.0',
        'uptime_seconds': int((timezone.now() - _SERVICE_START_TIME).total_seconds()),
        'database': db_status,
        'db_latency_ms': db_latency_ms,
        'db_engine': getattr(connection, 'vendor', 'unknown'),
        'migrations_synced': unapplied_migrations == 0,
        'unapplied_migrations_count': max(0, unapplied_migrations),
        'ai_provider_mode': ai_mode,
        'has_gemini_key': has_gemini_key,
        'gemini_model': getattr(settings, 'GEMINI_MODEL', 'unknown'),
        'gemini_fallback_models': fallback_models,
        'gemini_ready': has_gemini_key and (ai_mode in ('gemini', 'hybrid')),
        'timestamp': timezone.now().isoformat(),
        'request_id': getattr(request, 'request_id', get_current_request_id() or ''),
    }

    return Response(payload, status=status.HTTP_200_OK)
