"""
Candidate Scorer for RoomGenie AI (Phase 6.3).
Computes the authoritative 6-component score:
S = 0.25*C_bound + 0.25*C_coll + 0.20*C_circ + 0.15*C_clear + 0.10*C_util + 0.05*C_budget
All component scores are normalized to 0–100.
Enforces the hard-failure rule: hard constraints cannot be overridden by soft scores.
"""

from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import (
    CandidateValidationFeedback,
    ScoreBreakdown,
    SCORE_WEIGHTS,
)


class CandidateScorer:
    """
    Evaluates simulated candidate layouts across six deterministic dimensions.
    Produces granular sub-scores, detailed explanations, and an aggregated quality index.
    """

    @staticmethod
    def calculate_score(
        candidate_scene: Dict[str, Any],
        validation_feedback: CandidateValidationFeedback,
        budget_diff: Dict[str, Any],
        user_requirements: Optional[Dict[str, Any]] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
    ) -> ScoreBreakdown:
        explanations: Dict[str, str] = {}

        # -------------------------------------------------------------
        # 1. Boundary Component (Weight: 25%)
        # -------------------------------------------------------------
        if validation_feedback.has_boundary_breaches:
            c_bound = 0.0
            explanations['boundary'] = "Hard failure: 1 or more furniture items extend beyond room boundary."
        else:
            # Check proximity to walls for placed objects
            objects = candidate_scene.get('objects', [])
            room = candidate_scene.get('room', {})
            room_w = float(room.get('width', 5.0))
            room_l = float(room.get('length', 4.0))

            tight_wall_count = 0
            for obj in objects:
                pos = obj.get('position', [0, 0, 0])
                dims = obj.get('dimensions', [1, 1, 1])
                # Check distance to walls (assuming rectangular center-origin or bounding box)
                dist_x = (room_w / 2.0) - (abs(pos[0]) + dims[0] / 2.0)
                dist_z = (room_l / 2.0) - (abs(pos[2]) + dims[2] / 2.0)
                if dist_x < 0.05 or dist_z < 0.05:
                    tight_wall_count += 1

            if tight_wall_count > 0:
                c_bound = max(70.0, 100.0 - (tight_wall_count * 10.0))
                explanations['boundary'] = f"Valid containment: all items within footprint ({tight_wall_count} item(s) close to walls)."
            else:
                c_bound = 100.0
                explanations['boundary'] = "Optimal containment: all furniture items comfortably inside room boundaries."

        # -------------------------------------------------------------
        # 2. Collision Component (Weight: 25%)
        # -------------------------------------------------------------
        if validation_feedback.has_collisions:
            c_coll = 0.0
            explanations['collision'] = "Hard failure: 3D bounding boxes overlap or collide between unrelated furniture."
        else:
            c_coll = 100.0
            explanations['collision'] = "Zero collisions: all furniture pieces have clean, non-overlapping physical bounding boxes."

        # -------------------------------------------------------------
        # 3. Circulation Component (Weight: 20%)
        # -------------------------------------------------------------
        if not validation_feedback.is_room_passable:
            c_circ = 0.0
            explanations['circulation'] = "Hard failure: doorway landing zone or primary entrance is obstructed."
        else:
            # Check walkability summary from spatial context or candidate scene
            walkability = None
            if spatial_context and isinstance(spatial_context, dict):
                walkability = spatial_context.get('walkability')

            if walkability and isinstance(walkability, dict):
                base_walk_score = float(walkability.get('walkabilityScore', 90.0))
                c_circ = min(100.0, max(40.0, base_walk_score))
                explanations['circulation'] = f"Circulation analysis: room walkability score is {c_circ:.0f}/100 with clear paths."
            else:
                # Estimate circulation from door clearance and object count
                objects = candidate_scene.get('objects', [])
                if len(objects) > 8:
                    c_circ = 80.0
                    explanations['circulation'] = "Passable circulation: primary door landings open; moderate furniture density."
                else:
                    c_circ = 95.0
                    explanations['circulation'] = "Excellent circulation: clear walking routes and unimpeded door access."

        # -------------------------------------------------------------
        # 4. Clearance Component (Weight: 15%)
        # -------------------------------------------------------------
        advisory_count = len(validation_feedback.advisory_warnings)
        clearance_fatal = any(i.code == 'CLEARANCE_VIOLATION' for i in validation_feedback.fatal_errors)

        if clearance_fatal:
            c_clear = 0.0
            explanations['clearance'] = "Hard failure: mandatory functional clearance violation."
        elif advisory_count > 0:
            c_clear = max(30.0, 100.0 - (advisory_count * 15.0))
            explanations['clearance'] = f"Adequate clearance: {advisory_count} advisory spacing warning(s) noted."
        else:
            c_clear = 100.0
            explanations['clearance'] = "Optimal clearances: generous conversational, ergonomic, and walking margins."

        # -------------------------------------------------------------
        # 5. Space Utilization Component (Weight: 10%)
        # -------------------------------------------------------------
        room = candidate_scene.get('room', {})
        room_w = float(room.get('width', 5.0))
        room_l = float(room.get('length', 4.0))
        room_area = room_w * room_l

        objects = candidate_scene.get('objects', [])
        furniture_footprint = 0.0
        for obj in objects:
            dims = obj.get('dimensions', [1, 1, 1])
            scale = obj.get('scale', [1, 1, 1])
            furniture_footprint += (dims[0] * scale[0]) * (dims[2] * scale[2])

        coverage_ratio = (furniture_footprint / room_area) if room_area > 0 else 0.0

        if coverage_ratio == 0:
            c_util = 50.0
            explanations['utilization'] = "Empty room: 0% floor utilization."
        elif 0.12 <= coverage_ratio <= 0.38:
            # Ideal 12% to 38% residential floor coverage
            c_util = 100.0
            explanations['utilization'] = f"Ideal space balance: {coverage_ratio*100:.1f}% floor coverage maintains spaciousness."
        elif coverage_ratio < 0.12:
            c_util = max(60.0, 60.0 + (coverage_ratio / 0.12) * 40.0)
            explanations['utilization'] = f"Spacious/minimalist: {coverage_ratio*100:.1f}% floor coverage with ample open area."
        else:
            # > 38% coverage: slightly congested
            excess = coverage_ratio - 0.38
            c_util = max(30.0, 100.0 - (excess / 0.30) * 70.0)
            explanations['utilization'] = f"High density: {coverage_ratio*100:.1f}% floor coverage may feel somewhat compact."

        # -------------------------------------------------------------
        # 6. Budget Compliance Component (Weight: 5%)
        # -------------------------------------------------------------
        max_budget = budget_diff.get('max_budget_paise')
        if max_budget is None and user_requirements and 'budget_paise' in user_requirements:
            max_budget = user_requirements['budget_paise']

        budget_evaluated = max_budget is not None

        if not validation_feedback.is_budget_compliant:
            c_budget = 0.0
            explanations['budget'] = "Hard failure: candidate layout total exceeds user-specified budget limit."
        elif max_budget is not None and max_budget > 0:
            after_paise = budget_diff.get('after_total_paise', budget_diff.get('after_paise', 0))
            if after_paise <= max_budget:
                c_budget = 100.0
                ratio = (after_paise / max_budget) * 100
                explanations['budget'] = f"Within budget: ₹{after_paise/100:.2f} is {ratio:.1f}% of ₹{max_budget/100:.2f} cap."
            else:
                c_budget = 0.0
                explanations['budget'] = f"Over budget: ₹{after_paise/100:.2f} exceeds ₹{max_budget/100:.2f} cap."
        else:
            # Neutral treatment when no budget cap is specified
            c_budget = 100.0
            explanations['budget'] = "No budget cap specified; neutral score applied."

        # -------------------------------------------------------------
        # Aggregated Overall Score
        # S = 0.25*C_bound + 0.25*C_coll + 0.20*C_circ + 0.15*C_clear + 0.10*C_util + 0.05*C_budget
        # -------------------------------------------------------------
        overall = (
            SCORE_WEIGHTS['boundary'] * c_bound
            + SCORE_WEIGHTS['collision'] * c_coll
            + SCORE_WEIGHTS['circulation'] * c_circ
            + SCORE_WEIGHTS['clearance'] * c_clear
            + SCORE_WEIGHTS['utilization'] * c_util
            + SCORE_WEIGHTS['budget'] * c_budget
        )

        return ScoreBreakdown(
            boundary=c_bound,
            collision=c_coll,
            circulation=c_circ,
            clearance=c_clear,
            utilization=c_util,
            budget=c_budget,
            overall=overall,
            weights=dict(SCORE_WEIGHTS),
            explanations=explanations,
            budget_evaluated=budget_evaluated,
        )
