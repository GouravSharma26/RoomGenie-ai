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


class RoomPhotoAnalysis(models.Model):
    """
    Structured observations from vision analysis of an uploaded room photo.
    Records detected room type, features, furniture, colors, and layout recommendations.
    Does NOT modify the 3D scene directly—serves as editable suggestions for the user.
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='room_analyses'
    )
    photo_upload = models.ForeignKey(
        RoomPhotoUpload,
        on_delete=models.CASCADE,
        related_name='analyses',
        help_text='Reference to the uploaded room photo analyzed'
    )
    room = models.ForeignKey(
        Room,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='analyses',
        help_text='Optional room envelope linked to this analysis'
    )
    status = models.CharField(
        max_length=32,
        choices=STATUS_CHOICES,
        default='pending'
    )
    provider = models.CharField(
        max_length=64,
        default='mock',
        help_text='Vision provider adapter utilized (mock, gemini, etc.)'
    )
    model_name = models.CharField(
        max_length=64,
        default='unknown',
        help_text='Specific vision model identifier'
    )
    observations = models.JSONField(
        null=True,
        blank=True,
        help_text='Validated structured room observations and detected furniture'
    )
    error_message = models.TextField(
        null=True,
        blank=True,
        help_text='Safe error message if analysis failed'
    )
    latency_ms = models.PositiveIntegerField(
        default=0,
        help_text='Analysis latency in milliseconds'
    )
    fallback_used = models.BooleanField(
        default=False,
        help_text='Indicates if a fallback provider was used (e.g. Gemini failed and fell back to mock)'
    )
    fallback_reason = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        help_text='Safe descriptive reason for provider fallback without sensitive data'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"RoomPhotoAnalysis {self.id} [{self.status}] ({self.provider}/{self.model_name}) [{self.owner.username}]"

