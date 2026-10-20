import uuid
from decimal import Decimal
from pathlib import Path
from django.conf import settings
from django.db import models
from django.utils import timezone


class FurnitureAsset(models.Model):
    """
    Authoritative furniture asset metadata.
    Pricing is strictly represented in integer paise (INR minor units).
    """
    CATEGORY_CHOICES = [
        ('seating', 'Seating'),
        ('tables', 'Tables'),
        ('storage', 'Storage'),
        ('beds', 'Beds'),
        ('decor', 'Decor'),
    ]

    id = models.CharField(max_length=80, primary_key=True, help_text='Catalog asset slug/ID')
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='seating')
    style_tags = models.JSONField(default=list, blank=True)
    
    width = models.DecimalField(max_digits=5, decimal_places=2, help_text='Width in metres')
    height = models.DecimalField(max_digits=5, decimal_places=2, help_text='Height in metres')
    depth = models.DecimalField(max_digits=5, decimal_places=2, help_text='Depth in metres')

    price_paise = models.BigIntegerField(
        null=True,
        blank=True,
        default=None,
        help_text='Deterministic price in INR paise (1 INR = 100 paise). Null if unpriced/unknown.'
    )
    currency = models.CharField(max_length=10, default='INR')

    model_url = models.CharField(max_length=255, blank=True, null=True, help_text='Static or CDN model GLB URL')
    thumbnail_url = models.CharField(max_length=255, blank=True, null=True)

    license = models.CharField(max_length=100, default='CC0 1.0 Universal')
    source = models.CharField(max_length=255, default='RoomGenie Architectural Assets')
    description = models.TextField(blank=True, default='')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category', 'name']

    @property
    def price_inr(self) -> Decimal | None:
        """Helper property to calculate exact INR rupees as Decimal, or None if unpriced."""
        if self.price_paise is None:
            return None
        return Decimal(int(getattr(self, 'price_paise'))) / Decimal(100)

    @property
    def is_priced(self) -> bool:
        return self.price_paise is not None

    def __str__(self):
        if self.price_inr is not None:
            return f"{self.name} (₹{self.price_inr:,.2f}) [{self.id}]"
        return f"{self.name} (Price on request) [{self.id}]"


class FurnitureReconstructionJob(models.Model):
    """
    Asynchronous 3D reconstruction job for approximating furniture models from uploaded photos.
    Preserves audit trail, state transitions, validation status, and private storage pointers.
    Private generated GLBs are never exposed through static public URLs.
    """
    STATUS_QUEUED = 'queued'
    STATUS_PROCESSING = 'processing'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_QUEUED, 'Queued'),
        (STATUS_PROCESSING, 'Processing'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
    ]

    VALID_TRANSITIONS = {
        STATUS_QUEUED: {STATUS_PROCESSING, STATUS_FAILED},
        STATUS_PROCESSING: {STATUS_COMPLETED, STATUS_FAILED},
        STATUS_COMPLETED: set(),
        STATUS_FAILED: set(),
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='furniture_reconstruction_jobs'
    )
    photo_upload = models.ForeignKey(
        'rooms.RoomPhotoUpload',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='furniture_reconstruction_jobs',
        help_text='Optional room photo used as the source for 3D reconstruction'
    )
    target_category = models.CharField(
        max_length=50,
        choices=FurnitureAsset.CATEGORY_CHOICES,
        default='seating',
        help_text='Coarse furniture category'
    )
    prompt_label = models.CharField(
        max_length=120,
        blank=True,
        default='',
        help_text='Optional descriptive label (e.g. Scandinavian armchair)'
    )
    status = models.CharField(
        max_length=32,
        choices=STATUS_CHOICES,
        default=STATUS_QUEUED,
        help_text='Current job processing status'
    )
    provider = models.CharField(
        max_length=64,
        default='mock',
        help_text='Image-to-3D adapter used (mock, tripo, etc.)'
    )
    model_name = models.CharField(
        max_length=64,
        default='mock-image-to-3d-v1',
        help_text='Specific reconstruction model identifier'
    )
    model_file_path = models.CharField(
        max_length=512,
        blank=True,
        default='',
        help_text='Private filesystem path to the reconstructed GLB model'
    )
    file_size_bytes = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Output GLB file size in bytes'
    )
    approximate_dimensions = models.JSONField(
        default=dict,
        blank=True,
        help_text='Extracted 3D bounding dimensions: width_m, height_m, depth_m'
    )
    suggested_catalogue_fallback_id = models.CharField(
        max_length=80,
        blank=True,
        default='sofa-modern-3seater',
        help_text='Canonical FurnitureAsset ID to use if user declines or provider fails'
    )
    error_category = models.CharField(
        max_length=64,
        blank=True,
        default='',
        help_text='Failure category (e.g. validation_failed, provider_error, timeout)'
    )
    error_message = models.TextField(
        blank=True,
        default='',
        help_text='Safe error message without secrets or internal stack traces'
    )
    latency_ms = models.PositiveIntegerField(
        default=0,
        help_text='Total processing latency in milliseconds'
    )
    raw_metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text='Provider-specific audit metadata and parameters'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"ReconstructionJob {self.id} [{self.status}] ({self.target_category}) [{self.owner.username}]"

    def transition_to(
        self,
        new_status: str,
        error_category: str = '',
        error_message: str = ''
    ) -> None:
        """
        Validates and executes a state transition.
        Prevents illegal transitions (e.g., terminal to active).
        """
        allowed = self.VALID_TRANSITIONS.get(self.status, set())
        if new_status not in allowed:
            raise ValueError(
                f"Invalid reconstruction job state transition: '{self.status}' -> '{new_status}'."
            )
        self.status = new_status
        if new_status in (self.STATUS_COMPLETED, self.STATUS_FAILED):
            self.completed_at = timezone.now()
        if error_category:
            self.error_category = error_category
        if error_message:
            self.error_message = error_message
        self.save(update_fields=['status', 'completed_at', 'error_category', 'error_message', 'updated_at'])

    def get_absolute_model_path(self) -> Path | None:
        """
        Safely resolves the absolute model file path under MEDIA_ROOT,
        preventing directory traversal attacks.
        """
        if not self.model_file_path:
            return None
        media_root = Path(getattr(settings, 'MEDIA_ROOT', settings.BASE_DIR / 'media')).resolve()
        candidate = Path(self.model_file_path)
        if not candidate.is_absolute():
            candidate = (media_root / candidate).resolve()
        else:
            candidate = candidate.resolve()

        # Enforce that the path stays inside MEDIA_ROOT
        try:
            candidate.relative_to(media_root)
        except ValueError:
            raise PermissionError("Model file path traversal outside of MEDIA_ROOT detected.")
        return candidate


