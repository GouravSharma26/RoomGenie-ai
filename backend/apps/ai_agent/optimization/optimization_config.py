"""
Optimization Configuration and Constants for RoomGenie AI (Phase 7.2).
Provides default parameter sets, operator weights, clearance thresholds,
and budget constraints.
"""

from typing import Dict
from apps.ai_agent.optimization.optimization_types import OptimizationConfig

# Default standard optimization config
DEFAULT_OPTIMIZATION_CONFIG = OptimizationConfig(
    max_iterations=15,
    max_states_evaluated=120,
    time_limit_ms=2500,
    random_seed=42,
    nudge_step_meters=0.12,
    fine_nudge_step_meters=0.04,
    wall_clearance_meters=0.08,
    min_passable_width_meters=0.60,
    door_landing_depth_meters=0.90,
    diversity_distance_threshold=12.0,
    enable_repair=True,
    enable_group_moves=True,
    enable_wall_alignment=True,
    enable_socket_reassignment=True,
)

# Operator selection probability weights (normalized during search)
OPERATOR_SELECTION_WEIGHTS: Dict[str, float] = {
    'repair_boundary': 2.5,
    'repair_collision': 2.5,
    'wall_alignment': 1.8,
    'group_translation': 1.5,
    'group_rotation': 1.2,
    'socket_reassignment': 2.0,
    'zone_relocation': 1.0,
    'perimeter_distribution': 1.2,
    'open_space_recovery': 1.4,
    'clearance_nudge': 1.6,
}

# Badges awarded to Pareto-optimal candidates
BADGE_BEST_OVERALL = "Best Overall"
BADGE_BEST_CIRCULATION = "Best Circulation"
BADGE_BEST_OPEN_SPACE = "Best Open Space"
BADGE_BEST_PREFERENCE_MATCH = "Best Preference Match"
BADGE_MAX_ACCESSIBILITY = "Maximum Accessibility"

