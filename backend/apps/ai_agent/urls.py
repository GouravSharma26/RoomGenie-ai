from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.ai_agent.views import (
    AgentSessionViewSet,
    AgentPromptView,
    AgentApplyRunView,
    AgentRejectRunView,
)

router = DefaultRouter()
router.register(r'sessions', AgentSessionViewSet, basename='agent-session')

urlpatterns = [
    path('sessions/<uuid:session_id>/prompt/', AgentPromptView.as_view(), name='agent-prompt'),
    path('runs/<uuid:run_id>/apply/', AgentApplyRunView.as_view(), name='agent-run-apply'),
    path('runs/<uuid:run_id>/reject/', AgentRejectRunView.as_view(), name='agent-run-reject'),
    path('', include(router.urls)),
]
