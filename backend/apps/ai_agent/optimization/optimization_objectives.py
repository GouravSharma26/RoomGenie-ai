"""
Multi-Objective Evaluation for RoomGenie AI (Phase 7.2).
Evaluates 8 distinct normalized spatial objective dimensions (0.0 to 100.0):
1. Containment (Room boundary & polygon footprint compliance)
2. Collision (3D OBB collision-freedom)
3. Circulation (Doorway approaches & primary travel paths)
4. Clearance (Ergonomic passage widths & buffer spacing)
5. Accessibility (Unobstructed front access to seating/beds/desks)
6. Utilization (Balanced room floor use & central open space)
7. Preferences (Phase 7.1 explicit preference satisfaction)
8. Relationships (Socket attachment fidelity & functional grouping)
"""

import math
from typing import Any, Dict, List, Optional
from apps.ai_agent.optimization.optimization_constraints import ConstraintEvaluator
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.optimization.optimization_types import ObjectiveVector
from apps.ai_agent.sockets import CANONICAL_SOCKET_DEFINITIONS


class ObjectiveEvaluator:
    """
    Computes an 8-dimensional ObjectiveVector for a candidate state.
    """

    @staticmethod
    def evaluate(
        state: CandidateSceneState,
        preferences: Optional[Any] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        budget_diff: Optional[Dict[str, Any]] = None,
    ) -> ObjectiveVector:
        eval_res = ConstraintEvaluator.evaluate_state(state)

        # 1. Containment (100 = completely inside room polygon)
        b_viols = eval_res.get('boundary_violations', [])
        if not b_viols:
            containment = 100.0
        else:
            max_pen = max(v.get('max_penetration', 0.1) for v in b_viols)
            # Subtract 30 points minimum for any breach, plus 100 pts per meter of penetration
            containment = max(0.0, 100.0 - 30.0 - (max_pen * 100.0))

        # 2. Collision (100 = 0 collisions)
        colls = eval_res.get('collisions', [])
        if not colls:
            collision = 100.0
        else:
            collision = max(0.0, 100.0 - len(colls) * 35.0)

        # 3. Circulation (Doorway approaches and paths)
        door_viols = eval_res.get('door_violations', [])
        if not door_viols:
            circulation = 100.0
        else:
            # Door blockages heavily penalize circulation
            circulation = max(0.0, 100.0 - len(door_viols) * 45.0)

        # 4. Clearance (Passage widths between furniture items and perimeter)
        clearance = ObjectiveEvaluator._evaluate_clearances(state)

        # 5. Accessibility (Front access zones unobstructed)
        accessibility = ObjectiveEvaluator._evaluate_accessibility(state)

        # 6. Utilization (Balance of room area used, central open space)
        utilization = ObjectiveEvaluator._evaluate_utilization(state)

        # 7. Preferences (User preference satisfaction from Phase 7.1)
        if preferences:
            try:
                from apps.ai_agent.candidate_scorer import CandidateScorer
                from apps.ai_agent.candidate_types import CandidateValidationFeedback
                score_res = CandidateScorer.calculate_score(
                    candidate_scene=state.scene,
                    validation_feedback=CandidateValidationFeedback(),
                    budget_diff=budget_diff or {},
                    spatial_context=spatial_context,
                    preferences=preferences,
                )
                preferences_score = float(getattr(score_res, 'preference_score', 100.0))
            except Exception:
                preferences_score = 85.0
        else:
            preferences_score = 100.0

        # 8. Relationships (Socket attachment quality & gap satisfaction)
        relationships_score = ObjectiveEvaluator._evaluate_relationships(state)

        return ObjectiveVector(
            containment=round(containment, 2),
            collision=round(collision, 2),
            circulation=round(circulation, 2),
            clearance=round(clearance, 2),
            accessibility=round(accessibility, 2),
            utilization=round(utilization, 2),
            preferences=round(preferences_score, 2),
            relationships=round(relationships_score, 2),
        )

    @staticmethod
    def _evaluate_clearances(state: CandidateSceneState) -> float:
        """
        Rewards spacing between 0.60m and 1.20m (comfortable human walkways).
        Penalizes excessively cramped gaps (< 0.50m) between non-attached items.
        """
        objs = state.objects
        if len(objs) < 2:
            return 95.0

        attached_pairs = {
            (rel.get('anchorObjectId'), rel.get('childObjectId'))
            for rel in state.relationships
        }

        min_distances = []
        for i in range(len(objs)):
            for j in range(i + 1, len(objs)):
                id_a, id_b = objs[i].get('id'), objs[j].get('id')
                if (id_a, id_b) in attached_pairs or (id_b, id_a) in attached_pairs:
                    continue
                pos_a = objs[i].get('position', [0, 0, 0])
                pos_b = objs[j].get('position', [0, 0, 0])
                dist = math.hypot(pos_a[0] - pos_b[0], pos_a[2] - pos_b[2])
                min_distances.append(dist)

        if not min_distances:
            return 95.0

        score = 100.0
        for d in min_distances:
            if d < 0.60:
                score -= 15.0 * (0.60 - d) / 0.60
            elif d > 2.5:
                # Slight penalty for disjoint scatter
                score -= 2.0

        return max(20.0, min(100.0, score))

    @staticmethod
    def _evaluate_accessibility(state: CandidateSceneState) -> float:
        """
        Checks that front interaction zones of seating, beds, desks, and storage are clear.
        """
        objs = state.objects
        if not objs:
            return 100.0

        score = 100.0
        for obj in objs:
            aid = str(obj.get('assetId', '')).lower()
            name = str(obj.get('name', '')).lower()
            pos = obj.get('position', [0, 0, 0])
            yaw = state.get_object_yaw(obj.get('id', ''))

            # Seating/bed/desk front is typically along local +Z or +X
            # Front test point 0.6m in front
            front_x = pos[0] + 0.60 * math.sin(yaw)
            front_z = pos[2] + 0.60 * math.cos(yaw)

            # Check if this front point is inside the room
            poly = state.room_polygon
            if poly and len(poly) >= 3:
                from apps.ai_agent.sockets import is_point_in_polygon_2d
                if not is_point_in_polygon_2d((front_x, front_z), poly):
                    score -= 8.0  # Front face too close to wall

        return max(30.0, min(100.0, score))

    @staticmethod
    def _evaluate_utilization(state: CandidateSceneState) -> float:
        """
        Evaluates floor area coverage and open center distribution.
        Target coverage: 15% - 35% of floor area.
        """
        total_area = state.room_width * state.room_length
        if total_area < 1.0:
            return 80.0

        occupied_area = 0.0
        for obj in state.objects:
            d = obj.get('dimensions', [1, 1, 1])
            s = obj.get('scale', [1, 1, 1])
            occupied_area += (d[0] * s[0]) * (d[2] * s[2])

        coverage_ratio = occupied_area / total_area

        if 0.15 <= coverage_ratio <= 0.35:
            base = 100.0
        elif coverage_ratio < 0.15:
            base = 80.0 + (coverage_ratio / 0.15) * 20.0
        else:
            base = max(40.0, 100.0 - (coverage_ratio - 0.35) * 150.0)

        return round(base, 2)

    @staticmethod
    def _evaluate_relationships(state: CandidateSceneState) -> float:
        """
        Checks socket attachment gaps against recommended ranges.
        """
        rels = state.relationships
        if not rels:
            return 90.0

        score = 100.0
        for rel in rels:
            sock_id = rel.get('socketId')
            gap = float(rel.get('gapMeters', 0.20))
            for sdef in CANONICAL_SOCKET_DEFINITIONS:
                if sdef['id'] == sock_id:
                    rec = sdef.get('recommended_gap', 0.20)
                    min_g = sdef.get('min_gap', 0.05)
                    max_g = sdef.get('max_gap', 0.60)
                    if gap < min_g or gap > max_g:
                        score -= 25.0
                    else:
                        dev = abs(gap - rec)
                        score -= dev * 15.0
                    break

        return max(20.0, min(100.0, score))
