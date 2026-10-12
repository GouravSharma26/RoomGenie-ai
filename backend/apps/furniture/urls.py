from rest_framework.routers import DefaultRouter
from apps.furniture.views import FurnitureAssetViewSet

app_name = 'furniture'

router = DefaultRouter()
router.register('', FurnitureAssetViewSet, basename='furniture')

urlpatterns = router.urls
