import logging
import os
import re
import uuid
import warnings
from datetime import timedelta
from pathlib import Path
from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from apps.rooms.models import RoomPhotoUpload

logger = logging.getLogger(__name__)

# Mapping of PIL format strings to standardized MIME types and file extensions
FORMAT_DETAILS = {
    'JPEG': {'mime': 'image/jpeg', 'ext': 'jpg'},
    'PNG': {'mime': 'image/png', 'ext': 'png'},
    'WEBP': {'mime': 'image/webp', 'ext': 'webp'},
}


def _check_magic_bytes(header: bytes) -> str | None:
    """
    Examines the initial file binary header to detect format without relying on extension.
    """
    if len(header) < 12:
        return None
    if header.startswith(b'\xff\xd8\xff'):
        return 'JPEG'
    if header.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'PNG'
    if header.startswith(b'RIFF') and header[8:12] == b'WEBP':
        return 'WEBP'
    return None


def sanitize_filename(name: str) -> str:
    """
    Strips directory traversals and unsafe characters from client-provided filename.
    """
    cleaned = Path(name).name
    # Keep only alphanumeric, hyphens, underscores, dots
    cleaned = re.sub(r'[^a-zA-Z0-9_.-]', '_', cleaned)
    return cleaned[:100] or 'photo.jpg'


def validate_room_photo_file(uploaded_file) -> dict:
    """
    Validates file size, real binary content, image integrity, dimensions, and total pixels.
    Enforces strict decompression bomb protection by treating Pillow warnings and errors as rejections.
    Returns extracted metadata dict if valid, or raises rest_framework serializers.ValidationError.
    """
    # 1. Enforce max file size
    max_size = getattr(settings, 'ROOM_PHOTO_MAX_UPLOAD_SIZE', 10 * 1024 * 1024)
    file_size = uploaded_file.size
    if file_size <= 0:
        raise serializers.ValidationError("Uploaded file is empty.")
    if file_size > max_size:
        max_mb = max_size / (1024 * 1024)
        raise serializers.ValidationError(
            f"File size exceeds maximum allowed limit of {max_mb:.1f} MB (received {file_size / (1024 * 1024):.2f} MB)."
        )

    # 2. Check binary magic bytes
    initial_pos = uploaded_file.tell() if hasattr(uploaded_file, 'tell') else 0
    header_bytes = uploaded_file.read(16)
    detected_magic = _check_magic_bytes(header_bytes)
    uploaded_file.seek(initial_pos)

    if not detected_magic:
        raise serializers.ValidationError(
            "Unsupported or unrecognized file format. Only JPEG, PNG, and WebP images are allowed."
        )

    # 3. Dynamic total pixel and decompression bomb threshold configuration
    max_pixels = getattr(settings, 'ROOM_PHOTO_MAX_PIXELS', 25_000_000)
    Image.MAX_IMAGE_PIXELS = max_pixels

    # 4. Verify image integrity with Pillow with strict DecompressionBombWarning escalation
    with warnings.catch_warnings():
        warnings.filterwarnings("error", category=Image.DecompressionBombWarning)
        try:
            uploaded_file.seek(0)
            img = Image.open(uploaded_file)
            # verify() checks file integrity without decoding full raster data into memory
            img.verify()
        except Image.DecompressionBombWarning as exc:
            raise serializers.ValidationError(
                f"Image rejected: potential decompression bomb detected. Total pixel count exceeds safe threshold: {exc}"
            )
        except Image.DecompressionBombError as exc:
            raise serializers.ValidationError(
                f"Image rejected: decompression bomb error. Image exceeds maximum safe pixel limit: {exc}"
            )
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
            raise serializers.ValidationError(f"Malformed or corrupted image content: {str(exc)}")

    # 5. Reopen stream to read dimensions and verified format under decompression bomb watch
    with warnings.catch_warnings():
        warnings.filterwarnings("error", category=Image.DecompressionBombWarning)
        try:
            uploaded_file.seek(0)
            img = Image.open(uploaded_file)
            img_format = (img.format or '').upper()
            width, height = img.size
        except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
            raise serializers.ValidationError(
                f"Image rejected: total pixel count exceeds maximum safe limit: {exc}"
            )
        except Exception as exc:
            raise serializers.ValidationError(f"Unable to parse image properties: {str(exc)}")
        finally:
            uploaded_file.seek(0)

    # 6. Enforce allowed formats
    allowed_formats = getattr(settings, 'ROOM_PHOTO_ALLOWED_FORMATS', ('JPEG', 'PNG', 'WEBP'))
    if img_format not in allowed_formats:
        raise serializers.ValidationError(
            f"Image format '{img_format}' is not permitted. Allowed formats: {list(allowed_formats)}."
        )

    # 7. Enforce dimension limits (width, height, and total pixel count)
    min_dim = getattr(settings, 'ROOM_PHOTO_MIN_DIMENSION', 100)
    max_dim = getattr(settings, 'ROOM_PHOTO_MAX_DIMENSION', 8192)

    if width < min_dim or height < min_dim:
        raise serializers.ValidationError(
            f"Image dimensions ({width}x{height}px) are below the minimum required resolution of {min_dim}x{min_dim}px."
        )
    if width > max_dim or height > max_dim:
        raise serializers.ValidationError(
            f"Image dimensions ({width}x{height}px) exceed the maximum allowed resolution of {max_dim}x{max_dim}px."
        )

    total_pixels = width * height
    if total_pixels > max_pixels:
        raise serializers.ValidationError(
            f"Total image pixel count ({width}x{height} = {total_pixels:,} pixels) exceeds the maximum allowed limit of {max_pixels:,} pixels."
        )

    format_info = FORMAT_DETAILS.get(img_format, {'mime': 'image/jpeg', 'ext': 'jpg'})

    return {
        'format': img_format,
        'content_type': format_info['mime'],
        'extension': format_info['ext'],
        'width': width,
        'height': height,
        'total_pixels': total_pixels,
        'file_size': file_size,
    }


def save_temporary_room_photo(user, uploaded_file, room=None) -> RoomPhotoUpload:
    """
    Validates and stores the uploaded room photo in a secure, user-isolated ephemeral folder.
    Guarantees no orphaned files on disk if writing to disk or database creation fails.
    Creates a RoomPhotoUpload record with expiration timestamp for automatic cleanup.
    """
    metadata = validate_room_photo_file(uploaded_file)
    safe_name = sanitize_filename(getattr(uploaded_file, 'name', 'photo.jpg'))

    upload_id = uuid.uuid4()
    storage_filename = f"{upload_id.hex}.{metadata['extension']}"

    # Isolated ephemeral directory per user
    media_root = Path(getattr(settings, 'MEDIA_ROOT', os.path.join(settings.BASE_DIR, 'media')))
    upload_dir = media_root / 'temp_room_photos' / str(user.id)
    upload_dir.mkdir(parents=True, exist_ok=True)

    dest_path = upload_dir / storage_filename

    expiry_seconds = getattr(settings, 'ROOM_PHOTO_EXPIRY_SECONDS', 3600)
    expires_at = timezone.now() + timedelta(seconds=expiry_seconds)

    file_created = False
    try:
        # Write file in chunks to prevent large memory spikes
        uploaded_file.seek(0)
        with open(dest_path, 'wb') as dest_file:
            for chunk in uploaded_file.chunks():
                dest_file.write(chunk)
        file_created = True

        # Atomically persist database record
        with transaction.atomic():
            record = RoomPhotoUpload.objects.create(
                id=upload_id,
                owner=user,
                room=room,
                file_path=str(dest_path),
                original_filename=safe_name,
                file_size_bytes=metadata['file_size'],
                content_type=metadata['content_type'],
                image_format=metadata['format'],
                width=metadata['width'],
                height=metadata['height'],
                expires_at=expires_at,
                is_deleted=False,
            )
            return record
    except Exception:
        # Guarantee no orphaned file remains on disk if disk writing or DB transaction fails
        if file_created or dest_path.exists():
            try:
                if dest_path.is_file():
                    dest_path.unlink()
            except OSError as cleanup_err:
                logger.warning(f"Failed to remove orphaned file {dest_path} during rollback: {cleanup_err}")
        raise


def cleanup_expired_room_photos(max_age_seconds: int | None = None, dry_run: bool = False) -> dict:
    """
    Purges expired temporary room photos from disk and marks database records as deleted.
    Handles individual disk deletion or database update failures safely without aborting the batch.
    Returns summary statistics: {'total_scanned': int, 'purged_count': int, 'missing_count': int, 'failed_count': int}
    """
    now = timezone.now()
    if max_age_seconds is not None:
        cutoff = now - timedelta(seconds=max_age_seconds)
        expired_qs = RoomPhotoUpload.objects.filter(created_at__lt=cutoff, is_deleted=False)
    else:
        expired_qs = RoomPhotoUpload.objects.filter(expires_at__lt=now, is_deleted=False)

    total_scanned = 0
    purged_count = 0
    missing_count = 0
    failed_count = 0

    for upload in expired_qs:
        total_scanned += 1
        p = Path(upload.file_path)

        if p.exists() and p.is_file():
            if dry_run:
                purged_count += 1
                continue

            try:
                p.unlink()
            except OSError as exc:
                logger.warning(f"Failed to delete expired room photo {p}: {exc}")
                failed_count += 1
                # Do NOT mark as deleted so future cleanup runs can retry
                continue

            try:
                upload.is_deleted = True
                upload.save(update_fields=['is_deleted'])
                purged_count += 1
            except Exception as exc:
                logger.error(f"Failed to update database record for photo {upload.id}: {exc}")
                failed_count += 1
        else:
            # File is already missing from disk (e.g. manually purged)
            missing_count += 1
            if not dry_run:
                try:
                    upload.is_deleted = True
                    upload.save(update_fields=['is_deleted'])
                except Exception as exc:
                    logger.error(f"Failed to update database record for missing photo {upload.id}: {exc}")
                    failed_count += 1

    return {
        'total_scanned': total_scanned,
        'purged_count': purged_count,
        'missing_count': missing_count,
        'failed_count': failed_count,
    }
