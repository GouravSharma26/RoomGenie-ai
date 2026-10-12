from rest_framework.routers import DefaultRouter
from apps.designs.views import DesignViewSet

app_name = 'designs'

router = DefaultRouter()
router.register('', DesignViewSet, basename='design')

urlpatterns = router.urls
