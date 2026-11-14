"""
Preference Learning Engine for RoomGenie AI (Phase 7.3).
Provides bounded, deterministic, and explainable preference weight adjustments
derived from explicit user feedback and pairwise candidate comparisons.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple
from apps.ai_agent.feedback.feedback_types import (
    FeedbackType,
    ComparisonOutcome,
    LearnedPreferenceState,
    REASON_TO_PREFERENCE_DIMENSIONS,
)

logger = logging.getLogger(__name__)

# Bounded learning parameters
MIN_WEIGHT: float = 0.30
MAX_WEIGHT: float = 2.50
NEUTRAL_WEIGHT: float = 1.0

# Documented learning rates
ETA_SELECTION: float = 0.10  # When a candidate is explicitly selected
ETA_LIKE: float = 0.06       # When a candidate is liked with reasons
ETA_DISLIKE: float = -0.04   # When a candidate is disliked
ETA_REJECT: float = -0.06    # When a candidate is explicitly rejected
ETA_PAIRWISE: float = 0.08   # When candidate A is preferred over candidate B
MAX_SINGLE_STEP_DELTA: float = 0.15  # Prevents volatile weight shock from a single event


class PreferenceLearningEngine:
    """
    Deterministic online learner that maps structured user feedback to bounded
    preference weight adjustments, maintaining full auditability and explanations.
    """

    @classmethod
    def compute_updated_weights(
        cls,
        current_state: LearnedPreferenceState,
        feedback_history: List[Any],
        pairwise_history: Optional[List[Any]] = None,
        explicit_saved_weights: Optional[Dict[str, float]] = None,
    ) -> Tuple[Dict[str, float], Dict[str, float], Dict[str, str], int]:
        """
        Recomputes learned preference weights deterministically from full user feedback history.
        Returns: (adjusted_weights, confidence_scores, explanations, total_feedback_count)
        """
        weights: Dict[str, float] = {}
        evidence_counts: Dict[str, int] = {}
        positive_counts: Dict[str, int] = {}
        negative_counts: Dict[str, int] = {}
        history_events: int = 0

        # 1. Process candidate feedback events (chronological order)
        # Note: input feedback_history is newest first, reverse to process chronologically
        events = list(reversed(feedback_history))
        for fb in events:
            history_events += 1
            fb_type = getattr(fb, 'feedback_type', None)
            if hasattr(fb_type, 'value'):
                fb_type_val = fb_type.value
            else:
                fb_type_val = str(fb_type or '').lower()

            reasons = getattr(fb, 'structured_reasons', []) or []

            # Determine base delta based on feedback type
            if fb_type_val == FeedbackType.SELECTED.value:
                base_delta = ETA_SELECTION
            elif fb_type_val == FeedbackType.LIKED.value:
                base_delta = ETA_LIKE
            elif fb_type_val == FeedbackType.DISLIKED.value:
                base_delta = ETA_DISLIKE
            elif fb_type_val == FeedbackType.REJECTED.value:
                base_delta = ETA_REJECT
            else:
                base_delta = 0.0

            # Attribute deltas to specific preference dimensions
            affected_dims: set = set()
            for r in reasons:
                dims = REASON_TO_PREFERENCE_DIMENSIONS.get(r, [])
                for d in dims:
                    affected_dims.add(d)

            # If no reasons specified, apply general layout/circulation nudge if positive
            if not affected_dims and base_delta > 0:
                affected_dims = {'layout', 'circulation'}

            for dim in affected_dims:
                current_w = weights.get(dim, NEUTRAL_WEIGHT)
                evidence_counts[dim] = evidence_counts.get(dim, 0) + 1
                if base_delta > 0:
                    positive_counts[dim] = positive_counts.get(dim, 0) + 1
                elif base_delta < 0:
                    negative_counts[dim] = negative_counts.get(dim, 0) + 1

                step = max(-MAX_SINGLE_STEP_DELTA, min(MAX_SINGLE_STEP_DELTA, base_delta))
                new_w = max(MIN_WEIGHT, min(MAX_WEIGHT, current_w + step))
                weights[dim] = new_w

        # 2. Process pairwise comparisons
        pairwise_events = list(reversed(pairwise_history or []))
        for comp in pairwise_events:
            history_events += 1
            outcome = getattr(comp, 'outcome', None)
            if hasattr(outcome, 'value'):
                outcome_val = outcome.value
            else:
                outcome_val = str(outcome or '').lower()

            reasons = getattr(comp, 'structured_reasons', []) or []
            if outcome_val == ComparisonOutcome.A_PREFERRED.value:
                pair_delta = ETA_PAIRWISE
            elif outcome_val == ComparisonOutcome.B_PREFERRED.value:
                pair_delta = -ETA_PAIRWISE
            else:
                pair_delta = 0.0

            if pair_delta != 0.0:
                for r in reasons:
                    dims = REASON_TO_PREFERENCE_DIMENSIONS.get(r, [])
                    for dim in dims:
                        current_w = weights.get(dim, NEUTRAL_WEIGHT)
                        evidence_counts[dim] = evidence_counts.get(dim, 0) + 1
                        if pair_delta > 0:
                            positive_counts[dim] = positive_counts.get(dim, 0) + 1
                        else:
                            negative_counts[dim] = negative_counts.get(dim, 0) + 1

                        step = max(-MAX_SINGLE_STEP_DELTA, min(MAX_SINGLE_STEP_DELTA, pair_delta))
                        new_w = max(MIN_WEIGHT, min(MAX_WEIGHT, current_w + step))
                        weights[dim] = new_w

        # 3. Compute confidence scores and transparency explanations
        confidence: Dict[str, float] = {}
        explanations: Dict[str, str] = {}

        for dim, w in weights.items():
            ev = evidence_counts.get(dim, 0)
            pos = positive_counts.get(dim, 0)
            neg = negative_counts.get(dim, 0)
            conf = min(1.0, ev * 0.15)
            confidence[dim] = conf

            if w > NEUTRAL_WEIGHT:
                direction = "increased"
                pct = round((w - NEUTRAL_WEIGHT) * 100, 1)
                explanations[dim] = (
                    f"{dim.capitalize()} weight {direction} by +{pct}% (to {round(w, 2)}) "
                    f"based on {pos} positive decision(s) (confidence: {round(conf, 2)})."
                )
            elif w < NEUTRAL_WEIGHT:
                direction = "decreased"
                pct = round((NEUTRAL_WEIGHT - w) * 100, 1)
                explanations[dim] = (
                    f"{dim.capitalize()} weight {direction} by -{pct}% (to {round(w, 2)}) "
                    f"based on {neg} negative signal(s) (confidence: {round(conf, 2)})."
                )
            else:
                explanations[dim] = f"{dim.capitalize()} weight remains at neutral baseline (1.0)."

        # 4. Explicit saved preferences precedence check:
        # If user explicitly configured weights, blend conservative modulation (max ±10%)
        if explicit_saved_weights:
            for dim, exp_w in explicit_saved_weights.items():
                if dim in weights:
                    # Explicit preference is authoritative; allow feedback to adjust it by at most 10%
                    mod_w = exp_w * (1.0 + (weights[dim] - 1.0) * 0.10)
                    weights[dim] = round(mod_w, 3)
                    explanations[dim] += f" Anchored by explicit user setting ({exp_w})."

        return weights, confidence, explanations, history_events

    @classmethod
    def apply_learned_weights_to_preferences(
        cls,
        base_preferences: Dict[str, Any],
        learned_state: LearnedPreferenceState,
    ) -> Dict[str, Any]:
        """
        Blends learned preference weights into active scoring preferences without
        mutating the user's permanent explicit configuration.
        """
        if not learned_state.is_active or not learned_state.adjusted_weights:
            return base_preferences

        merged = dict(base_preferences or {})
        pref_weights = dict(merged.get('preference_weights') or {})

        for dim, adj_w in learned_state.adjusted_weights.items():
            if dim not in pref_weights:
                # No explicit weight defined, apply learned weight directly
                pref_weights[dim] = round(adj_w, 3)
            else:
                # Explicit weight is authoritative: modulate by up to ±10%
                explicit_w = pref_weights[dim]
                blended = explicit_w * (1.0 + (adj_w - 1.0) * 0.10)
                pref_weights[dim] = round(blended, 3)

        merged['preference_weights'] = pref_weights
        merged['learned_adjustments_active'] = True
        merged['learned_feedback_count'] = learned_state.feedback_count
        return merged
