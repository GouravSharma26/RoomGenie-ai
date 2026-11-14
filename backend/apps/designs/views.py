from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.designs.models import Design
from apps.designs.serializers import DesignSerializer
from apps.ai_agent.observability import OperationalLogger


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

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # Optimistic concurrency check if expected_updated_at is provided
        expected_updated_at = request.data.get('expected_updated_at')
        if expected_updated_at and instance.updated_at:
            from django.utils.dateparse import parse_datetime
            from django.utils import timezone
            parsed = parse_datetime(expected_updated_at)
            if parsed:
                if timezone.is_aware(instance.updated_at) and timezone.is_naive(parsed):
                    parsed = timezone.make_aware(parsed)
                elif timezone.is_naive(instance.updated_at) and timezone.is_aware(parsed):
                    parsed = timezone.make_naive(parsed)
                time_diff = abs((instance.updated_at - parsed).total_seconds())
                if time_diff > 0.001:
                    OperationalLogger.log_persistence_failure(
                        design_id=instance.id,
                        error_code='ERR_STALE_CONCURRENCY',
                        error_reason=f'Concurrent update mismatch: diff={time_diff:.3f}s'
                    )
                    return Response(
                        {
                            "detail": "Design has been modified concurrently by another session. Please reload.",
                            "code": "stale_concurrency",
                            "current_updated_at": instance.updated_at.isoformat(),
                        },
                        status=status.HTTP_409_CONFLICT
                    )

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

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
