from rest_framework import permissions, viewsets
from apps.rooms.models import Room
from apps.rooms.serializers import RoomSerializer


class RoomViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for physical rooms.
    Strictly isolated to rooms owned by the requesting authenticated user.
    """
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Room.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
