import logging
from typing import Any, Dict, List, Optional
from django.db import transaction
from django.utils import timezone
from apps.ai_agent.feedback.feedback_models import (
    UserCandidateFeedback,
    UserPairwiseComparison,
    LearnedPreferenceAdjustment,
)
from apps.ai_agent.feedback.feedback_types import (
    CandidateFeedbackRecord,
    PairwiseComparisonRecord,
    LearnedPreferenceState,
    FeedbackType,
    ComparisonOutcome,
)
from apps.ai_agent.models import AgentRun

logger = logging.getLogger(__name__)


class FeedbackRepository:
    """
    Repository providing user-scoped persistence, transaction management,
    and history retrieval for spatial candidate feedback and pairwise comparisons.
    """

    @staticmethod
    def record_candidate_feedback(
        user: Any,
        run: AgentRun,
        candidate_id: str,
        feedback_type: str,
        structured_reasons: Optional[List[str]] = None,
        feedback_text: str = "",
        candidate_score: float = 0.0,
        candidate_label: str = "",
    ) -> CandidateFeedbackRecord:
        """
        Records an explicit user feedback event for a generated candidate.
        Ensures strict user ownership isolation.
        """
        # Validate that the run belongs to the user
        if run.session.owner_id != user.id:
            raise PermissionError("Access denied: Run does not belong to the authenticated user.")

        reasons = structured_reasons or []
        design = run.session.design

        with transaction.atomic():
            feedback_obj = UserCandidateFeedback.objects.create(
                user=user,
                design=design,
                run=run,
                candidate_id=str(candidate_id),
                feedback_type=str(feedback_type).lower(),
                structured_reasons=reasons,
                feedback_text=feedback_text.strip(),
                candidate_score=float(candidate_score),
                candidate_label=candidate_label.strip(),
            )

        return CandidateFeedbackRecord(
            id=str(feedback_obj.id),
            user_id=user.id,
            design_id=str(design.id) if design else None,
            run_id=str(run.id),
            candidate_id=feedback_obj.candidate_id,
            feedback_type=FeedbackType(feedback_obj.feedback_type) if feedback_obj.feedback_type in [t.value for t in FeedbackType] else FeedbackType.MODIFIED,
            structured_reasons=feedback_obj.structured_reasons,
            feedback_text=feedback_obj.feedback_text,
            candidate_score=feedback_obj.candidate_score,
            candidate_label=feedback_obj.candidate_label,
            created_at_iso=feedback_obj.created_at.isoformat(),
        )

    @staticmethod
    def record_pairwise_comparison(
        user: Any,
        run: AgentRun,
        candidate_a_id: str,
        candidate_b_id: str,
        outcome: str,
        structured_reasons: Optional[List[str]] = None,
        comparison_text: str = "",
    ) -> PairwiseComparisonRecord:
        """
        Records a structured pairwise comparison between candidate A and candidate B.
        """
        if run.session.owner_id != user.id:
            raise PermissionError("Access denied: Run does not belong to the authenticated user.")

        reasons = structured_reasons or []
        design = run.session.design

        with transaction.atomic():
            comp_obj = UserPairwiseComparison.objects.create(
                user=user,
                design=design,
                run=run,
                candidate_a_id=str(candidate_a_id),
                candidate_b_id=str(candidate_b_id),
                outcome=str(outcome).lower(),
                structured_reasons=reasons,
                comparison_text=comparison_text.strip(),
            )

        return PairwiseComparisonRecord(
            id=str(comp_obj.id),
            user_id=user.id,
            design_id=str(design.id) if design else None,
            run_id=str(run.id),
            candidate_a_id=comp_obj.candidate_a_id,
            candidate_b_id=comp_obj.candidate_b_id,
            outcome=ComparisonOutcome(comp_obj.outcome) if comp_obj.outcome in [o.value for o in ComparisonOutcome] else ComparisonOutcome.A_PREFERRED,
            structured_reasons=comp_obj.structured_reasons,
            comparison_text=comp_obj.comparison_text,
            created_at_iso=comp_obj.created_at.isoformat(),
        )

    @staticmethod
    def get_user_feedback_history(user: Any, limit: int = 50) -> List[CandidateFeedbackRecord]:
        """Returns the user's historical candidate feedback records in chronological order."""
        feedbacks = UserCandidateFeedback.objects.filter(user=user).order_by('-created_at')[:limit]
        return [
            CandidateFeedbackRecord(
                id=str(f.id),
                user_id=user.id,
                design_id=str(f.design_id) if f.design_id else None,
                run_id=str(f.run_id),
                candidate_id=f.candidate_id,
                feedback_type=FeedbackType(f.feedback_type) if f.feedback_type in [t.value for t in FeedbackType] else FeedbackType.MODIFIED,
                structured_reasons=f.structured_reasons,
                feedback_text=f.feedback_text,
                candidate_score=f.candidate_score,
                candidate_label=f.candidate_label,
                created_at_iso=f.created_at.isoformat(),
            )
            for f in feedbacks
        ]

    @staticmethod
    def get_user_pairwise_comparisons(user: Any, limit: int = 50) -> List[PairwiseComparisonRecord]:
        """Returns the user's pairwise comparison history."""
        comps = UserPairwiseComparison.objects.filter(user=user).order_by('-created_at')[:limit]
        return [
            PairwiseComparisonRecord(
                id=str(c.id),
                user_id=user.id,
                design_id=str(c.design_id) if c.design_id else None,
                run_id=str(c.run_id),
                candidate_a_id=c.candidate_a_id,
                candidate_b_id=c.candidate_b_id,
                outcome=ComparisonOutcome(c.outcome) if c.outcome in [o.value for o in ComparisonOutcome] else ComparisonOutcome.A_PREFERRED,
                structured_reasons=c.structured_reasons,
                comparison_text=c.comparison_text,
                created_at_iso=c.created_at.isoformat(),
            )
            for c in comps
        ]

    @staticmethod
    def get_learned_preference_state(user: Any) -> LearnedPreferenceState:
        """Retrieves or initializes the user's learned preference state."""
        obj, _ = LearnedPreferenceAdjustment.objects.get_or_create(
            user=user,
            defaults={
                'model_version': 1,
                'feedback_count': 0,
                'adjusted_weights': {},
                'confidence_scores': {},
                'explanations': {},
                'is_active': True,
            }
        )
        return LearnedPreferenceState(
            user_id=user.id,
            model_version=obj.model_version,
            feedback_count=obj.feedback_count,
            adjusted_weights=dict(obj.adjusted_weights or {}),
            confidence_scores=dict(obj.confidence_scores or {}),
            explanations=dict(obj.explanations or {}),
            is_active=obj.is_active,
            last_updated_iso=obj.updated_at.isoformat() if obj.updated_at else timezone.now().isoformat(),
        )

    @staticmethod
    def save_learned_preference_state(
        user: Any,
        adjusted_weights: Dict[str, float],
        confidence_scores: Dict[str, float],
        explanations: Dict[str, str],
        feedback_count: int,
        is_active: bool = True,
    ) -> LearnedPreferenceState:
        """Persists updated learned weights and transparency explanations."""
        with transaction.atomic():
            obj, _ = LearnedPreferenceAdjustment.objects.get_or_create(user=user)
            obj.adjusted_weights = {k: round(v, 4) for k, v in adjusted_weights.items()}
            obj.confidence_scores = {k: round(v, 4) for k, v in confidence_scores.items()}
            obj.explanations = explanations
            obj.feedback_count = feedback_count
            obj.is_active = is_active
            obj.save()

        return LearnedPreferenceState(
            user_id=user.id,
            model_version=obj.model_version,
            feedback_count=obj.feedback_count,
            adjusted_weights=obj.adjusted_weights,
            confidence_scores=obj.confidence_scores,
            explanations=obj.explanations,
            is_active=obj.is_active,
            last_updated_iso=obj.updated_at.isoformat(),
        )

    @staticmethod
    def reset_learned_preferences(user: Any) -> LearnedPreferenceState:
        """Resets all learned adjustments and clears prior feedback history back to baseline neutral state."""
        with transaction.atomic():
            UserCandidateFeedback.objects.filter(user=user).delete()
            UserPairwiseComparison.objects.filter(user=user).delete()
            obj, _ = LearnedPreferenceAdjustment.objects.get_or_create(user=user)
            obj.adjusted_weights = {}
            obj.confidence_scores = {}
            obj.explanations = {"reset": "Learned preferences were explicitly reset by the user."}
            obj.feedback_count = 0
            obj.is_active = True
            obj.save()

        return LearnedPreferenceState(
            user_id=user.id,
            model_version=obj.model_version,
            feedback_count=0,
            adjusted_weights={},
            confidence_scores={},
            explanations={"reset": "Learned preferences were explicitly reset by the user."},
            is_active=True,
            last_updated_iso=timezone.now().isoformat(),
        )
