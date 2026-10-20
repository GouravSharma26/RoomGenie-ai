from rest_framework.routers import DefaultRouter
from apps.furniture.views import FurnitureAssetViewSet, FurnitureReconstructionJobViewSet

app_name = 'furniture'

router = DefaultRouter()
router.register('reconstruction/jobs', FurnitureReconstructionJobViewSet, basename='reconstruction-jobs')
router.register('', FurnitureAssetViewSet, basename='furniture')

urlpatterns = router.urls
