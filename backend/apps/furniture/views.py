import logging
import threading
from decimal import Decimal, InvalidOperation
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import FileResponse
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.furniture.models import FurnitureAsset, FurnitureReconstructionJob
from apps.furniture.serializers import (
    FurnitureAssetSerializer,
    FurnitureReconstructionJobCreateSerializer,
    FurnitureReconstructionJobProcessSerializer,
    FurnitureReconstructionJobSerializer,
)
from apps.furniture.reconstruction.services import (
    create_reconstruction_job,
    run_reconstruction_job,
    delete_reconstruction_job_file,
)
from apps.furniture.budget import calculate_scene_budget
from apps.rooms.models import RoomPhotoUpload

logger = logging.getLogger(__name__)


def _run_reconstruction_in_background(job_id_str: str) -> None:
    """Helper to execute reconstruction job in a background daemon thread."""
    def _worker():
        from django.db import connection
        try:
            connection.close()
            job = FurnitureReconstructionJob.objects.get(id=job_id_str)
            run_reconstruction_job(job)
        except Exception as exc:
            logger.error("Background reconstruction execution failed for job %s: %s", job_id_str, exc)
        finally:
            connection.close()

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


class FurnitureAssetViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Public Read-Only catalogue of architectural 3D furniture models.
    Supports comprehensive search, style tags, price ranges, and dimension compatibility filtering:
      - ?category=seating|tables|storage|beds|decor
      - ?style=modern|scandinavian|industrial|minimalist
      - ?search=sofa / ?q=sofa
      - ?max_price=20000 / ?min_price=5000 (INR)
      - ?max_width=1.5 / ?max_depth=0.8 / ?max_height=1.0 (metres)
      - ?has_price=true|false
      - ?ordering=price_asc|price_desc|name|width
    """
    serializer_class = FurnitureAssetSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        queryset = FurnitureAsset.objects.filter(is_active=True)  # pyrefly: ignore[missing-attribute]

        # 1. Category filter
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category__iexact=category)

        # 2. Style tag filter (JSONField style_tags contains tag)
        style = self.request.query_params.get('style') or self.request.query_params.get('style_tag')
        if style:
            # Matches case-insensitively inside the JSON list or string
            from django.db import connection
            if connection.vendor == 'postgresql':
                queryset = queryset.filter(
                    Q(style_tags__contains=[style.lower()]) |
                    Q(style_tags__icontains=style.lower())
                )
            else:
                queryset = queryset.filter(style_tags__icontains=style.lower())

        # 3. Text search
        search = self.request.query_params.get('search') or self.request.query_params.get('q')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |  # pyrefly: ignore[unsupported-operation]
                Q(description__icontains=search) |
                Q(category__icontains=search) |
                Q(style_tags__icontains=search)
            )

        # 4. Price filters (INR input converted to paise)
        max_price = self.request.query_params.get('max_price') or self.request.query_params.get('max_price_inr')
        if max_price:
            try:
                max_paise = int(Decimal(max_price) * Decimal(100))
                queryset = queryset.filter(price_paise__lte=max_paise)
            except (InvalidOperation, ValueError):
                pass

        min_price = self.request.query_params.get('min_price') or self.request.query_params.get('min_price_inr')
        if min_price:
            try:
                min_paise = int(Decimal(min_price) * Decimal(100))
                queryset = queryset.filter(price_paise__gte=min_paise)
            except (InvalidOperation, ValueError):
                pass

        has_price = self.request.query_params.get('has_price')
        if has_price is not None:
            if has_price.lower() in ('true', '1', 'yes'):
                queryset = queryset.filter(price_paise__isnull=False)
            elif has_price.lower() in ('false', '0', 'no'):
                queryset = queryset.filter(price_paise__isnull=True)

        # 5. Dimension compatibility filters
        max_width = self.request.query_params.get('max_width') or self.request.query_params.get('fits_width')
        if max_width:
            try:
                queryset = queryset.filter(width__lte=Decimal(max_width))
            except (InvalidOperation, ValueError):
                pass

        max_depth = self.request.query_params.get('max_depth') or self.request.query_params.get('fits_depth')
        if max_depth:
            try:
                queryset = queryset.filter(depth__lte=Decimal(max_depth))
            except (InvalidOperation, ValueError):
                pass

        max_height = self.request.query_params.get('max_height') or self.request.query_params.get('fits_height')
        if max_height:
            try:
                queryset = queryset.filter(height__lte=Decimal(max_height))
            except (InvalidOperation, ValueError):
                pass

        # 6. Ordering
        ordering = self.request.query_params.get('ordering')
        if ordering == 'price_asc':
            queryset = queryset.order_by('price_paise', 'name')
        elif ordering == 'price_desc':
            queryset = queryset.order_by('-price_paise', 'name')
        elif ordering == 'name':
            queryset = queryset.order_by('name')
        elif ordering == 'width':
            queryset = queryset.order_by('width')

        return queryset


class BudgetEstimateView(APIView):
    """
    POST /api/v1/budgets/estimate/
    Authoritative, deterministic budget calculation for 3D room scenes.
    Accepts:
      - { "scene_json": { ... } } (direct canonical scene dictionary; anonymous allowed)
      - { "design_id": "uuid" } (persisted design ID; strictly requires authentication & ownership)
      - { "items": [ { "assetId": "..." } ], "room": { ... } } (simplified array of placed assets; anonymous allowed)
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        data = request.data
        if not isinstance(data, dict):
            return Response(
                {"detail": "Request body must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST
            )

        design_title = None

        if 'design_id' in data:
            design_id = data.get('design_id')
            if not design_id or not isinstance(design_id, str):
                return Response(
                    {"detail": "'design_id' must be a non-empty string."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 1. Require authentication for all budget-estimation requests that use design_id
            if not request.user or not request.user.is_authenticated:
                return Response(
                    {"detail": "Authentication credentials were not provided."},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            # 2. Enforce strict ownership on every saved-design lookup (never retrieve another user's design)
            from apps.designs.models import Design
            design = Design.objects.filter(id=design_id, owner=request.user).first()  # pyrefly: ignore[missing-attribute]
            if not design:
                return Response(
                    {"detail": f"Design '{design_id}' not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            scene_data = design.scene_json
            design_title = design.title

        elif 'scene_json' in data:
            # 3. Preserve anonymous estimation for direct scene_json payloads (separate from saved-design flow)
            scene_json = data.get('scene_json')
            if not isinstance(scene_json, dict) or not scene_json:
                return Response(
                    {"detail": "'scene_json' must be a non-empty JSON object."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            scene_data = scene_json
            design_title = data.get('title')

        elif 'items' in data:
            # 3b. Preserve anonymous estimation for direct simplified items payloads
            items = data.get('items')
            if not isinstance(items, list):
                return Response(
                    {"detail": "'items' must be a list of placed furniture objects."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            room_payload = data.get('room')
            if room_payload is not None:
                if not isinstance(room_payload, dict):
                    return Response(
                        {"detail": "'room' must be a JSON object with 'width', 'length', and 'height'."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                scene_data = {
                    'room': room_payload,
                    'objects': items,
                }
            else:
                scene_data = {
                    'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                    'objects': items,
                }
            design_title = data.get('title')

        else:
            return Response(
                {"detail": "Must provide either 'scene_json', 'design_id', or 'items'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            estimate = calculate_scene_budget(scene_data, design_title=design_title)
            return Response(estimate, status=status.HTTP_200_OK)
        except (ValidationError, serializers.ValidationError) as exc:
            msg = exc.detail if hasattr(exc, 'detail') else (exc.messages if hasattr(exc, 'messages') else str(exc))
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response(
                {"detail": f"Failed to calculate budget: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST
            )


class FurnitureReconstructionJobViewSet(viewsets.ModelViewSet):
    """
    CRUD and actions for 3D furniture reconstruction jobs:
      - POST   /api/v1/furniture/reconstruction/jobs/         (create new job, optionally kicks off processing)
      - GET    /api/v1/furniture/reconstruction/jobs/         (list owner's jobs, filter by ?status= & ?category=)
      - GET    /api/v1/furniture/reconstruction/jobs/<id>/    (retrieve single job / status polling endpoint)
      - DELETE /api/v1/furniture/reconstruction/jobs/<id>/    (delete job and purge private model artifact)
      - POST   /api/v1/furniture/reconstruction/jobs/<id>/process/ (trigger processing of a queued job)
      - GET    /api/v1/furniture/reconstruction/jobs/<id>/model/   (stream private validated GLB binary)

    Strict Security Rules:
      - Authenticated users only (IsAuthenticated). Anonymous requests return 401.
      - Owner-scoped queries: accessing another user's job returns 404 Not Found.
      - Safe private model streaming: prevents directory traversal, checks completed status,
        and sets private no-cache headers.
    """
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_serializer_class(self):
        if self.action == 'create':
            return FurnitureReconstructionJobCreateSerializer
        return FurnitureReconstructionJobSerializer

    def get_queryset(self):
        queryset = FurnitureReconstructionJob.objects.filter(owner=self.request.user)

        # 1. Filter by status (queued, processing, completed, failed)
        job_status = self.request.query_params.get('status')
        if job_status:
            queryset = queryset.filter(status__iexact=job_status.strip())

        # 2. Filter by category
        category = self.request.query_params.get('category') or self.request.query_params.get('target_category')
        if category:
            queryset = queryset.filter(target_category__iexact=category.strip())

        return queryset

    def create(self, request, *args, **kwargs):
        serializer = FurnitureReconstructionJobCreateSerializer(
            data=request.data,
            context={'request': request}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        photo_upload_id = serializer.validated_data.get('photo_upload_id')
        photo_upload = None
        if photo_upload_id:
            photo_upload = RoomPhotoUpload.objects.filter(
                id=photo_upload_id,
                owner=request.user,
                is_deleted=False
            ).first()

        target_category = serializer.validated_data.get('target_category', 'seating')
        prompt_label = serializer.validated_data.get('prompt_label', '')
        reference_dimensions = serializer.validated_data.get('reference_dimensions')
        provider = serializer.validated_data.get('provider') or None
        auto_process = serializer.validated_data.get('auto_process', True)
        sync = serializer.validated_data.get('sync', False)

        job = create_reconstruction_job(
            user=request.user,
            photo_upload=photo_upload,
            target_category=target_category,
            prompt_label=prompt_label,
            provider=provider,
            reference_dimensions=reference_dimensions
        )

        if auto_process:
            if sync:
                job = run_reconstruction_job(job)
            else:
                _run_reconstruction_in_background(str(job.id))

        output_serializer = FurnitureReconstructionJobSerializer(
            job,
            context={'request': request}
        )
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        """Serves as the primary status polling endpoint for reconstruction jobs."""
        job = self.get_object()
        serializer = FurnitureReconstructionJobSerializer(job, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        """Deletes reconstruction job and purges associated disk artifacts."""
        job = self.get_object()
        delete_reconstruction_job_file(job)
        job.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='process', url_name='process')
    def process_job(self, request, pk=None):
        """
        Triggers execution of a queued reconstruction job.
        Accepts optional {"sync": true/false}.
        """
        job = self.get_object()
        if job.status == FurnitureReconstructionJob.STATUS_PROCESSING:
            return Response(
                {"detail": "Job is already currently processing."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if job.status == FurnitureReconstructionJob.STATUS_COMPLETED:
            return Response(
                {"detail": "Job is already completed."},
                status=status.HTTP_400_BAD_REQUEST
            )
        if job.status == FurnitureReconstructionJob.STATUS_FAILED:
            return Response(
                {"detail": "Job has already failed and cannot be re-executed. Please create a new job."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not isinstance(request.data, dict) and request.data != '' and request.data is not None:
            return Response(
                {"detail": "Request body must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = FurnitureReconstructionJobProcessSerializer(
            data=request.data if isinstance(request.data, dict) else {}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        sync = serializer.validated_data['sync']

        if sync:
            job = run_reconstruction_job(job)
        else:
            _run_reconstruction_in_background(str(job.id))

        output_serializer = FurnitureReconstructionJobSerializer(job, context={'request': request})
        return Response(output_serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='model', url_name='model')
    def stream_model(self, request, pk=None):
        """
        Private, authenticated model streaming endpoint.
        Streams validated binary GLB 3D model files with model/gltf-binary content type
        and strict private cache control headers.
        """
        job = self.get_object()
        if job.status != FurnitureReconstructionJob.STATUS_COMPLETED:
            return Response(
                {
                    "detail": f"3D model is not ready for download. Current status: '{job.status}'.",
                    "status": job.status,
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            abs_path = job.get_absolute_model_path()
        except PermissionError as p_err:
            logger.error("Path traversal attempt detected on job %s: %s", job.id, p_err)
            return Response(
                {"detail": "Security violation: model path outside allowed media storage."},
                status=status.HTTP_403_FORBIDDEN
            )

        if not abs_path or not abs_path.is_file():
            return Response(
                {"detail": "Reconstructed 3D model file not found on disk."},
                status=status.HTTP_404_NOT_FOUND
            )

        file_size = abs_path.stat().st_size
        response = FileResponse(
            open(abs_path, 'rb'),
            content_type='model/gltf-binary',
            as_attachment=False,
            filename=f"{job.id.hex}.glb"
        )
        response['Content-Length'] = str(file_size)
        response['Cache-Control'] = 'private, no-cache, no-store, must-revalidate'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

