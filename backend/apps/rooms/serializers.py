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
