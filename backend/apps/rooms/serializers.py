from decimal import Decimal
from rest_framework import serializers
from apps.rooms.models import Room


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
        room = Room.objects.filter(id=value, owner=user).first()
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
