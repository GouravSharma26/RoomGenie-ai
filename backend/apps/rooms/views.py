from django.conf import settings
from rest_framework import permissions, status, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.rooms.models import Room, RoomPhotoUpload
from apps.rooms.serializers import (
    RoomSerializer,
    RoomPhotoUploadSerializer,
    RoomPhotoUploadResponseSerializer,
)
from apps.rooms.services import save_temporary_room_photo


class RoomViewSet(viewsets.ModelViewSet):
    """
    CRUD ViewSet for physical rooms.
    Strictly isolated to rooms owned by the requesting authenticated user.
    """
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Room.objects.filter(owner=self.request.user)  # pyrefly: ignore[missing-attribute]

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class RoomPhotoUploadView(APIView):
    """
    POST /api/v1/rooms/upload-photo/
    Secure endpoint for uploading a room photo for vision analysis.
    - Early rejection of oversized request payloads before reading/parsing multipart stream.
    - Validates file content, real binary format (JPEG, PNG, WebP), dimensions, pixel counts, and size.
    - Enforces user authentication and ownership of any linked room.
    - Stores the file in an ephemeral, user-isolated directory with an expiration TTL.
    - Returns structured metadata for the subsequent room-analysis stage.
    """
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        # 1. Early request body size enforcement before parsing or consuming excessive resources
        content_length_header = request.META.get('CONTENT_LENGTH')
        if content_length_header:
            try:
                content_length = int(content_length_header)
                max_upload_size = getattr(settings, 'ROOM_PHOTO_MAX_UPLOAD_SIZE', 10 * 1024 * 1024)
                # Allow a small 64KB overhead for multipart form boundaries, headers, and auxiliary fields
                max_allowed_body = max_upload_size + 65536
                if content_length > max_allowed_body:
                    max_mb = max_upload_size / (1024 * 1024)
                    return Response(
                        {
                            "detail": f"Request body ({content_length / (1024 * 1024):.1f} MB) exceeds maximum allowed size of {max_mb:.1f} MB.",
                            "code": "request_entity_too_large",
                        },
                        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    )
            except (ValueError, TypeError):
                pass

        serializer = RoomPhotoUploadSerializer(
            data=request.data,
            context={'request': request}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        uploaded_file = serializer.validated_data['photo']
        room_id = serializer.validated_data.get('room_id')

        room = None
        if room_id:
            room = Room.objects.filter(id=room_id, owner=request.user).first()  # pyrefly: ignore[missing-attribute]

        upload_record = save_temporary_room_photo(
            user=request.user,
            uploaded_file=uploaded_file,
            room=room,
        )

        response_data = {
            'upload_id': upload_record.id,
            'status': 'uploaded',
            'file_name': upload_record.original_filename,
            'content_type': upload_record.content_type,
            'format': upload_record.image_format,
            'size_bytes': upload_record.file_size_bytes,
            'width': upload_record.width,
            'height': upload_record.height,
            'room_id': room.id if room else None,
            'uploaded_at': upload_record.created_at,
            'expires_at': upload_record.expires_at,
            'message': 'Room photo successfully uploaded and verified for analysis.',
        }

        output_serializer = RoomPhotoUploadResponseSerializer(response_data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)
