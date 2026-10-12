from unittest.mock import patch
from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status

class HealthEndpointTests(SimpleTestCase):
    """
    Tests for /api/v1/health/ endpoint using SimpleTestCase.
    """

    def setUp(self):
        self.client = APIClient()
        self.health_url = reverse('health-check')

    def test_health_endpoint_status_and_keys(self):
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

    def test_health_endpoint_when_database_disconnected(self):
        with patch('config.views.check_database_connection', return_value='disconnected'):
            response = self.client.get(self.health_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            self.assertEqual(data['status'], 'ok')
            self.assertEqual(data['database'], 'disconnected')

    def test_health_endpoint_live_structure(self):
        response = self.client.get(self.health_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn('status', data)
        self.assertIn('service', data)
        self.assertIn('version', data)
        self.assertIn('database', data)
        self.assertIn('timestamp', data)
