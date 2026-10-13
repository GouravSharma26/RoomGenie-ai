import os
import re
import uuid
from datetime import timedelta
from pathlib import Path
from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.utils import timezone
from rest_framework import serializers
from apps.rooms.models import RoomPhotoUpload

# Enforce strict decompression bomb protection
Image.MAX_IMAGE_PIXELS = 25_000_000

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
    Validates file size, real binary content, image integrity, and dimensions.
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

    # 3. Verify image integrity with Pillow
    try:
        uploaded_file.seek(0)
        img = Image.open(uploaded_file)
        # verify() checks file integrity without decoding full raster data into memory
        img.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise serializers.ValidationError(f"Malformed or corrupted image content: {str(exc)}")

    # 4. Reopen stream to read dimensions and verified format
    try:
        uploaded_file.seek(0)
        img = Image.open(uploaded_file)
        img_format = (img.format or '').upper()
        width, height = img.size
    except Exception as exc:
        raise serializers.ValidationError(f"Unable to parse image properties: {str(exc)}")
    finally:
        uploaded_file.seek(0)

    # 5. Enforce allowed formats
    allowed_formats = getattr(settings, 'ROOM_PHOTO_ALLOWED_FORMATS', ('JPEG', 'PNG', 'WEBP'))
    if img_format not in allowed_formats:
        raise serializers.ValidationError(
            f"Image format '{img_format}' is not permitted. Allowed formats: {list(allowed_formats)}."
        )

    # 6. Enforce dimension limits
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

    format_info = FORMAT_DETAILS.get(img_format, {'mime': 'image/jpeg', 'ext': 'jpg'})

    return {
        'format': img_format,
        'content_type': format_info['mime'],
        'extension': format_info['ext'],
        'width': width,
        'height': height,
        'file_size': file_size,
    }


def save_temporary_room_photo(user, uploaded_file, room=None) -> RoomPhotoUpload:
    """
    Validates and stores the uploaded room photo in a secure, user-isolated ephemeral folder.
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

    # Write file in chunks to prevent large memory spikes
    uploaded_file.seek(0)
    with open(dest_path, 'wb') as dest_file:
        for chunk in uploaded_file.chunks():
            dest_file.write(chunk)

    expiry_seconds = getattr(settings, 'ROOM_PHOTO_EXPIRY_SECONDS', 3600)
    expires_at = timezone.now() + timedelta(seconds=expiry_seconds)

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


def cleanup_expired_room_photos(max_age_seconds: int = None) -> int:
    """
    Purges expired temporary room photos from disk and marks/removes their records.
    Returns the count of purged files.
    """
    now = timezone.now()
    if max_age_seconds is not None:
        cutoff = now - timedelta(seconds=max_age_seconds)
        expired_qs = RoomPhotoUpload.objects.filter(created_at__lt=cutoff, is_deleted=False)
    else:
        expired_qs = RoomPhotoUpload.objects.filter(expires_at__lt=now, is_deleted=False)

    purged_count = 0
    for upload in expired_qs:
        try:
            p = Path(upload.file_path)
            if p.exists() and p.is_file():
                p.unlink()
        except OSError:
            pass
        upload.is_deleted = True
        upload.save(update_fields=['is_deleted'])
        purged_count += 1

    return purged_count
