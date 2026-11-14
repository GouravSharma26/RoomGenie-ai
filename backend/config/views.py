import time
from typing import Any
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from config.middleware import get_current_request_id

# Record process startup time
_SERVICE_START_TIME = timezone.now()


def check_database_health() -> tuple[str, float]:
    """
    Check if the default database is connected and responsive,
    measuring round-trip query latency in milliseconds.
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
    """Legacy compatibility helper; delegates to check_database_health()."""
    status_str, _ = check_database_health()
    return status_str


def check_unapplied_migrations() -> int:
    """Returns count of unapplied migrations, or -1 if check fails."""
    try:
        executor = MigrationExecutor(connection)
        targets = executor.loader.graph.leaf_nodes()
        plan = executor.migration_plan(targets)
        return len(plan)
    except Exception:
        return -1


@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """
    Production health and operational diagnostics endpoint for RoomGenie AI backend.
    Returns service info, latency, database connectivity, and model configuration.
    """
    # Call check_database_connection() so existing mock assertions in tests remain valid
    db_status = check_database_connection()
    _, db_latency_ms = check_database_health()

    unapplied_migrations = check_unapplied_migrations()
    fallback_models = getattr(settings, 'GEMINI_FALLBACK_MODELS', [])
    ai_mode = getattr(settings, 'AI_PROVIDER_MODE', 'unknown')
    has_gemini_key = bool(getattr(settings, 'GEMINI_API_KEY', ''))

    payload: dict[str, Any] = {
        'status': 'ok',
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
