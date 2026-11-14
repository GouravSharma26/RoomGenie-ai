"""
Optimization Runner and Integration Facade for RoomGenie AI (Phase 7.2).
Provides the top-level orchestrator that takes candidate layout proposals,
coordinates constraint repair, Pareto multi-objective search, diversity selection,
and attaches rich optimization telemetry.
"""

import copy
import logging
import time
from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import (
    CandidateValidationFeedback,
    LayoutCandidate,
    ScoreBreakdown,
    StructuredValidationIssue,
)
from apps.ai_agent.candidate_scorer import CandidateScorer
from apps.ai_agent.candidate_simulator import CandidateSimulator, categorize_error, categorize_warning
from apps.ai_agent.optimization.optimization_config import DEFAULT_OPTIMIZATION_CONFIG
from apps.ai_agent.optimization.optimization_diversity import DiversityEngine
from apps.ai_agent.optimization.optimization_search import SpatialOptimizerSearch
from apps.ai_agent.optimization.optimization_selection import ParetoSelector
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.optimization.optimization_types import (
    OptimizationCandidateState,
    OptimizationConfig,
    OptimizationMetrics,
)

logger = logging.getLogger(__name__)


def sync_actions_with_state(actions: List[Dict[str, Any]], scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Synchronizes proposed action parameters (position, rotation, socket gap)
    with the final optimized candidate scene objects and relationships.
    """
    updated = copy.deepcopy(actions)
    objs_by_id = {o['id']: o for o in scene.get('objects', []) if 'id' in o}
    rels_by_pair = {
        (r.get('childObjectId'), r.get('socketId')): r
        for r in scene.get('relationships', [])
    }
    for act in updated:
        params = act.get('parameters', act)
        name = act.get('name') or act.get('type')
        if name in ('add_furniture', 'move_object'):
            oid = params.get('object_id') or params.get('objectId')
            if oid and oid in objs_by_id:
                obj = objs_by_id[oid]
                pos = obj.get('position', [0.0, 0.0, 0.0])
                rot = obj.get('rotationEuler', [0.0, 0.0, 0.0])
                params['position'] = [round(pos[0], 4), round(pos[1], 4), round(pos[2], 4)]
                if 'rotation_euler' in params:
                    params['rotation_euler'] = [round(rot[0], 4), round(rot[1], 4), round(rot[2], 4)]
                elif 'rotationEuler' in params:
                    params['rotationEuler'] = [round(rot[0], 4), round(rot[1], 4), round(rot[2], 4)]
                else:
                    params['rotation_euler'] = [round(rot[0], 4), round(rot[1], 4), round(rot[2], 4)]
        elif name == 'attach_to_socket':
            cid = params.get('child_object_id') or params.get('childObjectId')
            sid = params.get('socket_id') or params.get('socketId')
            rel = rels_by_pair.get((cid, sid))
            if rel:
                gap = rel.get('gap') if 'gap' in rel else (rel.get('gapMeters') or params.get('gap_meters') or 0.10)
                if 'gap_meters' in params:
                    params['gap_meters'] = round(float(gap), 4)
                if 'gapMeters' in params:
                    params['gapMeters'] = round(float(gap), 4)
    return updated


class OptimizationRunner:
    """
    Coordinates spatial optimization across multi-candidate proposals.
    """

    def __init__(self, config: Optional[OptimizationConfig] = None):
        self.config = config or DEFAULT_OPTIMIZATION_CONFIG
        self.search = SpatialOptimizerSearch(self.config)

    def optimize_candidate(
        self,
        candidate: LayoutCandidate,
        preferences: Optional[Any] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        user_requirements: Optional[Dict[str, Any]] = None,
        max_budget_paise: Optional[int] = None,
        variant_index: int = 0,
        strategy_bias: Optional[str] = None,
    ) -> LayoutCandidate:
        """
        Optimizes a single layout candidate using constraint-guided repair and local search.
        Authoritatively re-validates the resulting scene.
        """
        start_time = time.time()
        initial_scene = candidate.candidate_scene
        initial_actions = candidate.proposed_actions

        try:
            # Execute search and repair
            opt_state, metrics = self.search.repair_and_optimize(
                initial_scene=initial_scene,
                initial_actions=initial_actions,
                preferences=preferences,
                spatial_context=spatial_context,
                budget_diff=candidate.budget_diff,
                variant_seed_offset=variant_index * 17,
                strategy_bias=strategy_bias,
            )

            # Sync action coordinates with optimized scene transforms
            synced_actions = sync_actions_with_state(candidate.proposed_actions, opt_state.scene)

            # Authoritatively validate candidate scene directly
            sim_res = CandidateSimulator.validate_candidate_scene(
                candidate_scene=opt_state.scene,
                max_budget_paise=max_budget_paise,
                user_requirements=user_requirements,
                budget_diff=candidate.budget_diff,
            )

            # Re-score using 6-component + preference scoring
            score = CandidateScorer.calculate_score(
                candidate_scene=sim_res['candidate_scene'],
                validation_feedback=sim_res['validation_feedback'],
                budget_diff=sim_res['budget_diff'],
                user_requirements=user_requirements,
                spatial_context=spatial_context,
                preferences=preferences,
            )

            # Determine if repair occurred
            was_repaired = (not candidate.is_valid and sim_res['is_valid']) or (metrics.repaired_boundary_violations > 0 or metrics.repaired_collisions > 0)

            optimization_metadata = {
                'version': '7.2',
                'iterations': metrics.iterations_run,
                'statesEvaluated': metrics.states_evaluated,
                'durationMs': round((time.time() - start_time) * 1000.0, 2),
                'repaired': was_repaired,
                'initialValid': candidate.is_valid,
                'finalValid': sim_res['is_valid'],
                'initialScore': round(candidate.score.overall, 1),
                'finalScore': round(score.overall, 1),
                'scoreDelta': round(score.overall - candidate.score.overall, 1),
                'bestBadge': opt_state.best_badge,
                'objectives': opt_state.objectives.to_dict(),
                'appliedOperators': opt_state.operators_applied,
            }

            # Build optimized LayoutCandidate
            return LayoutCandidate(
                id=candidate.id,
                label=candidate.label,
                description=candidate.description,
                reasoning_summary=candidate.reasoning_summary,
                proposed_actions=synced_actions,
                candidate_scene=sim_res['candidate_scene'],
                source_scene_hash=candidate.source_scene_hash,
                is_valid=sim_res['is_valid'],
                is_approval_eligible=sim_res['is_approval_eligible'],
                score=score,
                validation_feedback=sim_res['validation_feedback'],
                trade_offs=candidate.trade_offs,
                intended_relationships=sim_res['candidate_scene'].get('relationships', candidate.intended_relationships),
                refinement_attempts=candidate.refinement_attempts,
                created_at_ms=candidate.created_at_ms,
                budget_diff=sim_res['budget_diff'],
                schema_valid=sim_res.get('schema_valid', True),
                reference_valid=sim_res.get('reference_valid', True),
                domain_valid=sim_res.get('domain_valid', True),
                budget_valid=sim_res.get('budget_valid', True),
                schema_errors=sim_res.get('schema_errors', []),
                reference_errors=sim_res.get('reference_errors', []),
                domain_errors=sim_res.get('domain_errors', []),
                budget_errors=sim_res.get('budget_errors', []),
                optimization_metadata=optimization_metadata,
            )

        except Exception as ex:
            logger.warning("Optimization failed for candidate %s, falling back to original: %s", candidate.id, ex)
            return candidate

    def optimize_candidate_pool(
        self,
        candidates: List[LayoutCandidate],
        preferences: Optional[Any] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        user_requirements: Optional[Dict[str, Any]] = None,
        max_budget_paise: Optional[int] = None,
        target_count: Optional[int] = None,
    ) -> List[LayoutCandidate]:
        """
        Optimizes a collection of candidates, applies strategy biases to promote diversity,
        and selects the Pareto-optimal non-dominated set with badge assignments.
        """
        if not candidates:
            return []

        strategy_biases = ['circulation', 'wall_compact', 'zone_explore', None]
        optimized_candidates: List[LayoutCandidate] = []
        opt_states_for_selection: List[OptimizationCandidateState] = []

        for idx, cand in enumerate(candidates):
            strategy = strategy_biases[idx % len(strategy_biases)]
            opt_cand = self.optimize_candidate(
                candidate=cand,
                preferences=preferences,
                spatial_context=spatial_context,
                user_requirements=user_requirements,
                max_budget_paise=max_budget_paise,
                variant_index=idx,
                strategy_bias=strategy,
            )
            optimized_candidates.append(opt_cand)

            # Build state for Pareto selection
            opt_meta = getattr(opt_cand, 'optimization_metadata', None) or {}
            objs_dict = opt_meta.get('objectives', {})
            from apps.ai_agent.optimization.optimization_types import ObjectiveVector
            obj_vec = ObjectiveVector(**objs_dict) if objs_dict else ObjectiveVector()
            state_item = OptimizationCandidateState(
                state_id=opt_cand.id,
                scene=opt_cand.candidate_scene,
                proposed_actions=opt_cand.proposed_actions,
                is_valid=opt_cand.is_valid,
                is_approval_eligible=opt_cand.is_approval_eligible,
                objectives=obj_vec,
            )
            opt_states_for_selection.append(state_item)

        # Assign Pareto badges
        ParetoSelector.assign_badges(opt_states_for_selection)
        for cand, state_item in zip(optimized_candidates, opt_states_for_selection):
            if hasattr(cand, 'optimization_metadata') and cand.optimization_metadata:
                cand.optimization_metadata['bestBadge'] = state_item.best_badge

        return optimized_candidates
