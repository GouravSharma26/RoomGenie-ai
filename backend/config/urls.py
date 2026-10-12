"""
URL configuration for RoomGenie AI backend.
"""
from django.contrib import admin
from django.urls import include, path
from config.views import health_check

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/health/', health_check, name='health-check'),
    path('api/v1/auth/', include('apps.accounts.urls', namespace='accounts')),
    path('api/v1/rooms/', include('apps.rooms.urls', namespace='rooms')),
    path('api/v1/furniture/', include('apps.furniture.urls', namespace='furniture')),
    path('api/v1/designs/', include('apps.designs.urls', namespace='designs')),
]
