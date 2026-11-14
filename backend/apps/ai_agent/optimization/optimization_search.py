"""
Constraint-Aware Spatial Search and Repair for RoomGenie AI (Phase 7.2).
Orchestrates targeted constraint repair and multi-objective local hill climbing
to optimize candidate layout quality, physical validity, and diversity.
"""

import copy
import random
import time
from typing import Any, Dict, List, Optional, Tuple
from apps.ai_agent.optimization.optimization_config import (
    DEFAULT_OPTIMIZATION_CONFIG,
    OPERATOR_SELECTION_WEIGHTS,
)
from apps.ai_agent.optimization.optimization_constraints import ConstraintEvaluator
from apps.ai_agent.optimization.optimization_objectives import ObjectiveEvaluator
from apps.ai_agent.optimization.optimization_operators import OptimizationOperators
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.optimization.optimization_types import (
    ObjectiveVector,
    OptimizationCandidateState,
    OptimizationConfig,
    OptimizationMetrics,
)


class SpatialOptimizerSearch:
    """
    Executes constraint-guided repair and multi-objective local search.
    """

    def __init__(self, config: Optional[OptimizationConfig] = None):
        self.config = config or DEFAULT_OPTIMIZATION_CONFIG

    def repair_and_optimize(
        self,
        initial_scene: Dict[str, Any],
        initial_actions: List[Dict[str, Any]],
        preferences: Optional[Any] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        budget_diff: Optional[Dict[str, Any]] = None,
        variant_seed_offset: int = 0,
        strategy_bias: Optional[str] = None,
    ) -> Tuple[OptimizationCandidateState, OptimizationMetrics]:
        """
        Executes a bounded search trajectory starting from an initial proposal.
        Returns the optimized candidate state and execution telemetry.
        """
        start_time = time.time()
        rng = random.Random(self.config.random_seed + variant_seed_offset)

        curr_state = CandidateSceneState(initial_scene, initial_actions)
        initial_eval = ConstraintEvaluator.evaluate_state(curr_state)
        initial_objectives = ObjectiveEvaluator.evaluate(
            curr_state,
            preferences=preferences,
            spatial_context=spatial_context,
            budget_diff=budget_diff,
        )

        metrics = OptimizationMetrics(
            initial_valid=initial_eval['is_valid'],
            initial_score=initial_objectives.aggregate_score(),
        )

        operators_applied: List[str] = []
        operators_used_count: Dict[str, int] = {}

        # -------------------------------------------------------------
        # Phase A: Targeted Physical Constraint Repair Pass
        # -------------------------------------------------------------
        repair_step = 0
        max_repair_steps = 8

        while repair_step < max_repair_steps:
            eval_res = ConstraintEvaluator.evaluate_state(curr_state)
            if eval_res['is_valid']:
                break

            applied = False
            # Check boundary breaches first (highest priority)
            if eval_res.get('boundary_violations'):
                changed, msg = OptimizationOperators.op_repair_boundary(curr_state, rng)
                if changed:
                    applied = True
                    op_name = 'repair_boundary'
                    operators_applied.append(op_name)
                    operators_used_count[op_name] = operators_used_count.get(op_name, 0) + 1
                    metrics.repaired_boundary_violations += 1

            # Check collisions second
            if not applied and eval_res.get('collisions'):
                changed, msg = OptimizationOperators.op_repair_collision(curr_state, rng)
                if changed:
                    applied = True
                    op_name = 'repair_collision'
                    operators_applied.append(op_name)
                    operators_used_count[op_name] = operators_used_count.get(op_name, 0) + 1
                    metrics.repaired_collisions += 1

            # Check socket gaps if children still breach or collide
            if not applied and curr_state.relationships:
                changed, msg = OptimizationOperators.op_socket_reassignment(curr_state, rng)
                if changed:
                    applied = True
                    op_name = 'socket_reassignment'
                    operators_applied.append(op_name)
                    operators_used_count[op_name] = operators_used_count.get(op_name, 0) + 1

            # Nudge away from doors if door blocked
            if not applied and eval_res.get('door_violations'):
                changed, msg = OptimizationOperators.op_clearance_nudge(curr_state, rng)
                if changed:
                    applied = True
                    op_name = 'clearance_nudge'
                    operators_applied.append(op_name)
                    operators_used_count[op_name] = operators_used_count.get(op_name, 0) + 1

            if not applied:
                break

            repair_step += 1
            metrics.states_evaluated += 1

        # -------------------------------------------------------------
        # Feasibility Gate (Stage 1 Non-Negotiable Feasibility)
        # -------------------------------------------------------------
        final_feasibility = ConstraintEvaluator.evaluate_state(curr_state)
        metrics.final_valid = final_feasibility['is_valid']
        metrics.operators_applied = operators_applied
        metrics.operators_used_count = operators_used_count

        if not final_feasibility['is_valid']:
            # Infeasible proposal could not be repaired within bounded limits.
            # Architectural rule (Issue 3): Hard constraints MUST remain strictly outside Pareto trade-offs.
            # Do NOT run Phase B multi-objective operators on physically infeasible states.
            final_objectives = ObjectiveEvaluator.evaluate(
                curr_state,
                preferences=preferences,
                spatial_context=spatial_context,
                budget_diff=budget_diff,
            )
            metrics.final_score = final_objectives.aggregate_score()
            metrics.duration_ms = (time.time() - start_time) * 1000.0
            state_id = f"opt-state-infeasible-{variant_seed_offset}"
            return (
                OptimizationCandidateState(
                    state_id=state_id,
                    scene=curr_state.to_scene_dict(),
                    proposed_actions=curr_state.actions,
                    is_valid=False,
                    is_approval_eligible=False,
                    objectives=final_objectives,
                    operators_applied=operators_applied,
                    iteration_discovered=0,
                    fatal_errors=final_feasibility['fatal_errors'],
                ),
                metrics,
            )

        # -------------------------------------------------------------
        # Phase B: Multi-Objective Quality & Diversity Optimization Pass
        # -------------------------------------------------------------
        best_state = curr_state.clone()
        best_objectives = ObjectiveEvaluator.evaluate(
            best_state,
            preferences=preferences,
            spatial_context=spatial_context,
            budget_diff=budget_diff,
        )
        best_score = best_objectives.aggregate_score()

        iteration = 0
        operator_pool = [
            ('wall_alignment', OptimizationOperators.op_wall_alignment),
            ('group_translation', OptimizationOperators.op_group_translation),
            ('group_rotation', OptimizationOperators.op_group_rotation),
            ('socket_reassignment', OptimizationOperators.op_socket_reassignment),
            ('zone_relocation', OptimizationOperators.op_zone_relocation),
            ('perimeter_distribution', OptimizationOperators.op_perimeter_distribution),
            ('open_space_recovery', OptimizationOperators.op_open_space_recovery),
            ('clearance_nudge', OptimizationOperators.op_clearance_nudge),
        ]

        # Bias operators if strategy bias provided
        if strategy_bias == 'circulation':
            operator_pool.extend([
                ('open_space_recovery', OptimizationOperators.op_open_space_recovery),
                ('clearance_nudge', OptimizationOperators.op_clearance_nudge),
                ('wall_alignment', OptimizationOperators.op_wall_alignment),
            ])
        elif strategy_bias == 'wall_compact':
            operator_pool.extend([
                ('wall_alignment', OptimizationOperators.op_wall_alignment),
                ('socket_reassignment', OptimizationOperators.op_socket_reassignment),
            ])
        elif strategy_bias == 'zone_explore':
            operator_pool.extend([
                ('group_translation', OptimizationOperators.op_group_translation),
                ('group_rotation', OptimizationOperators.op_group_rotation),
                ('zone_relocation', OptimizationOperators.op_zone_relocation),
            ])

        max_iters = min(self.config.max_iterations, 15)
        time_limit_sec = self.config.time_limit_ms / 1000.0

        while iteration < max_iters:
            # Check elapsed time
            elapsed = time.time() - start_time
            if elapsed > time_limit_sec:
                break

            iteration += 1
            metrics.iterations_run += 1

            # Pick operator
            op_name, op_func = rng.choice(operator_pool)
            candidate_state = best_state.clone()

            success, msg = op_func(candidate_state, rng)
            if not success:
                continue

            metrics.states_evaluated += 1

            # Validate mutated candidate
            eval_res = ConstraintEvaluator.evaluate_state(candidate_state)
            # Only consider moves that maintain or improve validity
            if not eval_res['is_valid'] and best_score > 60.0:
                continue

            cand_objectives = ObjectiveEvaluator.evaluate(
                candidate_state,
                preferences=preferences,
                spatial_context=spatial_context,
                budget_diff=budget_diff,
            )
            cand_score = cand_objectives.aggregate_score()

            # Acceptance criteria: Pareto dominance or improved aggregate score
            if cand_objectives.dominates(best_objectives) or (cand_score > best_score and eval_res['is_valid']):
                best_state = candidate_state
                best_objectives = cand_objectives
                best_score = cand_score
                operators_applied.append(op_name)
                operators_used_count[op_name] = operators_used_count.get(op_name, 0) + 1

        final_eval = ConstraintEvaluator.evaluate_state(best_state)
        final_objectives = ObjectiveEvaluator.evaluate(
            best_state,
            preferences=preferences,
            spatial_context=spatial_context,
            budget_diff=budget_diff,
        )

        metrics.final_valid = final_eval['is_valid']
        metrics.final_score = final_objectives.aggregate_score()
        metrics.score_improvement = metrics.final_score - metrics.initial_score
        metrics.duration_ms = (time.time() - start_time) * 1000.0
        metrics.operators_used = operators_used_count

        state_id = f"opt-state-{variant_seed_offset}"
        result_state = OptimizationCandidateState(
            state_id=state_id,
            scene=best_state.to_scene_dict(),
            proposed_actions=best_state.actions,
            is_valid=final_eval['is_valid'],
            is_approval_eligible=final_eval['is_approval_eligible'],
            objectives=final_objectives,
            operators_applied=operators_applied,
            iteration_discovered=iteration,
            fatal_errors=final_eval['fatal_errors'],
        )

        return result_state, metrics

