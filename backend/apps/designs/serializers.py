from rest_framework import serializers
from apps.designs.models import Design
from apps.designs.validators import validate_canonical_scene
from apps.rooms.models import Room


class DesignSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    room_id = serializers.PrimaryKeyRelatedField(
        queryset=Room.objects.all(),  # pyrefly: ignore[missing-attribute]
        source='room',
        required=False,
        allow_null=True
    )
    object_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Design
        fields = [
            'id',
            'owner_username',
            'room_id',
            'title',
            'description',
            'budget',
            'style_preferences',
            'scene_json',
            'object_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'owner_username', 'object_count', 'created_at', 'updated_at']

    def validate_room_id(self, value):
        """Ensure the user cannot associate their design with another user's private room."""
        if value is not None:
            user = self.context['request'].user
            if value.owner != user:
                raise serializers.ValidationError("Cannot reference a room belonging to another user.")
        return value

    def validate_scene_json(self, value):
        """Authoritatively validate canonical scene payload structure and transforms."""
        return validate_canonical_scene(value)

    def create(self, validated_data):
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)
