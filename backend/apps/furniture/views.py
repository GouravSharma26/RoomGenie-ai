from django.db.models import Q
from rest_framework import permissions, viewsets
from apps.furniture.models import FurnitureAsset
from apps.furniture.serializers import FurnitureAssetSerializer


class FurnitureAssetViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Public Read-Only catalogue of architectural 3D furniture models.
    Supports filtering by category (?category=seating) and search (?search=sofa).
    """
    serializer_class = FurnitureAssetSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        queryset = FurnitureAsset.objects.filter(is_active=True)
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)
        search = self.request.query_params.get('search') or self.request.query_params.get('q')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(description__icontains=search) |
                Q(category__icontains=search)
            )
        return queryset
