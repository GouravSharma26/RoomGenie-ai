"""
Evaluation Types and Dataclasses for RoomGenie AI Spatial Evaluation (Phase 6.5).
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class EvaluationCase:
    """
    A single deterministic evaluation scenario case for spatial layout generation.
    """
    case_id: str
    name: str
    category: str  # 'living_room', 'bedroom', 'workspace', 'dining', 'polygon', 'concave', 'multi_door', 'constrained', 'socket_attachment', 'budget_capped', 'preservation', 'negative_constrained'
    description: str
    user_request: str
    room_geometry: Dict[str, Any]
    existing_objects: List[Dict[str, Any]] = field(default_factory=list)
    existing_relationships: List[Dict[str, Any]] = field(default_factory=list)
    budget_ceiling_paise: Optional[int] = None
    preservation_ids: List[str] = field(default_factory=list)
    expected_required_categories: List[str] = field(default_factory=list)
    expected_hard_valid: bool = True  # True if valid layout is achievable; False if over-constrained negative test
    min_acceptable_circulation_score: float = 60.0
    min_acceptable_clearance_score: float = 60.0


@dataclass
class CandidateEvaluationResult:
    """
    Evaluation diagnostics for a single generated candidate layout.
    """
    candidate_id: str
    label: str
    is_valid: bool
    is_approval_eligible: bool
    overall_score: float
    boundary_score: float
    collision_score: float
    circulation_score: float
    clearance_score: float
    utilization_score: float
    budget_score: float
    fatal_errors: List[str] = field(default_factory=list)
    advisory_warnings: List[str] = field(default_factory=list)
    has_boundary_breach: bool = False
    has_collision: bool = False
    has_doorway_blockage: bool = False
    has_budget_violation: bool = False
    has_invalid_relationship: bool = False
    preservation_satisfied: bool = True
    required_categories_satisfied: bool = True
    furniture_count: int = 0
    placed_asset_ids: List[str] = field(default_factory=list)
    placed_positions: List[List[float]] = field(default_factory=list)
    relationships_count: int = 0
    trade_offs: List[str] = field(default_factory=list)


@dataclass
class CaseEvaluationResult:
    """
    Evaluation result for a single scenario across its candidate set.
    """
    case_id: str
    name: str
    category: str
    expected_hard_valid: bool
    candidates_generated: int
    valid_candidates_count: int
    top_candidate_id: Optional[str]
    top_candidate_label: Optional[str]
    top_candidate_score: float
    diversity_score: float  # 0 to 100 measure of genuine candidate divergence
    passed_all_gates: bool
    gate_failures: List[str] = field(default_factory=list)
    latency_ms: float = 0.0
    simulation_ms: float = 0.0
    scoring_ms: float = 0.0
    candidates: List[CandidateEvaluationResult] = field(default_factory=list)


@dataclass
class EvaluationSummaryMetrics:
    """
    Aggregated evaluation metrics across the entire dataset.
    """
    dataset_version: str = "1.0.0"
    total_cases: int = 0
    total_candidates: int = 0
    valid_candidates: int = 0
    hard_validity_rate_pct: float = 0.0
    boundary_violation_rate_pct: float = 0.0
    collision_rate_pct: float = 0.0
    doorway_obstruction_rate_pct: float = 0.0
    invalid_relationship_rate_pct: float = 0.0
    mean_circulation_score: float = 0.0
    mean_clearance_score: float = 0.0
    mean_utilization_score: float = 0.0
    mean_overall_score: float = 0.0
    required_category_fulfillment_rate_pct: float = 0.0
    preservation_compliance_rate_pct: float = 0.0
    budget_compliance_rate_pct: float = 0.0
    mean_candidate_diversity_score: float = 0.0
    generation_success_rate_pct: float = 0.0
    simulation_success_rate_pct: float = 0.0
    mean_latency_ms: float = 0.0
    gate_pass_rate_pct: float = 0.0
    passed_gates_count: int = 0
    failed_gates_count: int = 0


@dataclass
class EvaluationRunOutput:
    """
    Complete output of an evaluation run including all cases and summary metrics.
    """
    timestamp: str
    commit_hash: str
    adapter_name: str
    summary_metrics: EvaluationSummaryMetrics
    case_results: List[CaseEvaluationResult]
    gate_details: Dict[str, Any]

