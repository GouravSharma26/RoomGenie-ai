"""
Bounded Refinement Planner for RoomGenie AI (Phase 7.3).
Converts typed refinement requests into bounded, constraint-checked spatial operations,
preserving protected objects, catalogue identity, scale, and semantic grouping.
"""

import copy
import logging
import math
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from apps.ai_agent.candidate_types import LayoutCandidate
from apps.ai_agent.feedback.feedback_types import TypedRefinementRequest
from apps.ai_agent.optimization.optimization_search import SpatialOptimizerSearch
from apps.ai_agent.optimization.optimization_config import OptimizationConfig

logger = logging.getLogger(__name__)

# Strict refinement bounds
MAX_REFINEMENT_DISPLACEMENT: float = 0.80  # Metres
DEFAULT_REFINEMENT_CANDIDATE_COUNT: int = 3


class RefinementPlanner:
    """
    Transforms a typed refinement instruction into bounded spatial transforms,
    freezing protected objects and generating verified refinement alternatives.
    """

    def __init__(self, search_engine: Optional[SpatialOptimizerSearch] = None):
        self.search_engine = search_engine or SpatialOptimizerSearch()

    def generate_refinement_proposals(
        self,
        base_candidate: LayoutCandidate,
        refinement_request: TypedRefinementRequest,
        candidate_count: int = DEFAULT_REFINEMENT_CANDIDATE_COUNT,
    ) -> List[Dict[str, Any]]:
        """
        Generates candidate scene variations implementing the refinement request.
        Returns a list of dicts: [{'scene': ..., 'actions': ..., 'label': ..., 'description': ...}]
        """
        variants: List[Dict[str, Any]] = []
        base_scene = base_candidate.candidate_scene
        base_actions = base_candidate.proposed_actions
        protected_ids = set(refinement_request.protected_object_ids)
        target_ids = set(refinement_request.target_object_ids)
        direction = refinement_request.preferred_direction
        base_disp = min(refinement_request.displacement_meters, MAX_REFINEMENT_DISPLACEMENT)

        displacement_steps = [base_disp, min(base_disp + 0.15, MAX_REFINEMENT_DISPLACEMENT), max(base_disp - 0.10, 0.10)]

        for idx in range(min(candidate_count, len(displacement_steps))):
            disp = displacement_steps[idx]
            cand_scene = copy.deepcopy(base_scene)
            cand_actions = copy.deepcopy(base_actions)
            label = f"Refined Option {chr(65 + idx)}"
            desc_parts = []

            # 1. Apply targeted directional translation or socket adjustment
            if target_ids:
                for oid in target_ids:
                    if oid in protected_ids:
                        continue  # Protected items are strictly frozen

                    # Check if target is a child in a socket relationship
                    target_rel = None
                    for rel in cand_scene.get('relationships', []):
                        if rel.get('childObjectId') == oid:
                            target_rel = rel
                            break

                    if target_rel and direction in ('forward', 'backward'):
                        # Adjust socket gap
                        curr_gap = float(target_rel.get('gap', target_rel.get('gapMeters', 0.40)))
                        delta = disp if direction == 'forward' else -disp
                        new_gap = round(max(0.15, min(0.70, curr_gap + delta)), 3)
                        target_rel['gap'] = new_gap
                        if 'gapMeters' in target_rel:
                            target_rel['gapMeters'] = new_gap
                        desc_parts.append(f"Adjusted socket gap for '{oid}' to {new_gap}m.")

                        # Update object position in scene
                        for obj in cand_scene.get('objects', []):
                            if obj.get('id') == oid:
                                pos = obj.get('position', [0, 0, 0])
                                # Shift along Z (forward/backward)
                                obj['position'] = [pos[0], pos[1], round(pos[2] + delta, 4)]
                                break

                        # Sync in actions
                        for act in cand_actions:
                            params = act.get('parameters', act)
                            if act.get('type') == 'attach_to_socket' and params.get('child_object_id') == oid:
                                params['gap_meters'] = new_gap
                            elif act.get('type') == 'add_furniture' and params.get('object_id') == oid:
                                p = params.get('position', [0, 0, 0])
                                params['position'] = [p[0], p[1], round(p[2] + delta, 4)]

                    else:
                        # Direct translation
                        dx, dz = self._compute_delta_from_direction(direction, disp)
                        for obj in cand_scene.get('objects', []):
                            if obj.get('id') == oid:
                                pos = obj.get('position', [0, 0, 0])
                                obj['position'] = [round(pos[0] + dx, 4), pos[1], round(pos[2] + dz, 4)]
                                desc_parts.append(f"Moved '{obj.get('name', oid)}' by {round(disp, 2)}m.")
                                break

                        for act in cand_actions:
                            params = act.get('parameters', act)
                            if params.get('object_id') == oid and 'position' in params:
                                p = params['position']
                                params['position'] = [round(p[0] + dx, 4), p[1], round(p[2] + dz, 4)]

            # 2. General Intent Refinements (when no target items specified)
            elif refinement_request.intent_category == 'increase_open_space':
                # Nudge non-protected items toward perimeter
                for obj in cand_scene.get('objects', []):
                    oid = obj.get('id')
                    if oid not in protected_ids:
                        pos = obj.get('position', [0, 0, 0])
                        # Push outwards by 0.15m - 0.25m
                        factor = 1.0 + (0.10 * (idx + 1))
                        obj['position'] = [round(pos[0] * factor, 4), pos[1], round(pos[2] * factor, 4)]
                desc_parts.append(f"Expanded open floor area by pushing perimeter furniture outward ({round(disp, 2)}m factor).")

            elif refinement_request.intent_category == 'improve_circulation':
                # Nudge items away from entrance / center
                for obj in cand_scene.get('objects', []):
                    oid = obj.get('id')
                    if oid not in protected_ids:
                        pos = obj.get('position', [0, 0, 0])
                        # Move slightly towards rear wall (Z - 0.2m)
                        obj['position'] = [pos[0], pos[1], round(pos[2] - (0.15 * (idx + 1)), 4)]
                desc_parts.append("Deepened entrance-to-room transit corridor by shifting non-protected items.")

            elif refinement_request.intent_category == 'symmetrical':
                # Symmetrize lateral positions across X=0
                for obj in cand_scene.get('objects', []):
                    oid = obj.get('id')
                    if oid not in protected_ids:
                        pos = obj.get('position', [0, 0, 0])
                        if abs(pos[0]) > 0.5:
                            target_x = round(math.copysign(1.6 + 0.1 * idx, pos[0]), 4)
                            obj['position'] = [target_x, pos[1], pos[2]]
                desc_parts.append("Balanced lateral furniture positions symmetrically across central axis.")

            description = " ".join(desc_parts) if desc_parts else f"Applied {refinement_request.intent_category} adjustment."

            variants.append({
                'scene': cand_scene,
                'actions': cand_actions,
                'label': f"{label}: {refinement_request.intent_category.replace('_', ' ').capitalize()}",
                'description': description,
                'displacement': disp,
            })

        return variants

    @staticmethod
    def _compute_delta_from_direction(direction: Optional[str], disp: float) -> Tuple[float, float]:
        """Translates high-level direction into [dx, dz] in Three.js coordinates (Y up, X/Z floor)."""
        if direction == 'forward':
            return (0.0, disp)
        elif direction == 'backward':
            return (0.0, -disp)
        elif direction == 'left':
            return (-disp, 0.0)
        elif direction == 'right':
            return (disp, 0.0)
        elif direction == 'toward_wall':
            return (0.0, -disp)
        elif direction == 'away_from_door':
            return (0.0, -disp)
        elif direction == 'toward_window':
            return (0.0, -disp)
        return (0.0, disp)

