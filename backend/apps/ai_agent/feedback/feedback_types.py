"""
Typed data structures for RoomGenie AI Phase 7.3:
Explainable, Feedback-Driven Spatial Design Refinement.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class FeedbackType(str, Enum):
    SELECTED = 'selected'
    LIKED = 'liked'
    DISLIKED = 'disliked'
    REJECTED = 'rejected'
    MODIFIED = 'modified'


class ComparisonOutcome(str, Enum):
    A_PREFERRED = 'a_preferred'
    B_PREFERRED = 'b_preferred'
    BOTH_ACCEPTABLE = 'both_acceptable'
    NEITHER_ACCEPTABLE = 'neither_acceptable'


# Standard structured feedback reasons
STRUCTURED_FEEDBACK_REASONS = [
    'more_open_floor_space',
    'better_circulation',
    'better_furniture_arrangement',
    'better_functional_grouping',
    'better_storage',
    'better_workspace',
    'better_seating_arrangement',
    'better_aesthetic_preference_match',
    'preserve_existing_furniture',
    'reduce_visual_density',
    'improve_accessibility',
    'other',
]

# Mapping between feedback reasons and preference dimensions
REASON_TO_PREFERENCE_DIMENSIONS: Dict[str, List[str]] = {
    'more_open_floor_space': ['open_floor_area', 'layout', 'utilization'],
    'better_circulation': ['circulation', 'accessibility'],
    'better_furniture_arrangement': ['layout', 'zoning'],
    'better_functional_grouping': ['zoning', 'layout'],
    'better_storage': ['storage'],
    'better_workspace': ['workspace'],
    'better_seating_arrangement': ['seating'],
    'better_aesthetic_preference_match': ['style', 'colour', 'material'],
    'preserve_existing_furniture': ['preservation'],
    'reduce_visual_density': ['open_floor_area', 'utilization'],
    'improve_accessibility': ['circulation', 'accessibility'],
}


@dataclass
class CandidateFeedbackRecord:
    """Represents a validated feedback submission on a layout candidate."""
    id: str
    user_id: int
    design_id: Optional[str]
    run_id: str
    candidate_id: str
    feedback_type: FeedbackType
    structured_reasons: List[str] = field(default_factory=list)
    feedback_text: str = ""
    candidate_score: float = 0.0
    candidate_label: str = ""
    created_at_iso: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'user_id': self.user_id,
            'design_id': self.design_id,
            'run_id': self.run_id,
            'candidate_id': self.candidate_id,
            'feedback_type': self.feedback_type.value if isinstance(self.feedback_type, FeedbackType) else str(self.feedback_type),
            'structured_reasons': self.structured_reasons,
            'feedback_text': self.feedback_text,
            'candidate_score': self.candidate_score,
            'candidate_label': self.candidate_label,
            'created_at': self.created_at_iso,
        }


@dataclass
class PairwiseComparisonRecord:
    """Represents a user comparison between two layout candidates."""
    id: str
    user_id: int
    design_id: Optional[str]
    run_id: str
    candidate_a_id: str
    candidate_b_id: str
    outcome: ComparisonOutcome
    structured_reasons: List[str] = field(default_factory=list)
    comparison_text: str = ""
    created_at_iso: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'user_id': self.user_id,
            'design_id': self.design_id,
            'run_id': self.run_id,
            'candidate_a_id': self.candidate_a_id,
            'candidate_b_id': self.candidate_b_id,
            'outcome': self.outcome.value if isinstance(self.outcome, ComparisonOutcome) else str(self.outcome),
            'structured_reasons': self.structured_reasons,
            'comparison_text': self.comparison_text,
            'created_at': self.created_at_iso,
        }


@dataclass
class LearnedPreferenceState:
    """Represents the user's learned preference adjustments and confidence."""
    user_id: int
    model_version: int = 1
    feedback_count: int = 0
    adjusted_weights: Dict[str, float] = field(default_factory=dict)
    confidence_scores: Dict[str, float] = field(default_factory=dict)
    explanations: Dict[str, str] = field(default_factory=dict)
    is_active: bool = True
    last_updated_iso: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            'user_id': self.user_id,
            'model_version': self.model_version,
            'feedback_count': self.feedback_count,
            'adjusted_weights': {k: round(v, 3) for k, v in self.adjusted_weights.items()},
            'confidence_scores': {k: round(v, 3) for k, v in self.confidence_scores.items()},
            'explanations': self.explanations,
            'is_active': self.is_active,
            'last_updated': self.last_updated_iso,
        }


@dataclass
class CandidateExplanation:
    """Detailed evidence-based explanation of why a candidate was configured and scored."""
    candidate_id: str
    label: str
    rank: int
    overall_score: float
    rank_rationale: str
    key_strengths: List[str] = field(default_factory=list)
    preferences_satisfied: List[str] = field(default_factory=list)
    spatial_constraints_satisfied: List[str] = field(default_factory=list)
    preserved_elements: List[str] = field(default_factory=list)
    modifications_made: List[str] = field(default_factory=list)
    socket_relationships_summary: List[str] = field(default_factory=list)
    trade_offs: List[str] = field(default_factory=list)
    factual_metrics: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'candidate_id': self.candidate_id,
            'label': self.label,
            'rank': self.rank,
            'overall_score': round(self.overall_score, 1),
            'rank_rationale': self.rank_rationale,
            'headline': self.rank_rationale,
            'key_strengths': self.key_strengths,
            'why_recommended': self.key_strengths,
            'preferences_satisfied': self.preferences_satisfied,
            'alignment_reasons': self.preferences_satisfied,
            'spatial_constraints_satisfied': self.spatial_constraints_satisfied,
            'spatial_adjustments': self.spatial_constraints_satisfied,
            'preserved_elements': self.preserved_elements,
            'modifications_made': self.modifications_made,
            'socket_relationships_summary': self.socket_relationships_summary,
            'trade_offs': self.trade_offs,
            'factual_metrics': self.factual_metrics,
            'key_metrics': self.factual_metrics,
        }


@dataclass
class CandidateComparisonDetail:
    """Structured side-by-side comparison of candidate differences."""
    candidate_a_id: str
    candidate_b_id: str
    score_delta: float
    position_displacements: List[Dict[str, Any]] = field(default_factory=list)
    asset_differences: Dict[str, List[str]] = field(default_factory=dict)
    relationship_differences: Dict[str, List[str]] = field(default_factory=dict)
    objective_deltas: Dict[str, float] = field(default_factory=dict)
    circulation_delta: float = 0.0
    open_space_delta_sqm: float = 0.0
    key_tradeoffs: List[str] = field(default_factory=list)
    summary_verdict: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            'candidate_a_id': self.candidate_a_id,
            'candidate_b_id': self.candidate_b_id,
            'score_delta': round(self.score_delta, 1),
            'position_displacements': self.position_displacements,
            'asset_differences': self.asset_differences,
            'relationship_differences': self.relationship_differences,
            'objective_deltas': {k: round(v, 2) for k, v in self.objective_deltas.items()},
            'circulation_delta': round(self.circulation_delta, 1),
            'open_space_delta_sqm': round(self.open_space_delta_sqm, 2),
            'key_tradeoffs': self.key_tradeoffs,
            'summary_verdict': self.summary_verdict,
        }


@dataclass
class TypedRefinementRequest:
    """Interpreted, structured instruction for layout refinement."""
    raw_prompt: str
    intent_category: str  # 'move_object', 'increase_open_space', 'improve_circulation', 'rearrange_preserving', 'adjust_gap', 'symmetrical'
    target_object_ids: List[str] = field(default_factory=list)
    protected_object_ids: List[str] = field(default_factory=list)
    preferred_direction: Optional[str] = None  # 'forward', 'backward', 'left', 'right', 'toward_wall', 'away_from_door'
    displacement_meters: float = 0.30
    desired_improvement: Optional[str] = None
    allow_new_furniture: bool = False
    allow_remove_furniture: bool = False
    is_ambiguous: bool = False
    ambiguity_reason: Optional[str] = None
    confidence_score: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'raw_prompt': self.raw_prompt,
            'intent_category': self.intent_category,
            'target_object_ids': self.target_object_ids,
            'protected_object_ids': self.protected_object_ids,
            'preferred_direction': self.preferred_direction,
            'displacement_meters': round(self.displacement_meters, 3),
            'desired_improvement': self.desired_improvement,
            'allow_new_furniture': self.allow_new_furniture,
            'allow_remove_furniture': self.allow_remove_furniture,
            'is_ambiguous': self.is_ambiguous,
            'ambiguity_reason': self.ambiguity_reason,
            'confidence_score': round(self.confidence_score, 2),
        }

