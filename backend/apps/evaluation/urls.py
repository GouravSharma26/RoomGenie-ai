from django.urls import path
from apps.evaluation.views import (
    AbortSessionView,
    CheckpointSessionView,
    CompleteSessionView,
    ExportDatasetView,
    SessionDetailView,
    StartSessionView,
)

app_name = 'evaluation'

urlpatterns = [
    path('sessions/start/', StartSessionView.as_view(), name='session-start'),
    path('sessions/<uuid:session_id>/checkpoint/', CheckpointSessionView.as_view(), name='session-checkpoint'),
    path('sessions/<uuid:session_id>/complete/', CompleteSessionView.as_view(), name='session-complete'),
    path('sessions/<uuid:session_id>/abort/', AbortSessionView.as_view(), name='session-abort'),
    path('sessions/<uuid:session_id>/', SessionDetailView.as_view(), name='session-detail'),
    path('export/', ExportDatasetView.as_view(), name='dataset-export'),
]
