"""
Optimization subsystem for RoomGenie AI (Phase 7.2).
Provides constraint-aware spatial optimization, Pareto multi-objective search,
10 deterministic spatial operators, and meaningful diversity selection.
"""

from apps.ai_agent.optimization.optimization_config import (
    BADGE_BEST_CIRCULATION,
    BADGE_BEST_OPEN_SPACE,
    BADGE_BEST_OVERALL,
    BADGE_BEST_PREFERENCE_MATCH,
    DEFAULT_OPTIMIZATION_CONFIG,
    OptimizationConfig,
)
from apps.ai_agent.optimization.optimization_constraints import ConstraintEvaluator
from apps.ai_agent.optimization.optimization_diversity import DiversityEngine
from apps.ai_agent.optimization.optimization_objectives import ObjectiveEvaluator
from apps.ai_agent.optimization.optimization_operators import OptimizationOperators
from apps.ai_agent.optimization.optimization_runner import OptimizationRunner
from apps.ai_agent.optimization.optimization_search import SpatialOptimizerSearch
from apps.ai_agent.optimization.optimization_selection import ParetoSelector
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.optimization.optimization_types import (
    ObjectiveVector,
    OptimizationCandidateState,
    OptimizationMetrics,
)

__all__ = [
    'OptimizationConfig',
    'DEFAULT_OPTIMIZATION_CONFIG',
    'ObjectiveVector',
    'OptimizationCandidateState',
    'OptimizationMetrics',
    'CandidateSceneState',
    'ConstraintEvaluator',
    'OptimizationOperators',
    'ObjectiveEvaluator',
    'DiversityEngine',
    'ParetoSelector',
    'SpatialOptimizerSearch',
    'OptimizationRunner',
    'BADGE_BEST_OVERALL',
    'BADGE_BEST_CIRCULATION',
    'BADGE_BEST_OPEN_SPACE',
    'BADGE_BEST_PREFERENCE_MATCH',
]

