from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase


class AccountAuthenticationTests(APITestCase):
    def setUp(self):
        self.register_url = reverse('accounts:register')
        self.login_url = reverse('accounts:login')
        self.me_url = reverse('accounts:me')
        self.demo_url = reverse('accounts:demo')

    def test_user_registration_success(self):
        payload = {
            'username': 'designer_alice',
            'email': 'alice@example.com',
            'password': 'SecurePassword2026!'
        }
        response = self.client.post(self.register_url, payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['user']['username'], 'designer_alice')
        self.assertTrue(Token.objects.filter(key=response.data['token']).exists())

    def test_user_registration_weak_password_rejected(self):
        payload = {
            'username': 'weak_user',
            'password': '123'
        }
        response = self.client.post(self.register_url, payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('errors', response.data)

    def test_user_login_success(self):
        User.objects.create_user(username='bob', password='BobPassword2026!')
        response = self.client.post(self.login_url, {
            'username': 'bob',
            'password': 'BobPassword2026!'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['user']['username'], 'bob')

    def test_user_login_invalid_credentials_rejected(self):
        User.objects.create_user(username='carol', password='CarolPassword2026!')
        response = self.client.post(self.login_url, {
            'username': 'carol',
            'password': 'WrongPassword!'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_current_user_profile_requires_auth(self):
        response = self.client.get(self.me_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_current_user_profile_authenticated(self):
        user = User.objects.create_user(username='dave', password='DavePassword2026!')
        token = Token.objects.create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        response = self.client.get(self.me_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['username'], 'dave')

    def test_demo_auth_provisions_demo_user(self):
        response = self.client.post(self.demo_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['user']['username'], 'demo_engineer')
