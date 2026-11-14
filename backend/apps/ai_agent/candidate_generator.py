"""
Candidate Generator for RoomGenie AI (Phase 6.3).
Orchestrates multi-candidate layout generation, independent simulation,
bounded refinement (max 2 attempts), 6-component scoring, and deterministic ranking.
"""

import time
import uuid
from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import (
    DEFAULT_CANDIDATE_COUNT,
    MAX_CANDIDATE_COUNT,
    MAX_REFINEMENT_ATTEMPTS,
    LayoutCandidate,
    compute_canonical_scene_hash,
)
from apps.ai_agent.candidate_simulator import CandidateSimulator
from apps.ai_agent.candidate_scorer import CandidateScorer
from apps.ai_agent.candidate_ranker import CandidateRanker
from apps.ai_agent.adapters import get_design_llm_adapter
from apps.ai_agent.adapters.base import BaseDesignLLMAdapter, DesignProposalResult


class CandidateGenerator:
    """
    Main service coordinating multi-candidate layout proposals.
    Ensures that under all circumstances:
    1. Every candidate starts from the exact same immutable scene snapshot.
    2. Hard spatial constraints are authoritative and cannot be bypassed.
    3. Failed candidates undergo bounded refinement (up to 2 attempts).
    4. Quality scoring and ranking are 100% deterministic and reproducible.
    """

    def __init__(self, adapter: Optional[BaseDesignLLMAdapter] = None):
        self.adapter = adapter or get_design_llm_adapter()

    def generate_candidates(
        self,
        user_prompt: str,
        current_scene: Dict[str, Any],
        candidate_count: int = DEFAULT_CANDIDATE_COUNT,
        max_budget_paise: Optional[int] = None,
        user_requirements: Optional[Dict[str, Any]] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        catalogue_context: Optional[List[Dict[str, Any]]] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        preferences: Optional[Any] = None,
    ) -> List[LayoutCandidate]:
        """
        Generates, simulates, scores, and ranks candidate layouts.
        """
        # Clamp candidate count to [1, MAX_CANDIDATE_COUNT]
        count = max(1, min(candidate_count, MAX_CANDIDATE_COUNT))

        source_scene_hash = compute_canonical_scene_hash(current_scene)
        created_at_ms = int(time.time() * 1000)

        # 1. Request candidate proposals from adapter
        proposal_variants: List[DesignProposalResult] = self.adapter.generate_candidate_variants(
            user_prompt=user_prompt,
            current_scene=current_scene,
            candidate_count=count,
            conversation_history=conversation_history,
            catalogue_context=catalogue_context,
            spatial_context=spatial_context,
            user_requirements=user_requirements,
            preferences=preferences,
        )

        candidates: List[LayoutCandidate] = []

        for idx, variant in enumerate(proposal_variants[:count]):
            cand_id = f"cand-{idx + 1}-{uuid.uuid4().hex[:6]}"
            simulator = CandidateSimulator(current_scene, max_budget_paise=max_budget_paise)

            # 2. Simulate proposed actions
            sim_res = simulator.simulate(
                proposed_actions=variant.proposed_actions,
                user_requirements=user_requirements,
            )

            refinement_attempts = 0
            current_proposal = variant

            # 3. Bounded Refinement Loop (max 2 attempts per candidate)
            while not sim_res['is_valid'] and refinement_attempts < MAX_REFINEMENT_ATTEMPTS:
                refinement_attempts += 1
                try:
                    refined_proposal = self.adapter.refine_candidate_proposal(
                        user_prompt=user_prompt,
                        current_scene=current_scene,
                        failed_proposal=current_proposal,
                        validation_feedback=sim_res['validation_feedback'].to_dict(),
                        catalogue_context=catalogue_context,
                        spatial_context=spatial_context,
                        attempt=refinement_attempts,
                    )
                    # Re-simulate candidate with new actions
                    refined_sim = simulator.simulate(
                        proposed_actions=refined_proposal.proposed_actions,
                        user_requirements=user_requirements,
                    )
                    current_proposal = refined_proposal
                    sim_res = refined_sim
                except Exception:
                    # In case of refinement error, stop refinement and retain diagnostics
                    break

            # 4. Calculate 6-Component Quality Score
            score = CandidateScorer.calculate_score(
                candidate_scene=sim_res['candidate_scene'],
                validation_feedback=sim_res['validation_feedback'],
                budget_diff=sim_res['budget_diff'],
                user_requirements=user_requirements,
                spatial_context=spatial_context,
                preferences=preferences,
            )

            label = current_proposal.candidate_label or f"Option {chr(65 + idx)}"
            desc = current_proposal.description or current_proposal.text_response
            reasoning = current_proposal.text_response
            trade_offs = current_proposal.trade_offs or []

            # Determine intended relationships from proposed actions or proposal
            intended_rels = current_proposal.intended_relationships or []
            if not intended_rels and 'relationships' in sim_res['candidate_scene']:
                intended_rels = sim_res['candidate_scene']['relationships']

            candidate = LayoutCandidate(
                id=cand_id,
                label=label,
                description=desc,
                reasoning_summary=reasoning,
                proposed_actions=current_proposal.proposed_actions,
                candidate_scene=sim_res['candidate_scene'],
                source_scene_hash=source_scene_hash,
                is_valid=sim_res['is_valid'],
                is_approval_eligible=sim_res['is_approval_eligible'],
                score=score,
                validation_feedback=sim_res['validation_feedback'],
                trade_offs=trade_offs,
                intended_relationships=intended_rels,
                refinement_attempts=refinement_attempts,
                created_at_ms=created_at_ms,
                budget_diff=sim_res['budget_diff'],
                schema_valid=sim_res.get('schema_valid', True),
                reference_valid=sim_res.get('reference_valid', True),
                domain_valid=sim_res.get('domain_valid', True),
                budget_valid=sim_res.get('budget_valid', True),
                schema_errors=sim_res.get('schema_errors', []),
                reference_errors=sim_res.get('reference_errors', []),
                domain_errors=sim_res.get('domain_errors', []),
                budget_errors=sim_res.get('budget_errors', []),
            )

            candidates.append(candidate)

        # 5. Deterministic Ranking
        ranked_candidates = CandidateRanker.rank_candidates(candidates)
        return ranked_candidates
