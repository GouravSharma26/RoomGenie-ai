from django.urls import path
from apps.accounts import views

app_name = 'accounts'

urlpatterns = [
    path('register/', views.register_user, name='register'),
    path('login/', views.login_user, name='login'),
    path('me/', views.current_user, name='me'),
    path('demo/', views.demo_auth, name='demo'),
]
