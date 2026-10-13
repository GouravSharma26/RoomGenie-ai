import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models


class Room(models.Model):
    """
    Physical room envelope owned by a user.
    Dimensions stored authoritatively in metres (m).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='rooms'
    )
    name = models.CharField(max_length=120, default='My Room')
    width = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('5.00'),
        help_text='Room width along X axis in metres'
    )
    length = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('4.00'),
        help_text='Room length along Z axis in metres'
    )
    height = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('2.80'),
        help_text='Room ceiling height along Y axis in metres'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.name} ({self.width}m x {self.length}m x {self.height}m) [{self.owner.username}]"


class RoomPhotoUpload(models.Model):
    """
    Ephemeral or attached room photo upload metadata.
    Private room photos are never publicly exposed or retained indefinitely.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='room_photo_uploads'
    )
    room = models.ForeignKey(
        Room,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='photo_uploads'
    )
    file_path = models.CharField(
        max_length=512,
        help_text='Filesystem path to the stored room photo'
    )
    original_filename = models.CharField(
        max_length=255,
        help_text='Sanitized original client filename'
    )
    file_size_bytes = models.PositiveIntegerField(
        help_text='File size in bytes'
    )
    content_type = models.CharField(
        max_length=64,
        help_text='Verified MIME content type'
    )
    image_format = models.CharField(
        max_length=16,
        help_text='Verified image encoding format (JPEG, PNG, WEBP)'
    )
    width = models.PositiveIntegerField(
        help_text='Pixel width'
    )
    height = models.PositiveIntegerField(
        help_text='Pixel height'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(
        help_text='Expiration time after which the ephemeral file is purged'
    )
    is_deleted = models.BooleanField(
        default=False,
        help_text='Flag indicating whether the file has been cleaned up from disk'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"RoomPhotoUpload {self.id} ({self.image_format} {self.width}x{self.height}) [{self.owner.username}]"
