"""
Refinement Runner for RoomGenie AI (Phase 7.3).
Orchestrates end-to-end refinement generation, constraint-aware optimization,
authoritative physical validation, and before/after comparison.
"""

import copy
import logging
import math
import time
from typing import Any, Dict, List, Optional, Set, Tuple
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

            # 5. Protected Objects & Semantic Relationship Integrity Check
            opt_objs = {o.get('id'): o for o in optimized_cand.candidate_scene.get('objects', []) if 'id' in o}
            any_rolled_back = False

            # Restore original state of any protected object that may have been adjusted
            for pid in protected_ids:
                if pid in base_objs and pid in opt_objs:
                    b_obj = base_objs[pid]
                    curr_obj = opt_objs[pid]
                    # Ensure position, rotation, dimensions, scale, material match exactly
                    p_orig = b_obj.get('position', [0, 0, 0])
                    p_curr = curr_obj.get('position', [0, 0, 0])
                    dist = math.hypot(p_orig[0] - p_curr[0], p_orig[2] - p_curr[2])
                    if dist > 0.001:
                        curr_obj['position'] = list(p_orig)
                        any_rolled_back = True
                    if 'rotationEuler' in b_obj:
                        curr_obj['rotationEuler'] = list(b_obj['rotationEuler'])
                    elif 'rotation' in b_obj:
                        curr_obj['rotation'] = list(b_obj['rotation'])
                    if 'dimensions' in b_obj:
                        curr_obj['dimensions'] = copy.deepcopy(b_obj['dimensions'])
                    if 'scale' in b_obj:
                        curr_obj['scale'] = copy.deepcopy(b_obj['scale'])
                    if 'material' in b_obj:
                        curr_obj['material'] = copy.deepcopy(b_obj['material'])

            # Preserve semantic relationships where anchor/child are protected
            base_rels = base_candidate.candidate_scene.get('relationships', [])
            opt_rels = list(optimized_cand.candidate_scene.get('relationships', []))
            for b_rel in base_rels:
                anc = b_rel.get('anchor_id') or b_rel.get('anchorId')
                chd = b_rel.get('child_id') or b_rel.get('childId')
                if anc in protected_ids and chd in protected_ids:
                    # Verify relationship exists in refined scene
                    exists = any(
                        (r.get('anchor_id') or r.get('anchorId')) == anc and
                        (r.get('child_id') or r.get('childId')) == chd
                        for r in opt_rels
                    )
                    if not exists:
                        opt_rels.append(copy.deepcopy(b_rel))
                        any_rolled_back = True
            optimized_cand.candidate_scene['relationships'] = opt_rels

            if any_rolled_back:
                from apps.ai_agent.optimization.optimization_runner import sync_actions_with_state
                optimized_cand.proposed_actions = sync_actions_with_state(
                    optimized_cand.proposed_actions, optimized_cand.candidate_scene
                )
                # Re-validate after restoring protected items to guarantee no collisions were introduced
                re_sim = CandidateSimulator.validate_candidate_scene(
                    candidate_scene=optimized_cand.candidate_scene,
                    max_budget_paise=max_budget_paise,
                    user_requirements=user_requirements,
                    budget_diff=optimized_cand.budget_diff,
                )
                optimized_cand.is_valid = re_sim['is_valid']
                optimized_cand.is_approval_eligible = re_sim['is_approval_eligible']
                optimized_cand.validation_feedback = re_sim['validation_feedback']

            # Full protected state comparison check
            protected_intact, protection_violations = self.compare_protected_objects_state(
                base_scene=base_candidate.candidate_scene,
                candidate_scene=optimized_cand.candidate_scene,
                protected_ids=protected_ids,
            )

            if not protected_intact:
                optimized_cand.is_valid = False
                optimized_cand.is_approval_eligible = False

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
                'protectionViolations': protection_violations,
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

    @classmethod
    def compare_protected_objects_state(
        cls,
        base_scene: Dict[str, Any],
        candidate_scene: Dict[str, Any],
        protected_ids: Set[str],
    ) -> Tuple[bool, List[str]]:
        """
        Performs exhaustive state verification for protected objects:
        - Object ID existence
        - Catalogue identity (assetId)
        - Exact position within 0.001m
        - Rotation Euler within 0.001 rad
        - Scale
        - Dimensions
        - Material
        - Semantic relationships & parent/child attachment information
        """
        violations: List[str] = []
        base_objs = {o.get('id'): o for o in base_scene.get('objects', []) if 'id' in o}
        cand_objs = {o.get('id'): o for o in candidate_scene.get('objects', []) if 'id' in o}

        for pid in protected_ids:
            if pid not in base_objs:
                continue
            if pid not in cand_objs:
                violations.append(f"Protected object '{pid}' was removed from the scene.")
                continue

            b = base_objs[pid]
            c = cand_objs[pid]

            # 1. Catalogue identity
            if b.get('assetId') != c.get('assetId'):
                violations.append(f"Protected object '{pid}' assetId changed ({b.get('assetId')} -> {c.get('assetId')}).")

            # 2. Position within 0.001m
            b_pos = b.get('position', [0, 0, 0])
            c_pos = c.get('position', [0, 0, 0])
            pos_dist = math.sqrt(sum((bp - cp) ** 2 for bp, cp in zip(b_pos, c_pos)))
            if pos_dist > 0.001:
                violations.append(f"Protected object '{pid}' position displaced by {pos_dist:.4f}m.")

            # 3. Rotation
            b_rot = b.get('rotationEuler') or b.get('rotation', [0, 0, 0])
            c_rot = c.get('rotationEuler') or c.get('rotation', [0, 0, 0])
            if len(b_rot) == len(c_rot) and len(b_rot) >= 3:
                rot_diff = max(abs(br - cr) for br, cr in zip(b_rot, c_rot))
                if rot_diff > 0.001:
                    violations.append(f"Protected object '{pid}' rotation changed by {rot_diff:.4f} rad.")

            # 4. Dimensions & Scale
            if b.get('dimensions') and c.get('dimensions') and b.get('dimensions') != c.get('dimensions'):
                violations.append(f"Protected object '{pid}' dimensions altered.")
            if b.get('scale') and c.get('scale') and b.get('scale') != c.get('scale'):
                violations.append(f"Protected object '{pid}' scale altered.")

            # 5. Material
            if b.get('material') and c.get('material') and b.get('material') != c.get('material'):
                violations.append(f"Protected object '{pid}' material altered.")

        # 6. Semantic relationships & parent/child attachments
        base_rels = base_scene.get('relationships', [])
        cand_rels = candidate_scene.get('relationships', [])
        for rel in base_rels:
            anchor = rel.get('anchor_id') or rel.get('anchorId')
            child = rel.get('child_id') or rel.get('childId')
            if anchor in protected_ids and child in protected_ids:
                matched_rel = next(
                    (r for r in cand_rels if (r.get('anchor_id') or r.get('anchorId')) == anchor and (r.get('child_id') or r.get('childId')) == child),
                    None
                )
                if not matched_rel:
                    violations.append(f"Protected semantic relationship between '{anchor}' and '{child}' was severed.")

        return len(violations) == 0, violations
