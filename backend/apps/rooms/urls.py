from django.urls import path
from rest_framework.routers import DefaultRouter
from apps.rooms.views import RoomViewSet, RoomPhotoUploadView

app_name = 'rooms'

router = DefaultRouter()
router.register('', RoomViewSet, basename='room')

urlpatterns = [
    path('upload-photo/', RoomPhotoUploadView.as_view(), name='room-photo-upload'),
] + router.urls
