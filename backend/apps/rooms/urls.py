from django.urls import path
from rest_framework.routers import DefaultRouter
from apps.rooms.views import (
    RoomViewSet,
    RoomPhotoUploadView,
    RoomPhotoAnalysisView,
    RoomPhotoAnalysisListView,
    RoomPhotoAnalysisDetailView,
)

app_name = 'rooms'

router = DefaultRouter()
router.register('', RoomViewSet, basename='room')

urlpatterns = [
    path('upload-photo/', RoomPhotoUploadView.as_view(), name='room-photo-upload'),
    path('analyze-photo/', RoomPhotoAnalysisView.as_view(), name='room-photo-analyze'),
    path('analyses/', RoomPhotoAnalysisListView.as_view(), name='room-analysis-list'),
    path('analyses/<uuid:analysis_id>/', RoomPhotoAnalysisDetailView.as_view(), name='room-analysis-detail'),
] + router.urls

