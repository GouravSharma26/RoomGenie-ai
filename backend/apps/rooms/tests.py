import io
import os
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase
from apps.furniture.models import FurnitureAsset
from apps.rooms.models import Room, RoomPhotoUpload, RoomPhotoAnalysis
from apps.designs.models import Design
from apps.rooms.services import cleanup_expired_room_photos, save_temporary_room_photo, run_room_photo_analysis
from apps.rooms.vision import get_room_vision_adapter
from apps.rooms.vision.base import BaseRoomVisionAdapter, RoomAnalysisResult
from apps.rooms.vision.mock import MockRoomVisionAdapter
from apps.rooms.vision.gemini import GeminiRoomVisionAdapter


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

        # Mark expired in the past
        record.expires_at = timezone.now() - timedelta(seconds=10)
        record.save(update_fields=['expires_at'])

        purged = cleanup_expired_room_photos()
        self.assertGreaterEqual(purged['purged_count'], 1)
        self.assertEqual(purged['failed_count'], 0)

        # File is deleted from disk
        self.assertFalse(os.path.exists(file_path))
        record.refresh_from_db()
        self.assertTrue(record.is_deleted)

    def test_cleanup_management_command_execution_and_dry_run(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("cmd_test.jpg", "JPEG")
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        record = RoomPhotoUpload.objects.get(id=res.data['upload_id'])
        self.assertTrue(os.path.exists(record.file_path))

        # Mark expired in the past
        record.expires_at = timezone.now() - timedelta(seconds=10)
        record.save(update_fields=['expires_at'])

        # 1. Test Dry Run: output indicates dry run, disk file still exists, DB is_deleted remains False
        out = io.StringIO()
        call_command('cleanup_expired_photos', '--dry-run', stdout=out)
        output_str = out.getvalue()
        self.assertIn("DRY-RUN", output_str)
        self.assertIn("purged=1", output_str)
        self.assertTrue(os.path.exists(record.file_path))
        record.refresh_from_db()
        self.assertFalse(record.is_deleted)

        # 2. Real Run: deletes disk file and marks record as deleted
        out_real = io.StringIO()
        call_command('cleanup_expired_photos', stdout=out_real)
        output_real_str = out_real.getvalue()
        self.assertIn("purged=1", output_real_str)
        self.assertIn("failed=0", output_real_str)
        self.assertFalse(os.path.exists(record.file_path))
        record.refresh_from_db()
        self.assertTrue(record.is_deleted)

    def test_cleanup_handles_unlink_failures_safely(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("unlink_err.jpg", "JPEG")
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        record = RoomPhotoUpload.objects.get(id=res.data['upload_id'])
        record.expires_at = timezone.now() - timedelta(seconds=10)
        record.save(update_fields=['expires_at'])

        # Mock Path.unlink to raise OSError (e.g. permission error, locked file)
        with patch.object(Path, 'unlink', side_effect=OSError("Permission denied on disk")):
            out = io.StringIO()
            call_command('cleanup_expired_photos', stdout=out)
            output_str = out.getvalue()
            self.assertIn("failed=1", output_str)

        # Command should not crash, file still exists, is_deleted is NOT True so it can be retried
        self.assertTrue(os.path.exists(record.file_path))
        record.refresh_from_db()
        self.assertFalse(record.is_deleted)

        # Clean up the actual file after test
        if os.path.exists(record.file_path):
            os.remove(record.file_path)

    def test_cleanup_handles_already_missing_disk_files_gracefully(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("already_gone.jpg", "JPEG")
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        record = RoomPhotoUpload.objects.get(id=res.data['upload_id'])
        record.expires_at = timezone.now() - timedelta(seconds=10)
        record.save(update_fields=['expires_at'])

        # Manually delete file behind Django's back
        if os.path.exists(record.file_path):
            os.remove(record.file_path)
        self.assertFalse(os.path.exists(record.file_path))

        out = io.StringIO()
        call_command('cleanup_expired_photos', stdout=out)
        output_str = out.getvalue()
        self.assertIn("missing=1", output_str)
        self.assertIn("failed=0", output_str)

        record.refresh_from_db()
        self.assertTrue(record.is_deleted)

    def test_cleanup_rejects_negative_or_zero_max_age_without_changes(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("active_photo.jpg", "JPEG")
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        record = RoomPhotoUpload.objects.get(id=res.data['upload_id'])
        file_path = record.file_path

        # 1. Management command rejects negative values
        out_err = io.StringIO()
        with self.assertRaises(CommandError) as ctx_neg:
            call_command('cleanup_expired_photos', '--max-age-seconds=-10', stderr=out_err)
        self.assertIn("positive integer", str(ctx_neg.exception))

        # 2. Management command rejects zero
        with self.assertRaises(CommandError) as ctx_zero:
            call_command('cleanup_expired_photos', '--max-age-seconds=0', stderr=out_err)
        self.assertIn("positive integer", str(ctx_zero.exception))

        # 3. Service function rejects negative values
        with self.assertRaises(ValueError) as ctx_serv_neg:
            cleanup_expired_room_photos(max_age_seconds=-1)
        self.assertIn("positive integer", str(ctx_serv_neg.exception))

        # 4. Service function rejects zero
        with self.assertRaises(ValueError) as ctx_serv_zero:
            cleanup_expired_room_photos(max_age_seconds=0)
        self.assertIn("positive integer", str(ctx_serv_zero.exception))

        # Assert zero file or database changes occurred
        self.assertTrue(os.path.exists(file_path), "Active file must not be deleted on invalid cleanup age")
        record.refresh_from_db()
        self.assertFalse(record.is_deleted, "Record is_deleted flag must remain False")

        # Cleanup file after test
        if os.path.exists(file_path):
            os.remove(file_path)

    def test_cleanup_handles_inspection_filesystem_errors_safely(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file1 = self.make_test_image("inspect_err1.jpg", "JPEG")
        res1 = self.client.post(self.upload_url, {'photo': img_file1}, format='multipart')
        record1 = RoomPhotoUpload.objects.get(id=res1.data['upload_id'])
        record1.expires_at = timezone.now() - timedelta(seconds=10)
        record1.save(update_fields=['expires_at'])

        img_file2 = self.make_test_image("inspect_err2.jpg", "JPEG")
        res2 = self.client.post(self.upload_url, {'photo': img_file2}, format='multipart')
        record2 = RoomPhotoUpload.objects.get(id=res2.data['upload_id'])
        record2.expires_at = timezone.now() - timedelta(seconds=10)
        record2.save(update_fields=['expires_at'])

        original_exists = Path.exists

        def mock_exists(path_self):
            # Simulate filesystem/stat/permission error on record1 during inspection
            if str(path_self) == record1.file_path:
                raise OSError("Filesystem I/O error during inspection")
            return original_exists(path_self)

        with patch.object(Path, 'exists', autospec=True, side_effect=mock_exists):
            summary = cleanup_expired_room_photos()

        # Batch continued and did not abort!
        self.assertEqual(summary['total_scanned'], 2)
        self.assertEqual(summary['failed_count'], 1)
        self.assertEqual(summary['purged_count'], 1)

        # record1 was left retryable (not marked deleted in DB, file kept)
        record1.refresh_from_db()
        self.assertFalse(record1.is_deleted)
        self.assertTrue(os.path.exists(record1.file_path))

        # record2 was purged successfully
        record2.refresh_from_db()
        self.assertTrue(record2.is_deleted)
        self.assertFalse(os.path.exists(record2.file_path))

        # Cleanup test file
        if os.path.exists(record1.file_path):
            os.remove(record1.file_path)

    def test_early_content_length_rejection_413(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file = self.make_test_image("huge.jpg", "JPEG")
        oversized_content_length = str(20 * 1024 * 1024)  # 20 MB

        initial_count = RoomPhotoUpload.objects.count()
        res = self.client.post(
            self.upload_url,
            {'photo': img_file},
            format='multipart',
            CONTENT_LENGTH=oversized_content_length
        )
        self.assertEqual(res.status_code, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        self.assertEqual(res.data.get('code'), 'request_entity_too_large')
        self.assertIn('exceeds maximum allowed size', res.data.get('detail', ''))
        # No DB record or file created
        self.assertEqual(RoomPhotoUpload.objects.count(), initial_count)

    @override_settings(ROOM_PHOTO_MAX_PIXELS=400_000)
    def test_max_total_pixels_limit_rejected_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        # 800x600 = 480,000 pixels (> 400,000 max pixels limit)
        img_file = self.make_test_image("exceed_pixels.jpg", "JPEG", size=(800, 600))
        res = self.client.post(self.upload_url, {'photo': img_file}, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        error_text = str(res.data)
        self.assertTrue(
            "exceeds safe threshold" in error_text or
            "exceeds the maximum allowed limit" in error_text or
            "decompression bomb" in error_text.lower(),
            f"Expected pixel limit error, got: {error_text}"
        )

    def test_pillow_decompression_bomb_warning_and_error_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        img_file1 = self.make_test_image("bomb1.jpg", "JPEG")

        # Simulate Pillow triggering DecompressionBombWarning on Image.open
        with patch('apps.rooms.services.Image.open', side_effect=Image.DecompressionBombWarning("Image size (120000000 pixels) exceeds limit")):
            res_warn = self.client.post(self.upload_url, {'photo': img_file1}, format='multipart')
            self.assertEqual(res_warn.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("decompression bomb", str(res_warn.data).lower())

        img_file2 = self.make_test_image("bomb2.jpg", "JPEG")
        # Simulate Pillow raising DecompressionBombError
        with patch('apps.rooms.services.Image.open', side_effect=Image.DecompressionBombError("Image size (200000000 pixels) exceeds bomb threshold")):
            res_err = self.client.post(self.upload_url, {'photo': img_file2}, format='multipart')
            self.assertEqual(res_err.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("decompression bomb", str(res_err.data).lower())

    def test_failed_database_operation_leaves_no_orphaned_file(self):
        img_file = self.make_test_image("orphan_test.jpg", "JPEG")
        temp_dir = Path(settings.MEDIA_ROOT) / 'temp_room_photos' / str(self.user_a.id)

        # Record list of existing files before test
        existing_files_before = set(temp_dir.glob('*')) if temp_dir.exists() else set()

        with patch.object(RoomPhotoUpload.objects, 'create', side_effect=DatabaseError("DB connection failed")):
            with self.assertRaises(DatabaseError):
                save_temporary_room_photo(user=self.user_a, uploaded_file=img_file)

        # Verify no new orphaned file was left behind
        existing_files_after = set(temp_dir.glob('*')) if temp_dir.exists() else set()
        new_files = existing_files_after - existing_files_before
        self.assertEqual(len(new_files), 0, f"Found orphaned files left on disk: {new_files}")

    def test_failed_disk_write_leaves_no_orphaned_file(self):
        img_file = self.make_test_image("disk_fail.jpg", "JPEG")
        temp_dir = Path(settings.MEDIA_ROOT) / 'temp_room_photos' / str(self.user_a.id)
        existing_files_before = set(temp_dir.glob('*')) if temp_dir.exists() else set()

        # Simulate write failure during chunks iteration
        with patch.object(SimpleUploadedFile, 'chunks', side_effect=IOError("Disk write failed midway")):
            with self.assertRaises(IOError):
                save_temporary_room_photo(user=self.user_a, uploaded_file=img_file)

        existing_files_after = set(temp_dir.glob('*')) if temp_dir.exists() else set()
        new_files = existing_files_after - existing_files_before
        self.assertEqual(len(new_files), 0, f"Found orphaned files left on disk: {new_files}")


class RoomPhotoVisionAnalysisTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(username='vision_user_a', password='PasswordA2026!')
        self.token_a = Token.objects.create(user=self.user_a)

        self.user_b = User.objects.create_user(username='vision_user_b', password='PasswordB2026!')
        self.token_b = Token.objects.create(user=self.user_b)

        self.upload_url = reverse('rooms:room-photo-upload')
        self.analyze_url = reverse('rooms:room-photo-analyze')
        self.analyses_list_url = reverse('rooms:room-analysis-list')

        self.room_a = Room.objects.create(
            owner=self.user_a,
            name="Living Space",
            width=Decimal('5.50'),
            length=Decimal('4.20'),
            height=Decimal('2.80')
        )
        self.room_b = Room.objects.create(
            owner=self.user_b,
            name="User B Bedroom",
            width=Decimal('4.00'),
            length=Decimal('3.50'),
            height=Decimal('2.70')
        )

        for asset_id, name, cat in [
            ('sofa-modern-3seater', 'Modern 3-Seater Sofa', 'seating'),
            ('table-oak-coffee', 'Minimalist Coffee Table', 'tables'),
            ('desk-workspace-study', 'Ergonomic Study Desk', 'tables'),
            ('chair-accent-armchair', 'Lounge Accent Armchair', 'seating'),
            ('storage-bookshelf-tall', '4-Tier Architectural Bookshelf', 'storage'),
            ('bed-queen-platform', 'Nordic Queen Platform Bed', 'beds'),
            ('storage-wardrobe-compact', 'Compact 2-Door Wardrobe', 'storage'),
            ('table-bedside-nightstand', 'Minimalist Nightstand', 'tables'),
            ('decor-plant-floor-vase', 'Botanical Ceramic Floor Planter', 'decor'),
            ('decor-divider-architectural', 'Custom Slatted Partition Screen', 'decor'),
            # Legacy alias seeds for backward compatibility checks
            ('sofa-3seater-fabric', '3-Seater Fabric Sofa', 'seating'),
            ('table-coffee-round', 'Round Coffee Table', 'tables'),
            ('bed-queen-wood', 'Queen Size Platform Bed', 'beds'),
            ('table-nightstand-minimal', 'Bedside Nightstand', 'tables'),
            ('table-desk-minimal', 'Writing & Computer Desk', 'tables'),
        ]:
            FurnitureAsset.objects.get_or_create(
                id=asset_id,
                defaults={
                    'name': name,
                    'category': cat,
                    'width': Decimal('1.00'),
                    'height': Decimal('1.00'),
                    'depth': Decimal('1.00'),
                    'price_paise': 100000,
                    'is_active': True,
                }
            )

    def tearDown(self):
        # Cleanup temporary files created in test media directories
        for user in [self.user_a, self.user_b]:
            user_media = Path(settings.MEDIA_ROOT) / 'temp_room_photos' / str(user.id)
            if user_media.exists() and user_media.is_dir():
                for f in user_media.glob('*'):
                    try:
                        if f.is_file():
                            f.unlink()
                    except OSError:
                        pass
                try:
                    user_media.rmdir()
                except OSError:
                    pass

    def upload_test_photo(self, user_token, filename="living.jpg", room_id=None):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {user_token.key}')
        file_io = io.BytesIO()
        img = Image.new('RGB', (800, 600), color=(180, 200, 220))
        img.save(file_io, format='JPEG')
        file_io.seek(0)
        uploaded = SimpleUploadedFile(filename, file_io.read(), content_type='image/jpeg')

        payload = {'photo': uploaded}
        if room_id:
            payload['room_id'] = str(room_id)
        res = self.client.post(self.upload_url, payload, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        return res.data['upload_id']

    def test_room_vision_analysis_success_with_mock_provider(self):
        upload_id = self.upload_test_photo(self.token_a, "living.jpg", room_id=self.room_a.id)

        res = self.client.post(self.analyze_url, {
            'upload_id': upload_id,
            'room_id': str(self.room_a.id),
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data

        self.assertEqual(data['status'], 'completed')
        self.assertEqual(data['provider'], 'mock')
        self.assertEqual(data['photo_upload_id'], str(upload_id))
        self.assertEqual(data['room_id'], str(self.room_a.id))

        obs = data['observations']
        self.assertEqual(obs['room_type'], 'living_room')
        self.assertGreater(obs['overall_confidence'], 0.5)
        self.assertTrue(obs['requires_user_confirmation'])
        self.assertIn("cannot be reliably inferred", obs['uncertainty_notes'])

        # Architectural features
        arch = obs['architectural_features']
        self.assertIn('flooring', arch)
        self.assertIn('wall_finish', arch)
        self.assertIn('lighting', arch)
        self.assertGreaterEqual(arch['windows_count'], 1)

        # Detected furniture
        furniture = obs['detected_furniture']
        self.assertIsInstance(furniture, list)
        self.assertGreater(len(furniture), 0)
        first_item = furniture[0]
        self.assertIn('category', first_item)
        self.assertIn('label', first_item)
        self.assertIn('estimated_spatial_zone', first_item)
        self.assertIn('confidence', first_item)

        # Check DB record
        record = RoomPhotoAnalysis.objects.get(id=data['id'])
        self.assertEqual(record.status, 'completed')
        self.assertEqual(record.owner, self.user_a)

    def test_room_vision_analysis_hints_bedroom_and_office(self):
        # 1. Bedroom hint
        upload_id_bed = self.upload_test_photo(self.token_a, "bed_snap.jpg")
        res_bed = self.client.post(self.analyze_url, {
            'upload_id': upload_id_bed,
            'room_type_hint': 'bedroom',
        }, format='json')
        self.assertEqual(res_bed.status_code, status.HTTP_200_OK)
        self.assertEqual(res_bed.data['observations']['room_type'], 'bedroom')
        bed_categories = [f['category'] for f in res_bed.data['observations']['detected_furniture']]
        self.assertIn('bed', bed_categories)

        # 2. Office hint
        upload_id_off = self.upload_test_photo(self.token_a, "office_snap.jpg")
        res_off = self.client.post(self.analyze_url, {
            'upload_id': upload_id_off,
            'room_type_hint': 'home_office',
        }, format='json')
        self.assertEqual(res_off.status_code, status.HTTP_200_OK)
        self.assertEqual(res_off.data['observations']['room_type'], 'home_office')
        off_categories = [f['category'] for f in res_off.data['observations']['detected_furniture']]
        self.assertTrue('table' in off_categories or 'seating' in off_categories)

    def test_room_vision_analysis_authorization_cross_user_rejected(self):
        upload_id = self.upload_test_photo(self.token_a, "private_photo.jpg")

        # User B attempts to analyze User A's photo
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_b.key}')
        res = self.client.post(self.analyze_url, {
            'upload_id': upload_id,
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not found or access denied", str(res.data))

        # User A analyzes their photo successfully
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        res_ok = self.client.post(self.analyze_url, {'upload_id': upload_id}, format='json')
        analysis_id = res_ok.data['id']

        # User B attempts to retrieve User A's analysis record
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_b.key}')
        res_detail = self.client.get(reverse('rooms:room-analysis-detail', kwargs={'analysis_id': analysis_id}))
        self.assertEqual(res_detail.status_code, status.HTTP_404_NOT_FOUND)

    def test_room_vision_analysis_unauthenticated_rejected(self):
        self.client.credentials()  # Clear credentials
        res = self.client.post(self.analyze_url, {'upload_id': '00000000-0000-0000-0000-000000000000'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_room_vision_analysis_cross_user_room_rejected(self):
        upload_id = self.upload_test_photo(self.token_a, "room_auth.jpg")

        # User A attempts to attach User B's room
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        res = self.client.post(self.analyze_url, {
            'upload_id': upload_id,
            'room_id': str(self.room_b.id),
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("does not exist or you do not have permission", str(res.data))

    def test_room_vision_analysis_expired_photo_rejected(self):
        upload_id = self.upload_test_photo(self.token_a, "expired.jpg")
        record = RoomPhotoUpload.objects.get(id=upload_id)
        record.expires_at = timezone.now() - timedelta(seconds=60)
        record.save(update_fields=['expires_at'])

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        res = self.client.post(self.analyze_url, {'upload_id': upload_id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("expired", str(res.data).lower())

    def test_room_vision_analysis_deleted_or_missing_file_rejected(self):
        upload_id = self.upload_test_photo(self.token_a, "deleted.jpg")
        record = RoomPhotoUpload.objects.get(id=upload_id)

        # 1. Mark is_deleted=True
        record.is_deleted = True
        record.save(update_fields=['is_deleted'])
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        res_del = self.client.post(self.analyze_url, {'upload_id': upload_id}, format='json')
        self.assertEqual(res_del.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cleaned up", str(res_del.data).lower())

        # 2. File missing from disk
        record.is_deleted = False
        record.save(update_fields=['is_deleted'])
        if os.path.exists(record.file_path):
            os.remove(record.file_path)

        res_miss = self.client.post(self.analyze_url, {'upload_id': upload_id}, format='json')
        self.assertEqual(res_miss.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("missing", str(res_miss.data).lower())

    def test_room_vision_analysis_provider_failure_handled_gracefully(self):
        upload_id = self.upload_test_photo(self.token_a, "prov_fail.jpg")

        class FailingVisionAdapter(BaseRoomVisionAdapter):
            def analyze_room_photo(self, image_path, context=None):
                raise RuntimeError("External vision provider connection timed out.")

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        with patch('apps.rooms.services.get_room_vision_adapter', return_value=FailingVisionAdapter()):
            res = self.client.post(self.analyze_url, {'upload_id': upload_id}, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("failed", str(res.data).lower())

        # Verify a failed analysis record was persisted
        failed_record = RoomPhotoAnalysis.objects.filter(photo_upload_id=upload_id).first()
        self.assertIsNotNone(failed_record)
        self.assertEqual(failed_record.status, 'failed')
        self.assertIn("timed out", failed_record.error_message)

    def test_room_vision_analysis_malformed_model_output_rejected(self):
        upload_id = self.upload_test_photo(self.token_a, "malformed.jpg")

        class MalformedVisionAdapter(BaseRoomVisionAdapter):
            def analyze_room_photo(self, image_path, context=None):
                # Return observations missing required fields and out-of-range confidence
                return RoomAnalysisResult(
                    observations={
                        'overall_confidence': 1.5,  # Exceeds max_value 1.0
                        'detected_furniture': "not-a-list",
                    },
                    provider='bad_provider',
                    model='bad_model',
                    latency_ms=10
                )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        with patch('apps.rooms.services.get_room_vision_adapter', return_value=MalformedVisionAdapter()):
            res = self.client.post(self.analyze_url, {'upload_id': upload_id}, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("malformed", str(res.data).lower())

        failed_record = RoomPhotoAnalysis.objects.filter(photo_upload_id=upload_id).first()
        self.assertIsNotNone(failed_record)
        self.assertEqual(failed_record.status, 'failed')

    def test_room_vision_analysis_does_not_mutate_saved_3d_scene_or_room(self):
        upload_id = self.upload_test_photo(self.token_a, "preserve_scene.jpg", room_id=self.room_a.id)

        initial_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.5, 'length': 4.2, 'height': 2.8},
            'objects': [
                {
                    'id': 'preserved-item-1',
                    'assetId': 'sofa-modern-3seater',
                    'position': [0.0, 0.44, 0.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                }
            ]
        }
        design = Design.objects.create(
            owner=self.user_a,
            room=self.room_a,
            title="Untouched Design",
            scene_json=initial_scene
        )

        initial_room_width = self.room_a.width
        initial_room_length = self.room_a.length

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        res = self.client.post(self.analyze_url, {
            'upload_id': upload_id,
            'room_id': str(self.room_a.id),
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Assert Design scene_json is completely unmutated
        design.refresh_from_db()
        self.assertEqual(design.scene_json, initial_scene)

        # Assert Room dimensions are completely unmutated
        self.room_a.refresh_from_db()
        self.assertEqual(self.room_a.width, initial_room_width)
        self.assertEqual(self.room_a.length, initial_room_length)

    def test_room_vision_analysis_list_and_detail_views(self):
        upload_id = self.upload_test_photo(self.token_a, "audit_test.jpg", room_id=self.room_a.id)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')

        post_res = self.client.post(self.analyze_url, {
            'upload_id': upload_id,
            'room_id': str(self.room_a.id),
        }, format='json')
        self.assertEqual(post_res.status_code, status.HTTP_200_OK)
        analysis_id = post_res.data['id']

        # 1. Detail view
        detail_res = self.client.get(reverse('rooms:room-analysis-detail', kwargs={'analysis_id': analysis_id}))
        self.assertEqual(detail_res.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_res.data['id'], analysis_id)

        # 2. List view
        list_res = self.client.get(self.analyses_list_url)
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(list_res.data), 1)

        # 3. Filtered list by room_id
        list_filter_res = self.client.get(f"{self.analyses_list_url}?room_id={self.room_a.id}")
        self.assertEqual(list_filter_res.status_code, status.HTTP_200_OK)
        self.assertTrue(all(item['room_id'] == str(self.room_a.id) for item in list_filter_res.data))

    def test_gemini_fallback_preserves_safe_reason_and_audit_metadata(self):
        upload_id = self.upload_test_photo(self.token_a, "gemini_fallback.jpg")
        upload = RoomPhotoUpload.objects.get(id=upload_id)

        # 1. Fallback when API key is missing
        gemini_adapter = GeminiRoomVisionAdapter()
        with override_settings(GEMINI_API_KEY=''):
            gemini_adapter.api_key = ''
            analysis = run_room_photo_analysis(
                user=self.user_a,
                upload_id=upload_id,
                adapter=gemini_adapter
            )
            self.assertEqual(analysis.status, 'completed')
            self.assertTrue(analysis.fallback_used)
            self.assertEqual(analysis.fallback_reason, 'gemini_api_key_not_configured')
            self.assertEqual(analysis.provider, 'mock')

        # 2. Detail API returns fallback_used and fallback_reason
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        res = self.client.get(reverse('rooms:room-analysis-detail', kwargs={'analysis_id': analysis.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['fallback_used'])
        self.assertEqual(res.data['fallback_reason'], 'gemini_api_key_not_configured')

    def test_invalid_provider_mode_raises_improperly_configured(self):
        with override_settings(ROOM_VISION_PROVIDER_MODE='invalid_provider_typo'):
            with self.assertRaises(ImproperlyConfigured) as ctx:
                get_room_vision_adapter()
            self.assertIn("Unsupported ROOM_VISION_PROVIDER_MODE", str(ctx.exception))
            self.assertIn("mock", str(ctx.exception))
            self.assertIn("gemini", str(ctx.exception))

    def test_schema_validates_hex_color_strictly(self):
        from apps.rooms.serializers import ColorPaletteItemSerializer
        
        # Valid 3-char and 6-char hex
        valid_3 = ColorPaletteItemSerializer(data={'hex': '#FFF', 'name': 'White'})
        self.assertTrue(valid_3.is_valid(), valid_3.errors)
        self.assertEqual(valid_3.validated_data['hex'], '#FFF')

        valid_6 = ColorPaletteItemSerializer(data={'hex': '#334155', 'name': 'Slate'})
        self.assertTrue(valid_6.is_valid(), valid_6.errors)
        self.assertEqual(valid_6.validated_data['hex'], '#334155')

        # Invalid hex formats
        for bad_hex in ['blue', '#12', '#12345', '#GGGGGG', '334155']:
            invalid = ColorPaletteItemSerializer(data={'hex': bad_hex, 'name': 'Bad'})
            self.assertFalse(invalid.is_valid(), f"Expected {bad_hex} to fail hex validation")
            self.assertIn('hex', invalid.errors)

    def test_schema_validates_suggested_catalogue_asset_id_against_active_catalogue(self):
        from apps.rooms.serializers import DetectedFurnitureSerializer

        # Valid active catalogue item
        valid_item = DetectedFurnitureSerializer(data={
            'category': 'seating',
            'label': 'Living Sofa',
            'confidence': 0.95,
            'suggested_catalogue_asset_id': 'sofa-modern-3seater',
        })
        self.assertTrue(valid_item.is_valid(), valid_item.errors)

        # Non-existent catalogue item
        invalid_item = DetectedFurnitureSerializer(data={
            'category': 'seating',
            'label': 'Ghost Sofa',
            'confidence': 0.95,
            'suggested_catalogue_asset_id': 'non-existent-furniture-item-999',
        })
        self.assertFalse(invalid_item.is_valid())
        self.assertIn('suggested_catalogue_asset_id', invalid_item.errors)

    def test_all_authoritative_catalogue_assets_validate_successfully(self):
        from apps.rooms.serializers import DetectedFurnitureSerializer
        authoritative_ids = [
            'sofa-modern-3seater',
            'table-oak-coffee',
            'desk-workspace-study',
            'chair-accent-armchair',
            'storage-bookshelf-tall',
            'bed-queen-platform',
            'storage-wardrobe-compact',
            'table-bedside-nightstand',
            'decor-plant-floor-vase',
            'decor-divider-architectural',
        ]
        for aid in authoritative_ids:
            item = DetectedFurnitureSerializer(data={
                'category': 'seating',
                'label': f'Item {aid}',
                'confidence': 0.90,
                'suggested_catalogue_asset_id': aid,
            })
            self.assertTrue(item.is_valid(), f"Authoritative asset ID {aid} failed serializer validation: {item.errors}")

    def test_schema_validates_bounding_boxes_and_approximate_dimensions(self):
        from apps.rooms.serializers import BoundingRegionSerializer, ApproximateDimensionsSerializer, DetectedFurnitureSerializer

        # Valid bounding box
        valid_box = BoundingRegionSerializer(data={'ymin': 0.1, 'xmin': 0.2, 'ymax': 0.8, 'xmax': 0.9})
        self.assertTrue(valid_box.is_valid(), valid_box.errors)

        # Invalid bounding box: ymin >= ymax
        bad_box_y = BoundingRegionSerializer(data={'ymin': 0.8, 'xmin': 0.2, 'ymax': 0.1, 'xmax': 0.9})
        self.assertFalse(bad_box_y.is_valid())

        # Invalid bounding box: xmin >= xmax
        bad_box_x = BoundingRegionSerializer(data={'ymin': 0.1, 'xmin': 0.9, 'ymax': 0.8, 'xmax': 0.2})
        self.assertFalse(bad_box_x.is_valid())

        # Valid dimensions
        valid_dims = ApproximateDimensionsSerializer(data={'width_m': 2.1, 'length_m': 0.9, 'height_m': 0.85})
        self.assertTrue(valid_dims.is_valid(), valid_dims.errors)

        # Furniture item with bounding box and approximate dimensions
        full_item = DetectedFurnitureSerializer(data={
            'category': 'seating',
            'label': 'Sofa',
            'confidence': 0.90,
            'bounding_box': {'ymin': 0.3, 'xmin': 0.2, 'ymax': 0.8, 'xmax': 0.7},
            'approximate_dimensions_m': {'width_m': 2.0, 'length_m': 0.9, 'height_m': 0.8},
            'suggested_catalogue_asset_id': 'sofa-modern-3seater',
        })
        self.assertTrue(full_item.is_valid(), full_item.errors)


