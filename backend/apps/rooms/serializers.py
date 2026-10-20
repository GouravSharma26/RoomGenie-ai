from decimal import Decimal
from django.utils import timezone
from rest_framework import serializers
from apps.rooms.models import Room, RoomPhotoUpload, RoomPhotoAnalysis


class RoomSerializer(serializers.ModelSerializer):
    width = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal('2.00'), max_value=Decimal('25.00'))
    length = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal('2.00'), max_value=Decimal('25.00'))
    height = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal('2.00'), max_value=Decimal('10.00'))

    class Meta:
        model = Room
        fields = ['id', 'name', 'width', 'length', 'height', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data):
        # Automatically bind authenticated owner
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)


class RoomPhotoUploadSerializer(serializers.Serializer):
    """
    Serializer for uploading and validating room photos.
    Validates file content, format, size, dimensions, and room ownership.
    """
    photo = serializers.FileField(
        required=True,
        help_text="Room photo image file (JPEG, PNG, or WebP)."
    )
    room_id = serializers.UUIDField(
        required=False,
        default=None,
        help_text="Optional UUID of a Room owned by the requesting user."
    )

    def validate_room_id(self, value):
        if value is None:
            return value
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authentication required to link a room.")
        room = Room.objects.filter(id=value, owner=user).first()  # pyrefly: ignore[missing-attribute]
        if not room:
            raise serializers.ValidationError("Specified room does not exist or you do not have permission to access it.")
        return value

    def validate_photo(self, value):
        from apps.rooms.services import validate_room_photo_file
        # Strict binary content, integrity, format, and dimension validation
        validate_room_photo_file(value)
        return value


class RoomPhotoUploadResponseSerializer(serializers.Serializer):
    """
    Structured metadata response for uploaded room photo suitable for the next analysis stage.
    """
    upload_id = serializers.UUIDField()
    status = serializers.CharField()
    file_name = serializers.CharField()
    content_type = serializers.CharField()
    format = serializers.CharField()
    size_bytes = serializers.IntegerField()
    width = serializers.IntegerField()
    height = serializers.IntegerField()
    room_id = serializers.UUIDField(allow_null=True)
    uploaded_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    message = serializers.CharField()


# =========================================================================
# Vision Analysis Serializers
# =========================================================================

class RoomPhotoAnalysisRequestSerializer(serializers.Serializer):
    """
    Serializer for initiating room vision analysis on a previously uploaded photo.
    Enforces that upload_id is valid, owned by requesting user, not deleted, and not expired.
    """
    upload_id = serializers.UUIDField(
        required=True,
        help_text="UUID of the uploaded room photo to analyze."
    )
    room_id = serializers.UUIDField(
        required=False,
        default=None,
        allow_null=True,
        help_text="Optional UUID of an existing Room owned by the user."
    )
    room_type_hint = serializers.CharField(
        required=False,
        default='',
        allow_blank=True,
        max_length=64,
        help_text="Optional user hint regarding room purpose (e.g. 'bedroom', 'living_room')."
    )

    def validate_upload_id(self, value):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authentication required.")

        upload = RoomPhotoUpload.objects.filter(id=value, owner=user).first()  # pyrefly: ignore[missing-attribute]
        if not upload:
            raise serializers.ValidationError("Uploaded photo record not found or access denied.")

        if upload.is_deleted:
            raise serializers.ValidationError("Uploaded photo has already been cleaned up from storage.")

        if upload.expires_at < timezone.now():
            raise serializers.ValidationError("Uploaded photo has expired. Please upload a fresh room photo.")

        return value

    def validate_room_id(self, value):
        if value is None:
            return None
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authentication required.")

        room = Room.objects.filter(id=value, owner=user).first()  # pyrefly: ignore[missing-attribute]
        if not room:
            raise serializers.ValidationError("Specified room does not exist or you do not have permission to access it.")
        return value


class DetectedFurnitureSerializer(serializers.Serializer):
    category = serializers.CharField(max_length=64)
    label = serializers.CharField(max_length=120)
    estimated_spatial_zone = serializers.CharField(max_length=120, required=False, default='', allow_blank=True)
    color = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)
    material = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)
    confidence = serializers.FloatField(min_value=0.0, max_value=1.0)
    suggested_catalogue_asset_id = serializers.CharField(max_length=120, required=False, allow_null=True, allow_blank=True)


class ArchitecturalFeaturesSerializer(serializers.Serializer):
    flooring = serializers.CharField(max_length=120, required=False, allow_blank=True)
    wall_finish = serializers.CharField(max_length=120, required=False, allow_blank=True)
    lighting = serializers.CharField(max_length=120, required=False, allow_blank=True)
    windows_count = serializers.IntegerField(required=False, default=0, min_value=0)
    doors_count = serializers.IntegerField(required=False, default=0, min_value=0)


class ColorPaletteItemSerializer(serializers.Serializer):
    hex = serializers.CharField(max_length=32)
    name = serializers.CharField(max_length=64)
    role = serializers.CharField(max_length=64, required=False, allow_blank=True)


class RoomObservationsSerializer(serializers.Serializer):
    """
    Schema validation for structured room observations produced by vision adapters.
    Validates detected items, architectural features, color palette, and uncertainty notes.
    """
    room_type = serializers.CharField(max_length=64)
    estimated_room_shape = serializers.CharField(max_length=64, required=False, default='rectangular')
    overall_confidence = serializers.FloatField(min_value=0.0, max_value=1.0)
    architectural_features = ArchitecturalFeaturesSerializer(required=False)
    detected_furniture = DetectedFurnitureSerializer(many=True, required=False, default=list)
    color_palette = ColorPaletteItemSerializer(many=True, required=False, default=list)
    style_description = serializers.CharField(required=False, allow_blank=True)
    spatial_summary = serializers.CharField(required=False, allow_blank=True)
    recommendations = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    uncertainty_notes = serializers.CharField(required=False, allow_blank=True)
    requires_user_confirmation = serializers.BooleanField(default=True)


class RoomPhotoAnalysisResponseSerializer(serializers.Serializer):
    """
    Full API response representing a completed room vision analysis.
    Provides structured observations for user review without mutating any 3D scenes.
    """
    id = serializers.UUIDField()
    photo_upload_id = serializers.UUIDField()
    room_id = serializers.UUIDField(allow_null=True)
    status = serializers.CharField()
    provider = serializers.CharField()
    model_name = serializers.CharField()
    observations = RoomObservationsSerializer(allow_null=True)
    error_message = serializers.CharField(allow_null=True, required=False)
    latency_ms = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    completed_at = serializers.DateTimeField(allow_null=True)
    message = serializers.CharField(required=False)
