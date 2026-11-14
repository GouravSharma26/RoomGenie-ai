from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.ai_agent.views import (
    AgentSessionViewSet,
    AgentPromptView,
    AgentApplyRunView,
    AgentRejectRunView,
    UserDesignPreferenceView,
    CandidateFeedbackView,
    PairwiseComparisonView,
    LearnedPreferencesView,
    ResetLearnedPreferencesView,
    CandidateExplainView,
    CandidateCompareDetailedView,
    CandidateRefineView,
)

router = DefaultRouter()
router.register(r'sessions', AgentSessionViewSet, basename='agent-session')

urlpatterns = [
    path('preferences/', UserDesignPreferenceView.as_view(), name='agent-preferences'),
    path('sessions/<uuid:session_id>/prompt/', AgentPromptView.as_view(), name='agent-prompt'),
    path('runs/<uuid:run_id>/apply/', AgentApplyRunView.as_view(), name='agent-run-apply'),
    path('runs/<uuid:run_id>/reject/', AgentRejectRunView.as_view(), name='agent-run-reject'),
    # Phase 7.3: Feedback, Explanation, Comparison & Refinement
    path('feedback/', CandidateFeedbackView.as_view(), name='agent-feedback'),
    path('feedback/compare/', PairwiseComparisonView.as_view(), name='agent-feedback-compare'),
    path('feedback/learned-preferences/', LearnedPreferencesView.as_view(), name='agent-learned-preferences'),
    path('feedback/learned-preferences/reset/', ResetLearnedPreferencesView.as_view(), name='agent-learned-preferences-reset'),
    path('runs/<uuid:run_id>/candidates/<str:candidate_id>/explain/', CandidateExplainView.as_view(), name='agent-candidate-explain'),
    path('runs/<uuid:run_id>/candidates/compare-detailed/', CandidateCompareDetailedView.as_view(), name='agent-candidates-compare-detailed'),
    path('runs/<uuid:run_id>/candidates/<str:candidate_id>/refine/', CandidateRefineView.as_view(), name='agent-candidate-refine'),
    path('', include(router.urls)),
]
