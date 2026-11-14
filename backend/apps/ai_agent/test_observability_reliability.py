"""
RoomGenie AI — Phase 8.3: Production Observability, Reliability & Telemetry Tests
Verifies correlation IDs, sensitive log sanitization, OperationalLogger event emission,
Gemini rate limit/timeout fallback attribution, and failure recovery.
"""

import json
import logging
from unittest.mock import patch, MagicMock
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.test import TestCase, RequestFactory, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.ai_agent.observability import OperationalLogger
from apps.ai_agent.adapters.gemini import GeminiDesignLLMAdapter
from apps.ai_agent.candidate_types import LayoutCandidate, ScoreBreakdown
from apps.ai_agent.models import AgentSession, AgentRun
from config.logging import sanitize_log_message, CorrelationIdFilter, StructuredLogFormatter
from config.middleware import CorrelationIdMiddleware, get_correlation_id

User = get_user_model()


class ObservabilityAndSanitizationTests(TestCase):
    def test_correlation_id_middleware_and_thread_local(self):
        captured_id = None
        def dummy_view(request):
            nonlocal captured_id
            captured_id = get_correlation_id()
            return HttpResponse("OK")

        middleware = CorrelationIdMiddleware(dummy_view)
        rf = RequestFactory()

        # 1. Without header -> generates UUID4
        req = rf.get('/api/v1/health/')
        res = middleware(req)
        cid = getattr(req, 'correlation_id', None)
        self.assertIsNotNone(cid)
        self.assertEqual(res['X-Request-ID'], cid)
        self.assertEqual(captured_id, cid)
        # Thread local must be cleared after request lifecycle
        self.assertEqual(get_correlation_id(), '')

        # 2. With header -> preserves incoming header
        custom_id = "test-custom-trace-12345"
        req2 = rf.get('/api/v1/health/', HTTP_X_REQUEST_ID=custom_id)
        res2 = middleware(req2)
        self.assertEqual(req2.correlation_id, custom_id)
        self.assertEqual(res2['X-Request-ID'], custom_id)
        self.assertEqual(captured_id, custom_id)
        self.assertEqual(get_correlation_id(), '')

    def test_sensitive_credential_redaction(self):
        dirty_strings = [
            "Calling Gemini with key=AIzaSyA_secret_key_12345",
            "Header x-goog-api-key: AIzaSyB_super_secret_54321",
            "Authorization: Bearer my_jwt_token_abcdef",
            "Authorization: Token user_auth_token_9999",
            "password: 'UserSecretPassword123!'",
            '{"password": "MySecretPassword!", "email": "test@example.com"}',
            "Tripo secret key tsk_live_998877665544",
        ]
        for s in dirty_strings:
            sanitized = sanitize_log_message(s)
            self.assertNotIn("AIzaSyA", sanitized)
            self.assertNotIn("AIzaSyB", sanitized)
            self.assertNotIn("my_jwt_token", sanitized)
            self.assertNotIn("user_auth_token", sanitized)
            self.assertNotIn("UserSecretPassword123!", sanitized)
            self.assertNotIn("MySecretPassword!", sanitized)
            self.assertNotIn("tsk_live_998877", sanitized)
            self.assertIn("[REDACTED", sanitized)

    def test_structured_log_formatter(self):
        record = logging.LogRecord(
            name='apps.ai_agent',
            level=logging.INFO,
            pathname='test.py',
            lineno=10,
            msg='Candidate pool generated successfully',
            args=(),
            exc_info=None,
        )
        record.request_id = 'trace-corr-777'
        formatter = StructuredLogFormatter()
        formatted = formatter.format(record)
        self.assertIn('[req=trace-corr-777]', formatted)
        self.assertIn('[apps.ai_agent]', formatted)
        self.assertIn('Candidate pool generated successfully', formatted)


class OperationalLoggerTests(TestCase):
    @patch('apps.ai_agent.observability.logger')
    def test_operational_logger_events(self, mock_logger):
        # 1. AI Generation Request
        OperationalLogger.log_ai_generation_request(
            user_prompt='Arrange living room',
            room_summary={'object_count': 1, 'approx_area': 20.0},
            provider='mock',
            model='deterministic-mock-v1',
            candidate_count=3,
        )
        self.assertTrue(mock_logger.info.called)

        # 2. Success
        OperationalLogger.log_ai_generation_success(
            duration_ms=120,
            candidates_count=3,
            valid_candidates_count=3,
            provider='mock',
            model='deterministic-mock-v1',
            top_score=95.5,
        )
        self.assertTrue(mock_logger.info.called)

        # 3. Fallback Activated
        OperationalLogger.log_fallback_activated(
            reason='HTTP 429 rate limit exceeded',
            original_provider='gemini',
            fallback_provider='mock',
        )
        self.assertTrue(mock_logger.warning.called)

        # 4. Gemini Timeout
        OperationalLogger.log_gemini_timeout(
            duration_ms=8120,
            model='gemini-3.8-flash',
            timeout_seconds=8.0,
        )
        self.assertTrue(mock_logger.warning.called)

        # 5. Gemini Rate Limit
        OperationalLogger.log_gemini_rate_limit(
            model='gemini-3.8-flash',
            retry_after=5.0,
        )
        self.assertTrue(mock_logger.warning.called)

        # 6. Persistence Failure
        OperationalLogger.log_persistence_failure(
            design_id='design-123',
            error_code='ERR_STALE_CONCURRENCY',
            error_reason='Optimistic concurrency conflict',
        )
        self.assertTrue(mock_logger.error.called)


class GeminiReliabilityAttributionTests(TestCase):
    @override_settings(GEMINI_API_KEY='test_gemini_key_123')
    @patch('apps.ai_agent.adapters.gemini.urllib.request.urlopen')
    def test_gemini_rate_limit_fallback_sets_mock_attribution(self, mock_urlopen):
        import urllib.error
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url='https://generativelanguage.googleapis.com',
            code=429,
            msg='Too Many Requests',
            hdrs={},
            fp=MagicMock(),
        )

        adapter = GeminiDesignLLMAdapter()
        res = adapter.generate_design_proposal(
            user_prompt='Arrange bedroom',
            current_scene={'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []},
        )

        self.assertEqual(res.provider, 'mock')
        self.assertEqual(res.model, 'deterministic-mock-v1')
        self.assertTrue(res.raw_metadata.get('fallback_triggered'))
        self.assertIn('429', res.raw_metadata.get('fallback_reason', ''))

    @override_settings(GEMINI_API_KEY='test_gemini_key_123')
    @patch('apps.ai_agent.adapters.gemini.urllib.request.urlopen')
    def test_gemini_timeout_fallback_sets_mock_attribution(self, mock_urlopen):
        mock_urlopen.side_effect = TimeoutError("The read operation timed out")

        adapter = GeminiDesignLLMAdapter()
        res = adapter.generate_design_proposal(
            user_prompt='Arrange bedroom',
            current_scene={'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []},
        )

        self.assertEqual(res.provider, 'mock')
        self.assertEqual(res.model, 'deterministic-mock-v1')
        self.assertTrue(res.raw_metadata.get('fallback_triggered'))
        self.assertIn('timed out', res.raw_metadata.get('fallback_reason', ''))
