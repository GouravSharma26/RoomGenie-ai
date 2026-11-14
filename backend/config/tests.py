from unittest.mock import patch
import logging
from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from config.logging import sanitize_log_message, StructuredLogFormatter


class HealthEndpointTests(SimpleTestCase):
    """
    Deterministic unit tests for /api/v1/health/ endpoint using SimpleTestCase.
    All database connectivity checks are strictly mocked so unit tests never
    depend on external services or local environment configuration.
    """

    def setUp(self):
        self.client = APIClient()
        self.health_url = reverse('health-check')

    def test_health_endpoint_allows_anonymous_access(self):
        """Verify the health diagnostic endpoint is public even when DRF defaults to IsAuthenticated."""
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_endpoint_status_and_keys(self):
        """Verify full JSON contract of health endpoint when database check succeeds."""
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn('application/json', response['Content-Type'])
            
            data = response.json()
            self.assertEqual(data['status'], 'ok')
            self.assertEqual(data['service'], 'RoomGenie AI Backend')
            self.assertEqual(data['version'], '0.1.0')
            self.assertEqual(data['database'], 'connected')
            self.assertIn('timestamp', data)

    def test_health_endpoint_diagnostics_operational_fields(self):
        """Verify Phase 8.3 operational diagnostic fields are present in health response."""
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            self.assertIn('db_latency_ms', data)
            self.assertIn('uptime_seconds', data)
            self.assertIn('db_engine', data)
            self.assertIn('migrations_synced', data)
            self.assertIn('gemini_ready', data)
            self.assertIn('request_id', data)
            self.assertTrue(len(data['request_id']) > 0)
            self.assertIn('X-Request-ID', response.headers)

    def test_health_endpoint_when_database_disconnected(self):
        """Verify fallback JSON contract when database check reports disconnected."""
        with patch('config.views.check_database_connection', return_value='disconnected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            self.assertEqual(data['status'], 'ok')
            self.assertEqual(data['database'], 'disconnected')
            self.assertEqual(data['service'], 'RoomGenie AI Backend')
            self.assertEqual(data['version'], '0.1.0')

    def test_correlation_id_middleware_preserves_custom_header(self):
        """Verify incoming X-Request-ID header is propagated into the response."""
        custom_id = 'req-trace-verification-9876'
        with patch('config.views.check_database_connection', return_value='connected'):
            response = self.client.get(self.health_url, HTTP_X_REQUEST_ID=custom_id)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response['X-Request-ID'], custom_id)
            data = response.json()
            self.assertEqual(data['request_id'], custom_id)


class StructuredLoggingTests(SimpleTestCase):
    """
    Tests for structured logging sanitization and formatting safeguards (Phase 8.3).
    """

    def test_sensitive_credentials_sanitization(self):
        """Verify API keys, tokens, and passwords are unconditionally redacted from log strings."""
        raw_msg = (
            "Calling Gemini at https://generativelanguage.googleapis.com?key=AIzaSySecretKey123 "
            "with Authorization: Token sec-tok-456 and password: 'SecretPassword99!' and tsk_live_tripo_789"
        )
        sanitized = sanitize_log_message(raw_msg)
        self.assertNotIn("AIzaSySecretKey123", sanitized)
        self.assertNotIn("sec-tok-456", sanitized)
        self.assertNotIn("SecretPassword99!", sanitized)
        self.assertNotIn("tsk_live_tripo_789", sanitized)
        self.assertIn("[REDACTED]", sanitized)
