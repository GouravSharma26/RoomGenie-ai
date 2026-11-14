"""
Candidate Diversity and Near-Duplicate Suppression for RoomGenie AI (Phase 7.2).
Provides multi-aspect diversity measurement across:
1. Spatial coordinate displacement
2. Orientation / heading differences
3. Functional grouping / cluster topology
4. Socket attachment relationships
Includes near-duplicate suppression to filter out redundant proposals.
"""

import math
from typing import Any, Dict, List, Optional, Set, Tuple
from apps.ai_agent.optimization.optimization_state import CandidateSceneState


class DiversityEngine:
    """
    Computes multi-dimensional pairwise diversity distances and prunes near-duplicates.
    """

    @staticmethod
    def calculate_state_distance(state_a: CandidateSceneState, state_b: CandidateSceneState) -> float:
        """
        Computes comprehensive spatial and topological distance between two candidate states (0.0 - 100.0).
        """
        room_diag = math.hypot(state_a.room_width, state_a.room_length)
        if room_diag < 1e-4:
            room_diag = 5.0

        objs_a = {obj['id']: obj for obj in state_a.objects if 'id' in obj}
        objs_b = {obj['id']: obj for obj in state_b.objects if 'id' in obj}

        all_ids = set(objs_a.keys()) | set(objs_b.keys())
        common_ids = set(objs_a.keys()) & set(objs_b.keys())

        if not all_ids:
            return 0.0

        # 1. Asset Composition Difference (Jaccard distance)
        comp_dist = (len(all_ids) - len(common_ids)) / float(len(all_ids)) * 100.0

        if not common_ids:
            return 100.0

        # 2. Position Displacement (Euclidean distance normalized by room diagonal)
        pos_diff_sum = 0.0
        for oid in common_ids:
            pa = objs_a[oid].get('position', [0, 0, 0])
            pb = objs_b[oid].get('position', [0, 0, 0])
            d = math.hypot(pa[0] - pb[0], pa[2] - pb[2])
            pos_diff_sum += min(1.0, d / (room_diag * 0.40))
        norm_pos_dist = (pos_diff_sum / len(common_ids)) * 100.0

        # 3. Orientation Difference (Yaw angle difference)
        angle_diff_sum = 0.0
        for oid in common_ids:
            ya = state_a.get_object_yaw(oid)
            yb = state_b.get_object_yaw(oid)
            diff = abs((ya - yb + math.pi) % (2 * math.pi) - math.pi)
            angle_diff_sum += (diff / math.pi)
        norm_rot_dist = (angle_diff_sum / len(common_ids)) * 100.0

        # 4. Socket Relationship Topology Difference
        rels_a = {
            (r.get('anchorObjectId'), r.get('childObjectId'), r.get('socketId'))
            for r in state_a.relationships
        }
        rels_b = {
            (r.get('anchorObjectId'), r.get('childObjectId'), r.get('socketId'))
            for r in state_b.relationships
        }
        all_rels = rels_a | rels_b
        if all_rels:
            common_rels = rels_a & rels_b
            rel_dist = (len(all_rels) - len(common_rels)) / float(len(all_rels)) * 100.0
        else:
            rel_dist = 0.0

        # Weighted combination: 40% position, 25% rotation, 20% composition, 15% relationships
        total_dist = (
            norm_pos_dist * 0.40 +
            norm_rot_dist * 0.25 +
            comp_dist * 0.20 +
            rel_dist * 0.15
        )
        return round(min(100.0, total_dist), 2)

    @staticmethod
    def calculate_population_diversity(states: List[CandidateSceneState]) -> float:
        """
        Computes average pairwise diversity distance across a population of candidate states (0.0 to 100.0).
        """
        if len(states) < 2:
            return 0.0

        total_dist = 0.0
        pair_count = 0
        for i in range(len(states)):
            for j in range(i + 1, len(states)):
                dist = DiversityEngine.calculate_state_distance(states[i], states[j])
                total_dist += dist
                pair_count += 1

        if pair_count == 0:
            return 0.0
        return round(total_dist / pair_count, 2)

    @staticmethod
    def suppress_near_duplicates(
        states: List[Tuple[CandidateSceneState, float]],
        distance_threshold: float = 12.0
    ) -> List[Tuple[CandidateSceneState, float]]:
        """
        Prunes states that are closer than distance_threshold to an already accepted higher-fitness state.
        Expects states sorted in descending order of score / fitness.
        """
        filtered: List[Tuple[CandidateSceneState, float]] = []
        for state, score in states:
            is_duplicate = False
            for accepted_state, _ in filtered:
                dist = DiversityEngine.calculate_state_distance(state, accepted_state)
                if dist < distance_threshold:
                    is_duplicate = True
                    break
            if not is_duplicate:
                filtered.append((state, score))

        return filtered

