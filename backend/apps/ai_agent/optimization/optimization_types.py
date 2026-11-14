"""
Optimization Types and Data Structures for RoomGenie AI (Phase 7.2).
Provides strongly-typed dataclasses for objective vectors, Pareto fronts,
optimization candidate states, hyperparameters, and execution metrics.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ObjectiveVector:
    """
    8-dimensional normalized objective vector (each dimension 0.0 - 100.0).
    Higher is strictly better.
    """
    containment: float = 100.0     # Physical boundary containment (100 = 0 breaches)
    collision: float = 100.0       # Inter-object 3D OBB collision-freedom (100 = 0 collisions)
    circulation: float = 100.0     # Doorway landings, walkability, door-to-furniture clearance
    clearance: float = 100.0       # Human ergonomic clearances (0.60m-0.90m passages)
    accessibility: float = 100.0   # Front/access zones of seating, beds, desks unobstructed
    utilization: float = 100.0     # Balanced room utilization & open central floor space
    preferences: float = 100.0     # Explicit user preference satisfaction (Phase 7.1)
    relationships: float = 100.0   # Semantic socket attachment & zone cohesiveness

    def dominates(self, other: 'ObjectiveVector', tolerance: float = 1e-4) -> bool:
        """
        Pareto dominance: Self dominates Other iff self is >= other in ALL dimensions
        and strictly > other in at least one dimension.
        """
        self_vals = self.to_list()
        other_vals = other.to_list()
        all_ge = all(s >= o - tolerance for s, o in zip(self_vals, other_vals))
        any_gt = any(s > o + tolerance for s, o in zip(self_vals, other_vals))
        return all_ge and any_gt

    def to_list(self) -> List[float]:
        return [
            self.containment,
            self.collision,
            self.circulation,
            self.clearance,
            self.accessibility,
            self.utilization,
            self.preferences,
            self.relationships,
        ]

    def to_dict(self) -> Dict[str, float]:
        return {
            'containment': round(self.containment, 2),
            'collision': round(self.collision, 2),
            'circulation': round(self.circulation, 2),
            'clearance': round(self.clearance, 2),
            'accessibility': round(self.accessibility, 2),
            'utilization': round(self.utilization, 2),
            'preferences': round(self.preferences, 2),
            'relationships': round(self.relationships, 2),
        }

    def aggregate_score(self, weights: Optional[Dict[str, float]] = None) -> float:
        """
        Computes a scalar aggregate score using configurable or default weights.
        """
        w = weights or {
            'containment': 0.22,
            'collision': 0.22,
            'circulation': 0.16,
            'clearance': 0.12,
            'accessibility': 0.08,
            'utilization': 0.06,
            'preferences': 0.08,
            'relationships': 0.06,
        }
        total = (
            self.containment * w.get('containment', 0.22) +
            self.collision * w.get('collision', 0.22) +
            self.circulation * w.get('circulation', 0.16) +
            self.clearance * w.get('clearance', 0.12) +
            self.accessibility * w.get('accessibility', 0.08) +
            self.utilization * w.get('utilization', 0.06) +
            self.preferences * w.get('preferences', 0.08) +
            self.relationships * w.get('relationships', 0.06)
        )
        return round(total, 2)


@dataclass
class OptimizationConfig:
    """
    Hyperparameters and budgets for constraint-aware spatial optimization.
    """
    max_iterations: int = 15
    max_states_evaluated: int = 120
    time_limit_ms: int = 2500
    random_seed: int = 42
    nudge_step_meters: float = 0.12
    fine_nudge_step_meters: float = 0.04
    wall_clearance_meters: float = 0.08
    min_passable_width_meters: float = 0.60
    door_landing_depth_meters: float = 0.90
    diversity_distance_threshold: float = 12.0
    enable_repair: bool = True
    enable_group_moves: bool = True
    enable_wall_alignment: bool = True
    enable_socket_reassignment: bool = True


@dataclass
class OptimizationCandidateState:
    """
    Isolated state representing a layout candidate during optimization.
    Never mutates the canonical scene.
    """
    state_id: str
    scene: Dict[str, Any]
    proposed_actions: List[Dict[str, Any]]
    is_valid: bool = False
    is_approval_eligible: bool = False
    objectives: ObjectiveVector = field(default_factory=ObjectiveVector)
    pareto_rank: int = 0
    crowding_distance: float = 0.0
    operators_applied: List[str] = field(default_factory=list)
    iteration_discovered: int = 0
    fatal_errors: List[str] = field(default_factory=list)
    advisory_warnings: List[str] = field(default_factory=list)
    best_badge: Optional[str] = None


@dataclass
class OptimizationMetrics:
    """
    Telemetry recording performance and effectiveness of optimization run.
    """
    iterations_run: int = 0
    states_evaluated: int = 0
    duration_ms: float = 0.0
    initial_valid: bool = False
    final_valid: bool = False
    repaired_boundary_violations: int = 0
    repaired_collisions: int = 0
    initial_score: float = 0.0
    final_score: float = 0.0
    score_improvement: float = 0.0
    operators_used: Dict[str, int] = field(default_factory=dict)
    pareto_front_size: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'iterations_run': self.iterations_run,
            'states_evaluated': self.states_evaluated,
            'duration_ms': round(self.duration_ms, 2),
            'initial_valid': self.initial_valid,
            'final_valid': self.final_valid,
            'repaired_boundary_violations': self.repaired_boundary_violations,
            'repaired_collisions': self.repaired_collisions,
            'initial_score': round(self.initial_score, 2),
            'final_score': round(self.final_score, 2),
            'score_improvement': round(self.score_improvement, 2),
            'operators_used': self.operators_used,
            'pareto_front_size': self.pareto_front_size,
        }

