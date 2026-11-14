"""
Feedback & Refinement Orchestration Service for RoomGenie AI (Phase 7.3).
Provides a unified API for candidate feedback, pairwise comparisons,
evidence-based explanations, learned preference management, and layout refinement.
"""

import logging
from typing import Any, Dict, List, Optional
from apps.ai_agent.models import AgentRun
from apps.ai_agent.candidate_types import LayoutCandidate
from apps.ai_agent.feedback.feedback_types import (
    CandidateFeedbackRecord,
    PairwiseComparisonRecord,
    LearnedPreferenceState,
    CandidateExplanation,
    CandidateComparisonDetail,
    TypedRefinementRequest,
)
from apps.ai_agent.feedback.feedback_repository import FeedbackRepository
from apps.ai_agent.feedback.preference_learning import PreferenceLearningEngine
from apps.ai_agent.feedback.explanation_engine import ExplanationEngine
from apps.ai_agent.feedback.candidate_comparison import CandidateComparisonService
from apps.ai_agent.feedback.refinement_interpreter import RefinementInterpreter
from apps.ai_agent.feedback.refinement_runner import RefinementRunner

logger = logging.getLogger(__name__)


class FeedbackService:
    """
    Main business logic facade orchestrating all Phase 7.3 capabilities.
    """

    def __init__(
        self,
        repository: Optional[FeedbackRepository] = None,
        learning_engine: Optional[PreferenceLearningEngine] = None,
        refinement_runner: Optional[RefinementRunner] = None,
    ):
        self.repository = repository or FeedbackRepository()
        self.learning_engine = learning_engine or PreferenceLearningEngine()
        self.refinement_runner = refinement_runner or RefinementRunner()

    def submit_candidate_feedback(
        self,
        user: Any,
        run: AgentRun,
        candidate_id: str,
        feedback_type: str,
        structured_reasons: Optional[List[str]] = None,
        feedback_text: str = "",
        candidate_score: float = 0.0,
        candidate_label: str = "",
    ) -> Dict[str, Any]:
        """
        Records user candidate feedback, triggers online preference weight adjustment,
        and returns the recorded feedback along with updated learned preference state.
        """
        # 1. Record feedback in database
        feedback_record = self.repository.record_candidate_feedback(
            user=user,
            run=run,
            candidate_id=candidate_id,
            feedback_type=feedback_type,
            structured_reasons=structured_reasons,
            feedback_text=feedback_text,
            candidate_score=candidate_score,
            candidate_label=candidate_label,
        )

        # 2. Trigger bounded preference learning update
        feedback_history = self.repository.get_user_feedback_history(user)
        pairwise_history = self.repository.get_user_pairwise_comparisons(user)
        current_learned = self.repository.get_learned_preference_state(user)

        # Get explicit saved weights if user has them
        explicit_weights = None
        if hasattr(user, 'design_preferences') and user.design_preferences:
            explicit_weights = user.design_preferences.preference_weights

        updated_weights, confidence, explanations, total_events = self.learning_engine.compute_updated_weights(
            current_state=current_learned,
            feedback_history=feedback_history,
            pairwise_history=pairwise_history,
            explicit_saved_weights=explicit_weights,
        )

        learned_state = self.repository.save_learned_preference_state(
            user=user,
            adjusted_weights=updated_weights,
            confidence_scores=confidence,
            explanations=explanations,
            feedback_count=total_events,
            is_active=True,
        )

        return {
            'feedback': feedback_record.to_dict(),
            'learned_preferences': learned_state.to_dict(),
        }

    def submit_pairwise_comparison(
        self,
        user: Any,
        run: AgentRun,
        candidate_a_id: str,
        candidate_b_id: str,
        outcome: str,
        structured_reasons: Optional[List[str]] = None,
        comparison_text: str = "",
    ) -> Dict[str, Any]:
        """
        Records structured comparison between candidate A and candidate B,
        updating learned preference weights accordingly.
        """
        comparison_record = self.repository.record_pairwise_comparison(
            user=user,
            run=run,
            candidate_a_id=candidate_a_id,
            candidate_b_id=candidate_b_id,
            outcome=outcome,
            structured_reasons=structured_reasons,
            comparison_text=comparison_text,
        )

        feedback_history = self.repository.get_user_feedback_history(user)
        pairwise_history = self.repository.get_user_pairwise_comparisons(user)
        current_learned = self.repository.get_learned_preference_state(user)

        explicit_weights = None
        if hasattr(user, 'design_preferences') and user.design_preferences:
            explicit_weights = user.design_preferences.preference_weights

        updated_weights, confidence, explanations, total_events = self.learning_engine.compute_updated_weights(
            current_state=current_learned,
            feedback_history=feedback_history,
            pairwise_history=pairwise_history,
            explicit_saved_weights=explicit_weights,
        )

        learned_state = self.repository.save_learned_preference_state(
            user=user,
            adjusted_weights=updated_weights,
            confidence_scores=confidence,
            explanations=explanations,
            feedback_count=total_events,
            is_active=True,
        )

        return {
            'comparison': comparison_record.to_dict(),
            'learned_preferences': learned_state.to_dict(),
        }

    def get_candidate_explanation(
        self,
        candidate: LayoutCandidate,
        rank: int,
        total_candidates: int,
        initial_scene: Optional[Dict[str, Any]] = None,
        preferences: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Generates evidence-backed explanation for a candidate."""
        explanation = ExplanationEngine.explain_candidate(
            candidate=candidate,
            rank=rank,
            total_candidates=total_candidates,
            initial_scene=initial_scene,
            preferences=preferences,
        )
        return explanation.to_dict()

    def compare_candidates(
        self,
        candidate_a: LayoutCandidate,
        candidate_b: LayoutCandidate,
    ) -> Dict[str, Any]:
        """Performs deep pairwise comparison of candidate features and metrics."""
        detail = CandidateComparisonService.compare_candidates(candidate_a, candidate_b)
        return detail.to_dict()

    def get_user_learned_preferences(self, user: Any) -> Dict[str, Any]:
        """Returns the user's active learned preference state."""
        state = self.repository.get_learned_preference_state(user)
        return state.to_dict()

    def reset_user_learned_preferences(self, user: Any) -> Dict[str, Any]:
        """Resets the user's learned preference adjustments back to baseline."""
        state = self.repository.reset_learned_preferences(user)
        return state.to_dict()

    def delete_user_feedback_history(self, user: Any) -> Dict[str, Any]:
        """Permanently deletes historical feedback and pairwise comparisons strictly for the user."""
        return self.repository.delete_user_feedback_history(user)

    def interpret_refinement_instruction(
        self,
        instruction: str,
        current_scene: Dict[str, Any],
    ) -> TypedRefinementRequest:
        """Interprets a natural-language refinement instruction into typed parameters."""
        return RefinementInterpreter.interpret_refinement(instruction, current_scene)

    def execute_refinement(
        self,
        base_candidate: LayoutCandidate,
        refinement_request: TypedRefinementRequest,
        preferences: Optional[Any] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        user_requirements: Optional[Dict[str, Any]] = None,
        max_budget_paise: Optional[int] = None,
    ) -> List[LayoutCandidate]:
        """Executes bounded layout refinement on a selected base candidate."""
        return self.refinement_runner.run_refinement(
            base_candidate=base_candidate,
            refinement_request=refinement_request,
            preferences=preferences,
            spatial_context=spatial_context,
            user_requirements=user_requirements,
            max_budget_paise=max_budget_paise,
        )

