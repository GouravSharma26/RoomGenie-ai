from decimal import Decimal, InvalidOperation
from django.core.exceptions import ValidationError
from django.db.models import Q
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.furniture.models import FurnitureAsset
from apps.furniture.serializers import FurnitureAssetSerializer
from apps.furniture.budget import calculate_scene_budget


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
            queryset = queryset.filter(
                Q(style_tags__contains=[style.lower()]) |
                Q(style_tags__icontains=style.lower())
            )

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

