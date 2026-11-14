"""
RoomGenie AI — Configuration, Logging Security, and Health Endpoint Tests (Phase 8.3 & 8.3.1).
Deterministic unit and integration tests for:
1. Public minimal health endpoint and staff-only diagnostics.
2. Complete post-interpolation and traceback log sanitization.
3. Async-safe ContextVar correlation tracking.
4. Benchmark percentile interpolation mathematics.
"""
import asyncio
import logging
import time
from unittest.mock import patch, MagicMock
from django.test import TestCase, SimpleTestCase
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from config.logging import (
    sanitize_log_message,
    StructuredLogFormatter,
    CorrelationIdFilter,
)
from config.middleware import (
    get_current_request_id,
    set_current_request_id,
    clear_current_request_id,
    CorrelationIdMiddleware,
)
from scripts.run_benchmarks import percentile_interpolated, calculate_percentiles

User = get_user_model()


class HealthEndpointTests(TestCase):
    """
    Deterministic tests for public health endpoint and staff diagnostics endpoint.
    """

    def setUp(self):
        self.client = APIClient()
        self.health_url = reverse('health-check')
        self.diagnostics_url = reverse('health-diagnostics')

        # Create staff and non-staff test users
        self.staff_user = User.objects.create_user(
            username='staff_admin',
            email='staff@roomgenie.ai',
            password='StaffPassword123!',
            is_staff=True,
        )
        self.regular_user = User.objects.create_user(
            username='regular_client',
            email='client@roomgenie.ai',
            password='ClientPassword123!',
            is_staff=False,
        )

    def test_public_health_endpoint_allows_anonymous_access(self):
        """Verify the minimal health endpoint is completely public (AllowAny)."""
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_public_health_endpoint_minimal_contract(self):
        """Verify the public health endpoint returns only minimal operational status."""
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            self.assertEqual(data['status'], 'ok')
            self.assertEqual(data['service'], 'RoomGenie AI Backend')
            self.assertEqual(data['version'], '0.1.0')
            self.assertEqual(data['database'], 'connected')
            self.assertIn('timestamp', data)
            self.assertIn('request_id', data)

    def test_public_health_endpoint_does_not_leak_internals(self):
        """
        Verify public health check DOES NOT leak sensitive infrastructure metadata:
        database engine, migration sync, migration counts, AI provider configuration,
        gemini model names, fallback model pools, gemini readiness, or server uptime.
        """
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            # Must NOT expose infrastructure or operational internals publicly
            self.assertNotIn('db_engine', data)
            self.assertNotIn('db_latency_ms', data)
            self.assertNotIn('migrations_synced', data)
            self.assertNotIn('unapplied_migrations_count', data)
            self.assertNotIn('ai_provider_mode', data)
            self.assertNotIn('has_gemini_key', data)
            self.assertNotIn('gemini_model', data)
            self.assertNotIn('gemini_fallback_models', data)
            self.assertNotIn('gemini_ready', data)
            self.assertNotIn('uptime_seconds', data)

    def test_public_health_endpoint_executes_single_db_query(self):
        """Verify public health check performs at most one database connectivity check."""
        with patch('config.views.check_database_health', return_value=('connected', 1.25)) as mock_db:
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(mock_db.call_count, 1)

    def test_public_health_endpoint_when_database_disconnected(self):
        """Verify public health returns HTTP 503 and unhealthy status when database is disconnected."""
        with patch('config.views.check_database_connection', return_value='disconnected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
            data = response.json()
            self.assertEqual(data['status'], 'unhealthy')
            self.assertEqual(data['database'], 'disconnected')

    def test_staff_diagnostics_anonymous_denied(self):
        """Verify anonymous requests to diagnostics endpoint are denied (HTTP 401)."""
        response = self.client.get(self.diagnostics_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_staff_diagnostics_non_staff_denied(self):
        """Verify authenticated non-staff users are denied access to diagnostics (HTTP 403)."""
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get(self.diagnostics_url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_diagnostics_staff_allowed(self):
        """Verify authenticated staff users receive full operational diagnostics."""
        self.client.force_authenticate(user=self.staff_user)
        with patch('config.views.check_database_health', return_value=('connected', 2.45)):
            with patch('config.views.check_unapplied_migrations', return_value=0):
                response = self.client.get(self.diagnostics_url)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                data = response.json()
                self.assertEqual(data['status'], 'ok')
                self.assertEqual(data['database'], 'connected')
                self.assertEqual(data['db_latency_ms'], 2.45)
                self.assertIn('db_engine', data)
                self.assertTrue(data['migrations_synced'])
                self.assertEqual(data['unapplied_migrations_count'], 0)
                self.assertIn('uptime_seconds', data)
                self.assertIn('ai_provider_mode', data)
                self.assertIn('gemini_model', data)
                self.assertIn('gemini_fallback_models', data)

    def test_staff_diagnostics_migration_cache_avoids_repeated_migration_executor(self):
        """Verify migration status is cached and does not construct MigrationExecutor on every hit."""
        from config.views import _MIGRATION_CACHE, check_unapplied_migrations
        # Reset cache
        _MIGRATION_CACHE['cached_at'] = time.monotonic()
        _MIGRATION_CACHE['count'] = 0

        with patch('django.db.migrations.executor.MigrationExecutor') as mock_executor:
            count = check_unapplied_migrations(max_age_seconds=60.0)
            self.assertEqual(count, 0)
            # Executor should NOT have been instantiated because cache is fresh
            mock_executor.assert_not_called()


class StructuredLoggingSecurityTests(SimpleTestCase):
    """
    Comprehensive tests for formatter-level log sanitization (Phase 8.3.1).
    Guarantees post-interpolation redaction for positional args, named args,
    tracebacks, exception strings, tokens, passwords, and JSON payloads.
    """

    def setUp(self):
        self.formatter = StructuredLogFormatter()

    def test_sensitive_credentials_raw_sanitization(self):
        """Verify API keys, tokens, and passwords are unconditionally redacted from raw log strings."""
        raw_msg = (
            "Calling Gemini at https://generativelanguage.googleapis.com?key=AIzaSySecretKey1234567890abcdefghijk "
            "with Authorization: Token sec-tok-456 and password: 'SecretPassword99!' and tsk_live_tripo_789"
        )
        sanitized = sanitize_log_message(raw_msg)
        self.assertNotIn("AIzaSySecretKey1234567890abcdefghijk", sanitized)
        self.assertNotIn("sec-tok-456", sanitized)
        self.assertNotIn("SecretPassword99!", sanitized)
        self.assertNotIn("tsk_live_tripo_789", sanitized)
        self.assertIn("[REDACTED_GOOGLE_KEY]", sanitized)
        self.assertIn("[REDACTED_TRIPO_KEY]", sanitized)

    def test_formatter_sanitizes_positional_args(self):
        """CRITICAL: Verify secrets passed via positional args are sanitized after interpolation."""
        record = logging.LogRecord(
            name='test.security',
            level=logging.INFO,
            pathname='test.py',
            lineno=42,
            msg='User request payload: %s',
            args=('secret password: MySuperSecretPassword123!',),
            exc_info=None,
        )
        output = self.formatter.format(record)
        self.assertNotIn('MySuperSecretPassword123!', output)
        self.assertIn('User request payload: secret password: [REDACTED]', output)

    def test_formatter_sanitizes_named_args(self):
        """Verify secrets passed via named dictionary args are sanitized after interpolation."""
        record = logging.LogRecord(
            name='test.security',
            level=logging.INFO,
            pathname='test.py',
            lineno=45,
            msg='Authentication event for user with password: %(password)s',
            args=({'password': 'MyNamedPasswordSecret!'},),
            exc_info=None,
        )
        output = self.formatter.format(record)
        self.assertNotIn('MyNamedPasswordSecret!', output)
        self.assertIn('Authentication event for user with password: [REDACTED]', output)

    def test_formatter_sanitizes_exception_message_and_traceback(self):
        """Verify exception messages and stack traces containing API keys are redacted."""
        secret_key = 'AIzaSySecretKey1234567890abcdefghijk'
        try:
            raise ConnectionError(f"Failed to reach API endpoint using key={secret_key}")
        except ConnectionError:
            import sys
            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name='test.exceptions',
            level=logging.ERROR,
            pathname='test.py',
            lineno=60,
            msg='External service call crashed',
            args=(),
            exc_info=exc_info,
        )
        output = self.formatter.format(record)
        self.assertNotIn(secret_key, output)
        self.assertIn('[REDACTED_GOOGLE_KEY]', output)

    def test_formatter_sanitizes_oauth_and_bearer_and_tripo_tokens(self):
        """Verify OAuth ya29.* tokens, Bearer tokens, and Tripo tokens are all sanitized."""
        oauth_token = 'ya29.a0AfH6SMD1234567890abcdefghijklmnopqrstuv'
        bearer_token = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sampletoken'
        tripo_token = 'tsk_live_secret_tripo_key_9988'

        record = logging.LogRecord(
            name='test.tokens',
            level=logging.INFO,
            pathname='test.py',
            lineno=70,
            msg='Tokens: oauth=%s bearer=%s tripo=%s',
            args=(oauth_token, bearer_token, tripo_token),
            exc_info=None,
        )
        output = self.formatter.format(record)
        self.assertNotIn(oauth_token, output)
        self.assertNotIn('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sampletoken', output)
        self.assertNotIn(tripo_token, output)
        self.assertIn('[REDACTED_OAUTH_TOKEN]', output)
        self.assertIn('[REDACTED_TOKEN]', output)
        self.assertIn('[REDACTED_TRIPO_KEY]', output)

    def test_formatter_sanitizes_json_embedded_secrets(self):
        """Verify JSON-like strings containing secrets are sanitized."""
        json_payload = '{"api_key": "secret_key_12345", "password": "UserPass99!", "user": "admin"}'
        record = logging.LogRecord(
            name='test.json',
            level=logging.INFO,
            pathname='test.py',
            lineno=80,
            msg='Received JSON payload: %s',
            args=(json_payload,),
            exc_info=None,
        )
        output = self.formatter.format(record)
        self.assertNotIn('secret_key_12345', output)
        self.assertNotIn('UserPass99!', output)
        self.assertIn('"user": "admin"', output)

    def test_formatter_sanitizes_multiple_secrets_in_single_message(self):
        """Verify multiple different secrets within a single message are all sanitized."""
        record = logging.LogRecord(
            name='test.multi',
            level=logging.WARNING,
            pathname='test.py',
            lineno=90,
            msg='Multi: %s | %s | %s',
            args=(
                'AIzaSyTestKey12345678901234567890abcdef',
                'tsk_test_key_tripo_123',
                'password: MySecretPassword!',
            ),
            exc_info=None,
        )
        output = self.formatter.format(record)
        self.assertNotIn('AIzaSyTestKey12345678901234567890abcdef', output)
        self.assertNotIn('tsk_test_key_tripo_123', output)
        self.assertNotIn('MySecretPassword!', output)

    def test_formatter_preserves_normal_non_sensitive_logs(self):
        """Verify non-sensitive log records remain fully readable and correctly formatted."""
        record = logging.LogRecord(
            name='test.normal',
            level=logging.INFO,
            pathname='test.py',
            lineno=100,
            msg='Spatial optimization completed: iterations=%d, duration=%.1fms, score=%.1f',
            args=(5, 12.4, 94.2),
            exc_info=None,
        )
        record.request_id = 'req-abc-123'
        output = self.formatter.format(record)
        self.assertIn('[req=req-abc-123]', output)
        self.assertIn('[test.normal]: Spatial optimization completed: iterations=5, duration=12.4ms, score=94.2', output)

    def test_formatter_handles_malformed_record_safely(self):
        """Verify formatter does not crash on malformed format string or mismatched args."""
        record = logging.LogRecord(
            name='test.malformed',
            level=logging.ERROR,
            pathname='test.py',
            lineno=110,
            msg='Missing argument: %s %d',
            args=('only_one',),  # Missing second argument
            exc_info=None,
        )
        output = self.formatter.format(record)
        self.assertIn('LOG_FORMAT_ERROR', output)


class CorrelationIdContextVarTests(SimpleTestCase):
    """
    Tests for ContextVar-based request correlation and async isolation (Phase 8.3.1).
    """

    def test_header_sanitization_alphanumeric_and_hyphens(self):
        """Verify dangerous characters and control codes are stripped from correlation header."""
        middleware = CorrelationIdMiddleware(lambda req: MagicMock(headers={}, __getitem__=lambda s, k: ''))
        request = MagicMock()
        request.headers = {'X-Request-ID': 'req\r\nInject: evil<script>123-abc_def'}
        request.META = {}

        response = MagicMock(headers={})
        middleware.get_response = MagicMock(return_value=response)

        middleware(request)
        # Should be stripped of non-alphanumeric and non-hyphen chars
        sanitized_id = request.request_id
        self.assertNotIn('\r', sanitized_id)
        self.assertNotIn('\n', sanitized_id)
        self.assertNotIn('<', sanitized_id)
        self.assertNotIn('>', sanitized_id)
        self.assertNotIn('_', sanitized_id)
        self.assertIn('reqInjectevilscript123-abcdef', sanitized_id)

    def test_generated_uuid_fallback_when_missing(self):
        """Verify a clean 36-char UUID4 is generated when no correlation header is provided."""
        middleware = CorrelationIdMiddleware(lambda req: MagicMock(headers={}, __getitem__=lambda s, k: ''))
        request = MagicMock()
        request.headers = {}
        request.META = {}

        response = MagicMock(headers={})
        middleware.get_response = MagicMock(return_value=response)

        middleware(request)
        self.assertTrue(len(request.request_id) >= 32)

    def test_contextvar_cleanup_in_finally_block(self):
        """Verify request ID is cleanly purged from context after request completes."""
        middleware = CorrelationIdMiddleware(lambda req: MagicMock(headers={}, __getitem__=lambda s, k: ''))
        request = MagicMock()
        request.headers = {'X-Request-ID': 'req-test-cleanup-123'}
        request.META = {}

        response = MagicMock(headers={})
        middleware.get_response = MagicMock(return_value=response)

        middleware(request)
        # Once middleware exits, context request ID must be reset to empty
        self.assertEqual(get_current_request_id(), '')

    def test_concurrent_async_isolation(self):
        """Verify independent concurrent asynchronous contexts remain completely isolated."""
        async def worker(worker_id: str, results: dict):
            token = set_current_request_id(f"req-worker-{worker_id}")
            # Simulate async context yield
            await asyncio.sleep(0.01)
            results[worker_id] = get_current_request_id()
            clear_current_request_id(token)

        async def run_all():
            results = {}
            tasks = [worker(str(i), results) for i in range(5)]
            await asyncio.gather(*tasks)
            return results

        results = asyncio.run(run_all())
        for i in range(5):
            self.assertEqual(results[str(i)], f"req-worker-{i}")

    def test_background_task_fallback_defaults_to_system_in_formatter(self):
        """Verify background task without request context falls back to 'system' in log formatter."""
        clear_current_request_id()
        record = logging.LogRecord(
            name='test.bg',
            level=logging.INFO,
            pathname='test.py',
            lineno=130,
            msg='Background sync task executed',
            args=(),
            exc_info=None,
        )
        formatter = StructuredLogFormatter()
        output = formatter.format(record)
        self.assertIn('[req=system]', output)


class BenchmarkMethodologyTests(SimpleTestCase):
    """
    Tests for benchmark percentile calculation and linear interpolation accuracy.
    """

    def test_percentile_interpolation_on_small_sample(self):
        """Verify linearly interpolated percentile calculation (NIST/NumPy Type 7)."""
        data = [10.0, 20.0, 30.0, 40.0, 50.0]
        # P50 (median) should be exactly 30.0
        p50 = percentile_interpolated(data, 0.50)
        self.assertEqual(p50, 30.0)

        # Single element sample
        self.assertEqual(percentile_interpolated([42.5], 0.95), 42.5)

        # Empty sample
        self.assertEqual(percentile_interpolated([], 0.95), 0.0)

    def test_calculate_percentiles_summary(self):
        """Verify calculate_percentiles returns expected summary keys."""
        latencies = [12.0, 15.0, 18.0, 22.0, 35.0]
        summary = calculate_percentiles(latencies)
        self.assertEqual(summary['min'], 12.0)
        self.assertEqual(summary['max'], 35.0)
        self.assertEqual(summary['p50'], 18.0)
        self.assertTrue(summary['p95'] >= 18.0)
        self.assertTrue(summary['mean'] > 0)
