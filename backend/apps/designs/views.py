from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.designs.models import Design
from apps.designs.serializers import DesignSerializer


class DesignViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for 3D room designs.
    Enforces strict user ownership: users can only list, view, update,
    or delete designs that they personally own.
    """
    serializer_class = DesignSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Design.objects.filter(owner=self.request.user)  # pyrefly: ignore[missing-attribute]

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """
        Duplicate an existing design into a new record owned by the requesting user.
        """
        design = self.get_object()  # Enforces ownership check
        new_design = Design.objects.create(  # pyrefly: ignore[missing-attribute]
            owner=request.user,
            room=design.room,
            title=f"Copy of {design.title}",
            description=design.description,
            budget=design.budget,
            style_preferences=list(design.style_preferences),
            scene_json=dict(design.scene_json),
        )
        serializer = self.get_serializer(new_design)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
