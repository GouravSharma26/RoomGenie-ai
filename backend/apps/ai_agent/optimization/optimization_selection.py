"""
Pareto Selection and Non-Dominated Ranking for RoomGenie AI (Phase 7.2).
Implements multi-objective Pareto dominance ranking, crowding distance assignment,
and badge attribution for optimal candidate selection.
"""

from typing import Dict, List, Optional, Set, Tuple
from apps.ai_agent.optimization.optimization_config import (
    BADGE_BEST_CIRCULATION,
    BADGE_BEST_OPEN_SPACE,
    BADGE_BEST_OVERALL,
    BADGE_BEST_PREFERENCE_MATCH,
    BADGE_MAX_ACCESSIBILITY,
)
from apps.ai_agent.optimization.optimization_diversity import DiversityEngine
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.optimization.optimization_types import ObjectiveVector, OptimizationCandidateState


class ParetoSelector:
    """
    Computes Pareto dominance fronts and performs diversity-aware selection.
    """

    @staticmethod
    def non_dominated_sort(candidates: List[OptimizationCandidateState]) -> List[List[OptimizationCandidateState]]:
        """
        Standard fast non-dominated sorting.
        Partitions candidates into Pareto fronts: Front 0 (non-dominated), Front 1, etc.
        """
        if not candidates:
            return []

        domination_counts: Dict[str, int] = {c.state_id: 0 for c in candidates}
        dominated_sets: Dict[str, List[OptimizationCandidateState]] = {c.state_id: [] for c in candidates}
        cand_map = {c.state_id: c for c in candidates}

        fronts: List[List[OptimizationCandidateState]] = [[]]

        n = len(candidates)
        for i in range(n):
            p = candidates[i]
            for j in range(i + 1, n):
                q = candidates[j]
                if p.objectives.dominates(q.objectives):
                    dominated_sets[p.state_id].append(q)
                    domination_counts[q.state_id] += 1
                elif q.objectives.dominates(p.objectives):
                    dominated_sets[q.state_id].append(p)
                    domination_counts[p.state_id] += 1

            if domination_counts[p.state_id] == 0:
                p.pareto_rank = 0
                fronts[0].append(p)

        curr_rank = 0
        while curr_rank < len(fronts) and fronts[curr_rank]:
            next_front: List[OptimizationCandidateState] = []
            for p in fronts[curr_rank]:
                for q in dominated_sets[p.state_id]:
                    domination_counts[q.state_id] -= 1
                    if domination_counts[q.state_id] == 0:
                        q.pareto_rank = curr_rank + 1
                        next_front.append(q)
            curr_rank += 1
            if next_front:
                fronts.append(next_front)

        return [f for f in fronts if f]

    @staticmethod
    def assign_crowding_distance(front: List[OptimizationCandidateState]) -> None:
        """
        Assigns crowding distance to candidates in a front to favor spread across objectives.
        """
        l = len(front)
        if l <= 2:
            for c in front:
                c.crowding_distance = float('inf')
            return

        for c in front:
            c.crowding_distance = 0.0

        dimensions = [
            'containment', 'collision', 'circulation', 'clearance',
            'accessibility', 'utilization', 'preferences', 'relationships'
        ]

        for dim in dimensions:
            front.sort(key=lambda c: getattr(c.objectives, dim))
            front[0].crowding_distance = float('inf')
            front[-1].crowding_distance = float('inf')
            min_val = getattr(front[0].objectives, dim)
            max_val = getattr(front[-1].objectives, dim)
            val_range = max_val - min_val
            if val_range > 1e-4:
                for i in range(1, l - 1):
                    dist = (getattr(front[i + 1].objectives, dim) - getattr(front[i - 1].objectives, dim)) / val_range
                    front[i].crowding_distance += dist

    @staticmethod
    def select_best_candidates(
        candidates: List[OptimizationCandidateState],
        target_count: int = 3,
        diversity_threshold: float = 12.0
    ) -> List[OptimizationCandidateState]:
        """
        Extracts non-dominated fronts, sorts by rank and crowding distance,
        and applies near-duplicate suppression to select the final diverse set.
        """
        if not candidates:
            return []

        fronts = ParetoSelector.non_dominated_sort(candidates)
        ordered: List[OptimizationCandidateState] = []

        for front in fronts:
            ParetoSelector.assign_crowding_distance(front)
            # Sort front by crowding distance descending (favoring diverse/spread solutions)
            front.sort(key=lambda c: (c.is_valid, c.crowding_distance, c.objectives.aggregate_score()), reverse=True)
            ordered.extend(front)

        # Near-duplicate suppression
        selected: List[OptimizationCandidateState] = []
        for cand in ordered:
            state_obj = CandidateSceneState(cand.scene)
            is_dup = False
            for s in selected:
                s_state = CandidateSceneState(s.scene)
                dist = DiversityEngine.calculate_state_distance(state_obj, s_state)
                if dist < diversity_threshold:
                    is_dup = True
                    break
            if not is_dup:
                selected.append(cand)
            if len(selected) >= target_count:
                break

        # Fallback if diversity filtering was overly aggressive
        if len(selected) < target_count:
            for cand in ordered:
                if cand not in selected:
                    selected.append(cand)
                if len(selected) >= target_count:
                    break

        # Assign informative badges
        ParetoSelector.assign_badges(selected)
        return selected

    @staticmethod
    def assign_badges(candidates: List[OptimizationCandidateState]) -> None:
        """
        Assigns distinct highlighting badges based on objective vector strengths.
        """
        if not candidates:
            return

        # Best overall: highest aggregate score
        best_overall = max(candidates, key=lambda c: c.objectives.aggregate_score())
        best_overall.best_badge = BADGE_BEST_OVERALL

        for c in candidates:
            if c == best_overall:
                continue
            # Check other dimensions
            if c.objectives.circulation >= 95.0 and c.objectives.circulation == max(x.objectives.circulation for x in candidates):
                c.best_badge = BADGE_BEST_CIRCULATION
            elif c.objectives.preferences >= 95.0 and c.objectives.preferences == max(x.objectives.preferences for x in candidates):
                c.best_badge = BADGE_BEST_PREFERENCE_MATCH
            elif c.objectives.utilization >= 90.0 and c.objectives.utilization == max(x.objectives.utilization for x in candidates):
                c.best_badge = BADGE_BEST_OPEN_SPACE
            elif c.objectives.accessibility >= 90.0:
                c.best_badge = BADGE_MAX_ACCESSIBILITY
            else:
                c.best_badge = None

