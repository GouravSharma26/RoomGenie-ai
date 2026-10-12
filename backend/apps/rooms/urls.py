from rest_framework.routers import DefaultRouter
from apps.rooms.views import RoomViewSet

app_name = 'rooms'

router = DefaultRouter()
router.register('', RoomViewSet, basename='room')

urlpatterns = router.urls
