from django.utils import timezone
from rest_framework import serializers
from apps.furniture.models import FurnitureAsset, FurnitureReconstructionJob
from apps.furniture.reconstruction.services import (
    SUPPORTED_PROVIDER_MODES,
    validate_reference_dimensions,
)
from apps.rooms.models import RoomPhotoUpload


class FurnitureAssetSerializer(serializers.ModelSerializer):
    price_inr = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True, allow_null=True)
    is_priced = serializers.BooleanField(read_only=True)
    dimensions = serializers.SerializerMethodField()

    class Meta:
        model = FurnitureAsset
        fields = [
            'id',
            'name',
            'category',
            'style_tags',
            'width',
            'height',
            'depth',
            'dimensions',
            'price_paise',
            'price_inr',
            'is_priced',
            'currency',
            'model_url',
            'thumbnail_url',
            'license',
            'source',
            'description',
            'is_active',
            'created_at',
        ]
        read_only_fields = fields

    def get_dimensions(self, obj):
        return [float(obj.width), float(obj.height), float(obj.depth)]


class FurnitureReconstructionJobCreateSerializer(serializers.Serializer):
    """
    Validates payload for creating a new 3D furniture reconstruction job.
    Enforces user ownership on any referenced RoomPhotoUpload and validates
    bounded positive reference dimensions.
    """
    photo_upload_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    target_category = serializers.ChoiceField(
        choices=FurnitureAsset.CATEGORY_CHOICES,
        default='seating'
    )
    prompt_label = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
        default=''
    )
    reference_dimensions = serializers.DictField(
        required=False,
        allow_null=True,
        default=None
    )
    provider = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default=''
    )
    auto_process = serializers.BooleanField(required=False, default=True)
    sync = serializers.BooleanField(required=False, default=False)

    def validate_photo_upload_id(self, value):
        if value is None:
            return None
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            raise serializers.ValidationError("Authentication required to link room photo upload.")

        now = timezone.now()
        photo_upload = RoomPhotoUpload.objects.filter(
            id=value,
            owner=request.user,
            is_deleted=False,
            expires_at__gt=now
        ).first()
        if not photo_upload:
            raise serializers.ValidationError(
                "Room photo upload not found, expired, or does not belong to you."
            )
        return value

    def validate_reference_dimensions(self, value):
        if not value:
            return None
        try:
            return validate_reference_dimensions(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))

    def validate_provider(self, value):
        if not value:
            return ''
        cleaned = value.strip().lower()
        if cleaned not in SUPPORTED_PROVIDER_MODES:
            raise serializers.ValidationError(
                f"Unsupported provider mode: '{value}'. Supported modes: {sorted(SUPPORTED_PROVIDER_MODES)}."
            )
        return cleaned


class FurnitureReconstructionJobProcessSerializer(serializers.Serializer):
    """
    Validates execution options for process_job action.
    Strictly validates Boolean inputs (e.g. rejects non-booleans and parses
    'false' and '0' as False rather than truthy).
    """
    sync = serializers.BooleanField(required=False, default=True)


class FurnitureReconstructionJobSerializer(serializers.ModelSerializer):
    """
    Authoritative representation of a FurnitureReconstructionJob.
    Exposes processing status, safe error categories, approximate dimensions,
    and private model download URLs.
    """
    owner_id = serializers.IntegerField(source='owner.id', read_only=True)
    photo_upload_id = serializers.UUIDField(source='photo_upload.id', read_only=True, allow_null=True)
    model_download_url = serializers.SerializerMethodField()

    class Meta:
        model = FurnitureReconstructionJob
        fields = [
            'id',
            'owner_id',
            'photo_upload_id',
            'target_category',
            'prompt_label',
            'status',
            'provider',
            'model_name',
            'file_size_bytes',
            'approximate_dimensions',
            'suggested_catalogue_fallback_id',
            'error_category',
            'error_message',
            'latency_ms',
            'model_download_url',
            'created_at',
            'updated_at',
            'completed_at',
        ]
        read_only_fields = fields

    def get_model_download_url(self, obj) -> str | None:
        if obj.status == FurnitureReconstructionJob.STATUS_COMPLETED and obj.model_file_path:
            request = self.context.get('request')
            rel_url = f"/api/v1/furniture/reconstruction/jobs/{obj.id}/model/"
            if request:
                return request.build_absolute_uri(rel_url)
            return rel_url
        return None
