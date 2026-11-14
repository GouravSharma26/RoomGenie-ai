"""
Refinement Runner for RoomGenie AI (Phase 7.3).
Orchestrates end-to-end refinement generation, constraint-aware optimization,
authoritative physical validation, and before/after comparison.
"""

import copy
import logging
import math
import time
from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import LayoutCandidate
from apps.ai_agent.candidate_simulator import CandidateSimulator
from apps.ai_agent.candidate_scorer import CandidateScorer
from apps.ai_agent.candidate_ranker import CandidateRanker
from apps.ai_agent.optimization.optimization_runner import OptimizationRunner, sync_actions_with_state
from apps.ai_agent.feedback.feedback_types import TypedRefinementRequest
from apps.ai_agent.feedback.refinement_planner import RefinementPlanner
from apps.ai_agent.feedback.candidate_comparison import CandidateComparisonService

logger = logging.getLogger(__name__)


class RefinementRunner:
    """
    Executes bounded, constraint-verified layout refinement,
    ensuring protected objects remain strictly untouched.
    """

    def __init__(
        self,
        planner: Optional[RefinementPlanner] = None,
        opt_runner: Optional[OptimizationRunner] = None,
    ):
        self.planner = planner or RefinementPlanner()
        self.opt_runner = opt_runner or OptimizationRunner()

    def run_refinement(
        self,
        base_candidate: LayoutCandidate,
        refinement_request: TypedRefinementRequest,
        preferences: Optional[Any] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        user_requirements: Optional[Dict[str, Any]] = None,
        max_budget_paise: Optional[int] = None,
    ) -> List[LayoutCandidate]:
        """
        Executes refinement workflow and returns a ranked list of verified refined candidates.
        """
        start_time = time.time()
        proposals = self.planner.generate_refinement_proposals(
            base_candidate=base_candidate,
            refinement_request=refinement_request,
        )

        refined_candidates: List[LayoutCandidate] = []
        protected_ids = set(refinement_request.protected_object_ids)
        base_objs = {o.get('id'): o for o in base_candidate.candidate_scene.get('objects', []) if 'id' in o}

        for idx, prop in enumerate(proposals):
            variant_scene = prop['scene']
            variant_actions = prop['actions']
            label = prop['label']
            desc = prop['description']
            cand_id = f"refined-{base_candidate.id}-{chr(97 + idx)}"

            # 1. Authoritative simulation & validation of refined scene
            sim_res = CandidateSimulator.validate_candidate_scene(
                candidate_scene=variant_scene,
                max_budget_paise=max_budget_paise,
                user_requirements=user_requirements,
                budget_diff=base_candidate.budget_diff,
            )

            # 2. Score candidate
            score = CandidateScorer.calculate_score(
                candidate_scene=sim_res['candidate_scene'],
                validation_feedback=sim_res['validation_feedback'],
                budget_diff=sim_res['budget_diff'],
                user_requirements=user_requirements,
                spatial_context=spatial_context,
                preferences=preferences,
            )

            # 3. Create provisional candidate
            candidate = LayoutCandidate(
                id=cand_id,
                label=label,
                description=desc,
                reasoning_summary=f"Refinement of '{base_candidate.label}': {desc}",
                proposed_actions=variant_actions,
                candidate_scene=sim_res['candidate_scene'],
                source_scene_hash=base_candidate.source_scene_hash,
                is_valid=sim_res['is_valid'],
                is_approval_eligible=sim_res['is_approval_eligible'],
                score=score,
                validation_feedback=sim_res['validation_feedback'],
                trade_offs=base_candidate.trade_offs,
                intended_relationships=sim_res['candidate_scene'].get('relationships', []),
                refinement_attempts=1,
                created_at_ms=int(time.time() * 1000),
                budget_diff=sim_res['budget_diff'],
                schema_valid=sim_res.get('schema_valid', True),
                reference_valid=sim_res.get('reference_valid', True),
                domain_valid=sim_res.get('domain_valid', True),
                budget_valid=sim_res.get('budget_valid', True),
            )

            # 4. Run optimization repair on the refined candidate
            optimized_cand = self.opt_runner.optimize_candidate(
                candidate=candidate,
                preferences=preferences,
                spatial_context=spatial_context,
                user_requirements=user_requirements,
                max_budget_paise=max_budget_paise,
                variant_index=idx,
                strategy_bias='circulation' if refinement_request.intent_category == 'improve_circulation' else 'wall_compact',
            )

            # 5. Protected Objects Enforcement Check:
            # Verify no protected item was displaced during search & repair
            opt_objs = {o.get('id'): o for o in optimized_cand.candidate_scene.get('objects', []) if 'id' in o}
            protected_intact = True
            any_rolled_back = False
            for pid in protected_ids:
                if pid in base_objs and pid in opt_objs:
                    p_orig = base_objs[pid].get('position', [0, 0, 0])
                    p_curr = opt_objs[pid].get('position', [0, 0, 0])
                    dist = math.hypot(p_orig[0] - p_curr[0], p_orig[2] - p_curr[2])
                    if dist > 0.05:  # Tolerance threshold
                        # Strictly enforce position preservation
                        opt_objs[pid]['position'] = list(p_orig)
                        any_rolled_back = True
                elif pid not in opt_objs:
                    protected_intact = False

            if any_rolled_back:
                from apps.ai_agent.optimization.optimization_runner import sync_actions_with_state
                optimized_cand.proposed_actions = sync_actions_with_state(
                    optimized_cand.proposed_actions, optimized_cand.candidate_scene
                )

            # 6. Compute comparison with base candidate
            comparison = CandidateComparisonService.compare_candidates(base_candidate, optimized_cand)

            refinement_metadata = {
                'isRefinement': True,
                'baseCandidateId': base_candidate.id,
                'userIntent': refinement_request.intent_category,
                'rawInstruction': refinement_request.raw_prompt,
                'protectedObjects': refinement_request.protected_object_ids,
                'targetObjects': refinement_request.target_object_ids,
                'protectedObjectsPreserved': protected_intact,
                'scoreDelta': round(optimized_cand.score.overall - base_candidate.score.overall, 1),
                'displacements': comparison.position_displacements,
                'executionDurationMs': round((time.time() - start_time) * 1000.0, 2),
            }

            optimized_cand.optimization_metadata = {
                **(optimized_cand.optimization_metadata or {}),
                **refinement_metadata,
            }

            refined_candidates.append(optimized_cand)

        # 7. Rank refined candidates
        return CandidateRanker.rank_candidates(refined_candidates)
