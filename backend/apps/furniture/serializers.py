from rest_framework import serializers
from apps.furniture.models import FurnitureAsset


class FurnitureAssetSerializer(serializers.ModelSerializer):
    price_inr = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
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
