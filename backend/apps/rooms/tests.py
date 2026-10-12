from decimal import Decimal
from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase
from apps.rooms.models import Room


class RoomPersistenceTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(username='user_a', password='PasswordA2026!')
        self.token_a = Token.objects.create(user=self.user_a)
        
        self.user_b = User.objects.create_user(username='user_b', password='PasswordB2026!')
        self.token_b = Token.objects.create(user=self.user_b)

        self.list_url = reverse('rooms:room-list')

    def test_unauthenticated_cannot_access_rooms(self):
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_room_authenticated(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        payload = {
            'name': 'Studio Apartment Living Room',
            'width': '6.50',
            'length': '4.80',
            'height': '3.00'
        }
        response = self.client.post(self.list_url, payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], 'Studio Apartment Living Room')
        self.assertEqual(response.data['width'], '6.50')

        room = Room.objects.get(id=response.data['id'])
        self.assertEqual(room.owner, self.user_a)

    def test_room_dimension_validation(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        # Width below minimum (2.0m)
        response = self.client.post(self.list_url, {
            'name': 'Too Narrow',
            'width': '1.20',
            'length': '4.00',
            'height': '2.80'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Height above maximum (10.0m)
        response = self.client.post(self.list_url, {
            'name': 'Too High',
            'width': '5.00',
            'length': '4.00',
            'height': '15.00'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_ownership_isolation_between_users(self):
        room_a = Room.objects.create(
            owner=self.user_a,
            name="Alice's Private Room",
            width=Decimal('5.00'),
            length=Decimal('4.00'),
            height=Decimal('2.80')
        )
        detail_url = reverse('rooms:room-detail', kwargs={'pk': room_a.id})

        # User B cannot see User A's room in list
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_b.key}')
        list_response = self.client.get(self.list_url)
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data), 0)

        # User B cannot retrieve User A's room (404 prevents resource enumeration)
        detail_response = self.client.get(detail_url)
        self.assertEqual(detail_response.status_code, status.HTTP_404_NOT_FOUND)

        # User B cannot update User A's room
        patch_response = self.client.patch(detail_url, {'name': 'Hacked Room'})
        self.assertEqual(patch_response.status_code, status.HTTP_404_NOT_FOUND)

        # User B cannot delete User A's room
        del_response = self.client.delete(detail_url)
        self.assertEqual(del_response.status_code, status.HTTP_404_NOT_FOUND)

        # Verify room was not touched
        room_a.refresh_from_db()
        self.assertEqual(room_a.name, "Alice's Private Room")
