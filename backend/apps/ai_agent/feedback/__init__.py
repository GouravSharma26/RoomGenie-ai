"""
Feedback, Refinement & Explainability Package for RoomGenie AI (Phase 7.3).
"""

from apps.ai_agent.feedback.feedback_types import (
    FeedbackType,
    ComparisonOutcome,
    CandidateFeedbackRecord,
    PairwiseComparisonRecord,
    LearnedPreferenceState,
    CandidateExplanation,
    CandidateComparisonDetail,
    TypedRefinementRequest,
    STRUCTURED_FEEDBACK_REASONS,
    REASON_TO_PREFERENCE_DIMENSIONS,
)
from apps.ai_agent.feedback.feedback_models import (
    UserCandidateFeedback,
    UserPairwiseComparison,
    LearnedPreferenceAdjustment,
)
from apps.ai_agent.feedback.feedback_repository import FeedbackRepository
from apps.ai_agent.feedback.preference_learning import PreferenceLearningEngine
from apps.ai_agent.feedback.explanation_engine import ExplanationEngine
from apps.ai_agent.feedback.candidate_comparison import CandidateComparisonService
from apps.ai_agent.feedback.refinement_interpreter import RefinementInterpreter
from apps.ai_agent.feedback.refinement_planner import RefinementPlanner
from apps.ai_agent.feedback.refinement_runner import RefinementRunner
from apps.ai_agent.feedback.feedback_service import FeedbackService

__all__ = [
    'FeedbackType',
    'ComparisonOutcome',
    'CandidateFeedbackRecord',
    'PairwiseComparisonRecord',
    'LearnedPreferenceState',
    'CandidateExplanation',
    'CandidateComparisonDetail',
    'TypedRefinementRequest',
    'STRUCTURED_FEEDBACK_REASONS',
    'REASON_TO_PREFERENCE_DIMENSIONS',
    'UserCandidateFeedback',
    'UserPairwiseComparison',
    'LearnedPreferenceAdjustment',
    'FeedbackRepository',
    'PreferenceLearningEngine',
    'ExplanationEngine',
    'CandidateComparisonService',
    'RefinementInterpreter',
    'RefinementPlanner',
    'RefinementRunner',
    'FeedbackService',
]
