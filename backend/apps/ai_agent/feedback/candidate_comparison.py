"""
Candidate Comparison Service for RoomGenie AI (Phase 7.3).
Computes exact pairwise spatial differences, metric deltas, socket alterations,
and trade-off distinctions between two or more layout candidates.
"""

import math
from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import LayoutCandidate
from apps.ai_agent.feedback.feedback_types import CandidateComparisonDetail


class CandidateComparisonService:
    """
    Produces deterministic, structured comparisons between layout candidates.
    Calculates exact Euclidean displacements, asset additions/removals, and objective deltas.
    """

    @classmethod
    def compare_candidates(
        cls,
        cand_a: LayoutCandidate,
        cand_b: LayoutCandidate,
    ) -> CandidateComparisonDetail:
        """
        Performs a deep pairwise comparison between Candidate A and Candidate B.
        """
        scene_a = cand_a.candidate_scene or {}
        scene_b = cand_b.candidate_scene or {}

        objs_a = {o.get('id'): o for o in scene_a.get('objects', []) if 'id' in o}
        objs_b = {o.get('id'): o for o in scene_b.get('objects', []) if 'id' in o}

        # 1. Positional displacements for matching objects
        displacements: List[Dict[str, Any]] = []
        common_ids = set(objs_a.keys()) & set(objs_b.keys())
        for oid in sorted(common_ids):
            oa = objs_a[oid]
            ob = objs_b[oid]
            pa = oa.get('position', [0, 0, 0])
            pb = ob.get('position', [0, 0, 0])
            disp = math.hypot(pa[0] - pb[0], pa[2] - pb[2])
            
            ra = oa.get('rotationEuler', [0, 0, 0])
            rb = ob.get('rotationEuler', [0, 0, 0])
            yaw_diff_deg = round(abs(ra[1] - rb[1]) * 180.0 / math.pi, 1)

            if disp >= 0.05 or yaw_diff_deg >= 5.0:
                direction_desc = cls._describe_displacement_vector(pa, pb)
                displacements.append({
                    'object_id': oid,
                    'name': oa.get('name', oid),
                    'asset_id': oa.get('assetId'),
                    'distance_meters': round(disp, 2),
                    'yaw_difference_deg': yaw_diff_deg,
                    'position_a': [round(pa[0], 2), round(pa[2], 2)],
                    'position_b': [round(pb[0], 2), round(pb[2], 2)],
                    'description': f"{oa.get('name', oid)} is shifted {round(disp, 2)}m {direction_desc} in Candidate B.",
                })

        # 2. Asset selection differences
        only_in_a = [objs_a[oid].get('name', oid) for oid in sorted(set(objs_a.keys()) - set(objs_b.keys()))]
        only_in_b = [objs_b[oid].get('name', oid) for oid in sorted(set(objs_b.keys()) - set(objs_a.keys()))]
        asset_diffs = {
            'only_in_candidate_a': only_in_a,
            'only_in_candidate_b': only_in_b,
        }

        # 3. Relationship differences
        rels_a = {f"{r.get('anchorObjectId')}->{r.get('childObjectId')}:{r.get('socketId')}": r for r in scene_a.get('relationships', [])}
        rels_b = {f"{r.get('anchorObjectId')}->{r.get('childObjectId')}:{r.get('socketId')}": r for r in scene_b.get('relationships', [])}
        
        only_rels_a = [f"Socket '{rels_a[k].get('socketId')}' connecting {rels_a[k].get('childObjectId')}" for k in set(rels_a.keys()) - set(rels_b.keys())]
        only_rels_b = [f"Socket '{rels_b[k].get('socketId')}' connecting {rels_b[k].get('childObjectId')}" for k in set(rels_b.keys()) - set(rels_a.keys())]
        relationship_diffs = {
            'only_in_candidate_a': only_rels_a,
            'only_in_candidate_b': only_rels_b,
        }

        # 4. Objective score deltas
        score_a = cand_a.score
        score_b = cand_b.score
        score_delta = score_b.overall - score_a.overall

        objective_deltas = {
            'overall': round(score_b.overall - score_a.overall, 1),
            'circulation': round(score_b.circulation - score_a.circulation, 1),
            'clearance': round(score_b.clearance - score_a.clearance, 1),
            'utilization': round(score_b.utilization - score_a.utilization, 1),
            'boundary': round(score_b.boundary - score_a.boundary, 1),
            'collision': round(score_b.collision - score_a.collision, 1),
            'preference': round(getattr(score_b, 'preference_score', 100.0) - getattr(score_a, 'preference_score', 100.0), 1),
        }

        # 5. Open space delta
        room = scene_a.get('room', {})
        room_w = float(room.get('width', 5.0))
        room_l = float(room.get('length', 4.0))
        room_area = room_w * room_l

        footprint_a = sum(
            (o.get('dimensions', [1, 1, 1])[0] * o.get('scale', [1, 1, 1])[0]) *
            (o.get('dimensions', [1, 1, 1])[2] * o.get('scale', [1, 1, 1])[2])
            for o in objs_a.values()
        )
        footprint_b = sum(
            (o.get('dimensions', [1, 1, 1])[0] * o.get('scale', [1, 1, 1])[0]) *
            (o.get('dimensions', [1, 1, 1])[2] * o.get('scale', [1, 1, 1])[2])
            for o in objs_b.values()
        )
        open_space_delta = footprint_a - footprint_b  # Positive if B has more open space

        # 6. Key trade-offs
        trade_offs = []
        if objective_deltas['circulation'] > 5.0:
            trade_offs.append(f"Candidate B improves circulation transit score by +{objective_deltas['circulation']} pts.")
        elif objective_deltas['circulation'] < -5.0:
            trade_offs.append(f"Candidate A offers clearer circulation pathways (+{abs(objective_deltas['circulation'])} pts over B).")

        if open_space_delta > 0.5:
            trade_offs.append(f"Candidate B leaves {round(open_space_delta, 1)}m² more central floor space open.")
        elif open_space_delta < -0.5:
            trade_offs.append(f"Candidate A leaves {round(abs(open_space_delta), 1)}m² more central floor space open.")

        if objective_deltas['preference'] > 5.0:
            trade_offs.append(f"Candidate B provides stronger alignment with saved user preferences (+{objective_deltas['preference']} pts).")
        elif objective_deltas['preference'] < -5.0:
            trade_offs.append(f"Candidate A matches user preferences more closely (+{abs(objective_deltas['preference'])} pts).")

        # 7. Summary verdict
        if abs(score_delta) < 1.0:
            verdict = "Both candidates achieve nearly identical overall quality scores, differing primarily in layout positioning and furniture grouping."
        elif score_delta > 0:
            verdict = f"Candidate B is rated {round(score_delta, 1)} pts higher overall due to better {'circulation' if objective_deltas['circulation'] > 0 else 'space utilization'}."
        else:
            verdict = f"Candidate A is rated {round(abs(score_delta), 1)} pts higher overall due to better {'circulation' if objective_deltas['circulation'] < 0 else 'clearance'}."

        return CandidateComparisonDetail(
            candidate_a_id=cand_a.id,
            candidate_b_id=cand_b.id,
            score_delta=score_delta,
            position_displacements=displacements,
            asset_differences=asset_diffs,
            relationship_differences=relationship_diffs,
            objective_deltas=objective_deltas,
            circulation_delta=objective_deltas['circulation'],
            open_space_delta_sqm=open_space_delta,
            key_tradeoffs=trade_offs,
            summary_verdict=verdict,
        )

    @staticmethod
    def _describe_displacement_vector(p1: List[float], p2: List[float]) -> str:
        dx = p2[0] - p1[0]
        dz = p2[2] - p1[2]
        desc_parts = []
        if dx > 0.1:
            desc_parts.append("East / Right")
        elif dx < -0.1:
            desc_parts.append("West / Left")
        if dz > 0.1:
            desc_parts.append("South / Toward entrance")
        elif dz < -0.1:
            desc_parts.append("North / Toward rear wall")
        return " & ".join(desc_parts) if desc_parts else "locally"
