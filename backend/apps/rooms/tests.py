import io
import os
from decimal import Decimal
from PIL import Image
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase
from apps.rooms.models import Room, RoomPhotoUpload
from apps.rooms.services import cleanup_expired_room_photos


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


class RoomPhotoUploadTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(username='photo_alice', password='PasswordA2026!')
        self.token_a = Token.objects.create(user=self.user_a)

        self.user_b = User.objects.create_user(username='photo_bob', password='PasswordB2026!')
        self.token_b = Token.objects.create(user=self.user_b)

        self.room_a = Room.objects.create(
            owner=self.user_a,
            name="Alice Living Room",
            width=Decimal('5.00'),
            length=Decimal('4.00'),
            height=Decimal('2.80')
        )

        self.upload_url = reverse('rooms:room-photo-upload')

    def make_test_image(self, name="photo.jpg", format="JPEG", size=(640, 480), color="blue"):
        buf = io.BytesIO()
        img = Image.new("RGB", size, color=color)
        img.save(buf, format=format)
        buf.seek(0)
        mime = "image/jpeg" if format == "JPEG" else f"image/{format.lower()}"
        return SimpleUploadedFile(name, buf.getvalue(), content_type=mime)

    def test_unauthenticated_upload_rejected_401(self):
        img_file = self.make_test_image()
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_valid_jpeg_upload_success_201(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("living_room.jpg", "JPEG", size=(1280, 720))
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        self.assertIn('upload_id', res.data)
        self.assertEqual(res.data['status'], 'uploaded')
        self.assertEqual(res.data['format'], 'JPEG')
        self.assertEqual(res.data['content_type'], 'image/jpeg')
        self.assertEqual(res.data['width'], 1280)
        self.assertEqual(res.data['height'], 720)
        self.assertGreater(res.data['size_bytes'], 0)
        self.assertIsNone(res.data['room_id'])
        self.assertIn('expires_at', res.data)

        # Verify database record exists
        record = RoomPhotoUpload.objects.get(id=res.data['upload_id'])
        self.assertEqual(record.owner, self.user_a)
        self.assertTrue(os.path.exists(record.file_path))

    def test_valid_png_and_webp_uploads_accepted(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')

        # PNG
        png_file = self.make_test_image("diagram.png", "PNG", size=(800, 600))
        res_png = self.client.post(self.upload_url, {'photo': png_file}, format='multipart')
        self.assertEqual(res_png.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_png.data['format'], 'PNG')

        # WebP
        webp_file = self.make_test_image("photo.webp", "WEBP", size=(800, 600))
        res_webp = self.client.post(self.upload_url, {'photo': webp_file}, format='multipart')
        self.assertEqual(res_webp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_webp.data['format'], 'WEBP')

    def test_valid_upload_with_owned_room_id(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image()
        res = self.client.post(
            self.upload_url,
            {'photo': img_file, 'room_id': str(self.room_a.id)},
            format='multipart'
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['room_id'], str(self.room_a.id))

        record = RoomPhotoUpload.objects.get(id=res.data['upload_id'])
        self.assertEqual(record.room, self.room_a)

    def test_upload_with_cross_user_room_id_rejected(self):
        # User B attempts to link photo to Alice's room
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_b.key}')
        img_file = self.make_test_image()
        res = self.client.post(
            self.upload_url,
            {'photo': img_file, 'room_id': str(self.room_a.id)},
            format='multipart'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('room_id', res.data)
        # Verify no photo was linked to Alice's room
        self.assertFalse(RoomPhotoUpload.objects.filter(owner=self.user_b, room=self.room_a).exists())

    def test_unsupported_format_gif_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        gif_file = self.make_test_image("animation.gif", "GIF", size=(200, 200))
        res = self.client.post(self.upload_url, {'photo': gif_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('photo', res.data)

    def test_spoofed_extension_with_html_or_script_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        malicious_content = b"<html><script>alert('xss')</script></html>"
        fake_file = SimpleUploadedFile("exploit.jpg", malicious_content, content_type="image/jpeg")
        res = self.client.post(self.upload_url, {'photo': fake_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('photo', res.data)

    def test_malformed_corrupted_image_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        # Starts with valid JPEG header but has truncated corrupt garbage
        corrupt_data = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00truncatedcorruptbytes"
        corrupt_file = SimpleUploadedFile("corrupt.jpg", corrupt_data, content_type="image/jpeg")
        res = self.client.post(self.upload_url, {'photo': corrupt_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('photo', res.data)

    @override_settings(ROOM_PHOTO_MAX_UPLOAD_SIZE=5000)
    def test_oversized_file_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("large.jpg", "JPEG", size=(800, 600))
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("File size exceeds maximum allowed limit", str(res.data))

    def test_dimension_below_minimum_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        tiny_img = self.make_test_image("tiny.jpg", "JPEG", size=(50, 50))
        res = self.client.post(self.upload_url, {'photo': tiny_img}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("below the minimum required resolution", str(res.data))

    @override_settings(ROOM_PHOTO_MAX_DIMENSION=500)
    def test_dimension_above_maximum_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        giant_img = self.make_test_image("giant.jpg", "JPEG", size=(600, 400))
        res = self.client.post(self.upload_url, {'photo': giant_img}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("exceed the maximum allowed resolution", str(res.data))

    def test_ephemeral_cleanup_purges_expired_files_from_disk(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image()
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        upload_id = res.data['upload_id']

        record = RoomPhotoUpload.objects.get(id=upload_id)
        file_path = record.file_path
        self.assertTrue(os.path.exists(file_path))

        # Manually trigger cleanup for files older than -1 seconds (all files)
        purged = cleanup_expired_room_photos(max_age_seconds=-1)
        self.assertGreaterEqual(purged, 1)

        # File is deleted from disk
        self.assertFalse(os.path.exists(file_path))
        record.refresh_from_db()
        self.assertTrue(record.is_deleted)
