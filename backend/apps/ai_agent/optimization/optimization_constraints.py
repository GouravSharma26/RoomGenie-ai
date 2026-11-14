"""
Fast Constraint Evaluation and Spatial Physics for RoomGenie AI (Phase 7.2).
Provides high-efficiency verification of 3D OBB collisions, parametric polygon
containment, penetration vectors, and doorway buffer clearances.
"""

import math
from typing import Any, Dict, List, Optional, Set, Tuple
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.sockets import (
    check_doorway_landing_clearance,
    check_obb_collisions_3d,
    is_point_in_polygon_2d,
    validate_room_footprint_containment,
)


def point_line_segment_distance_and_closest(
    px: float, pz: float,
    x1: float, z1: float,
    x2: float, z2: float,
) -> Tuple[float, float, float]:
    """
    Computes Euclidean distance from (px, pz) to line segment (x1, z1)-(x2, z2),
    and returns (distance, closest_x, closest_z).
    """
    dx = x2 - x1
    dz = z2 - z1
    seg_len_sq = dx * dx + dz * dz
    if seg_len_sq < 1e-9:
        return math.hypot(px - x1, pz - z1), x1, z1

    t = max(0.0, min(1.0, ((px - x1) * dx + (pz - z1) * dz) / seg_len_sq))
    closest_x = x1 + t * dx
    closest_z = z1 + t * dz
    dist = math.hypot(px - closest_x, pz - closest_z)
    return dist, closest_x, closest_z


class ConstraintEvaluator:
    """
    Evaluates hard spatial constraints and extracts geometric recovery vectors.
    """

    @staticmethod
    def evaluate_state(state: CandidateSceneState) -> Dict[str, Any]:
        """
        Runs comprehensive physical checks on the candidate state.
        Returns detailed diagnostic dictionary.
        """
        room_dict = state.room
        objects = state.objects
        relationships = state.relationships
        polygon = state.room_polygon

        # Build exempt attached pairs
        attached_pairs: Set[Tuple[str, str]] = set()
        for rel in relationships:
            a_id = rel.get('anchorObjectId')
            c_id = rel.get('childObjectId')
            if a_id and c_id:
                attached_pairs.add((a_id, c_id))
                attached_pairs.add((c_id, a_id))

        boundary_violations: List[Dict[str, Any]] = []
        fatal_errors: List[str] = []

        # 1. Boundary & Polygon Containment
        for obj in objects:
            oid = str(obj.get('id', ''))
            oname = str(obj.get('name', oid))
            raw_v = validate_room_footprint_containment(obj, room_dict)
            if raw_v:
                fatal_errors.append(f"Item '{oname}' violates room boundary: {'; '.join(raw_v)}")
                # Compute penetration push vector
                corners = state.get_object_corners_2d(oid)
                outside_corners: List[Tuple[float, float]] = []
                max_outside_dist = 0.0
                push_dx = 0.0
                push_dz = 0.0

                if polygon and len(polygon) >= 3:
                    for cx, cz in corners:
                        if not is_point_in_polygon_2d((cx, cz), polygon, tolerance=0.01):
                            outside_corners.append((cx, cz))
                            # Find closest edge on polygon
                            n_poly = len(polygon)
                            min_edge_dist = float('inf')
                            best_cx, best_cz = cx, cz
                            for e_idx in range(n_poly):
                                p1 = polygon[e_idx]
                                p2 = polygon[(e_idx + 1) % n_poly]
                                dist, cl_x, cl_z = point_line_segment_distance_and_closest(
                                    cx, cz, p1[0], p1[1], p2[0], p2[1]
                                )
                                if dist < min_edge_dist:
                                    min_edge_dist = dist
                                    best_cx, best_cz = cl_x, cl_z
                            if min_edge_dist > max_outside_dist:
                                max_outside_dist = min_edge_dist
                                push_dx += (best_cx - cx)
                                push_dz += (best_cz - cz)
                else:
                    # Rectangular room containment push
                    half_w = state.room_width / 2.0
                    half_l = state.room_length / 2.0
                    for cx, cz in corners:
                        if cx < -half_w:
                            push_dx += (-half_w - cx)
                            max_outside_dist = max(max_outside_dist, abs(-half_w - cx))
                        elif cx > half_w:
                            push_dx += (half_w - cx)
                            max_outside_dist = max(max_outside_dist, abs(half_w - cx))
                        if cz < -half_l:
                            push_dz += (-half_l - cz)
                            max_outside_dist = max(max_outside_dist, abs(-half_l - cz))
                        elif cz > half_l:
                            push_dz += (half_l - cz)
                            max_outside_dist = max(max_outside_dist, abs(half_l - cz))

                boundary_violations.append({
                    'object_id': oid,
                    'name': oname,
                    'outside_count': len(outside_corners),
                    'max_penetration': max_outside_dist,
                    'push_vector': (push_dx, push_dz),
                })

        # 2. Inter-object 3D OBB Collisions
        collisions: List[Tuple[str, str]] = []
        collision_details: List[Dict[str, Any]] = []
        n_objs = len(objects)
        for i in range(n_objs):
            for j in range(i + 1, n_objs):
                obj_a = objects[i]
                obj_b = objects[j]
                id_a = str(obj_a.get('id', ''))
                id_b = str(obj_b.get('id', ''))
                if (id_a, id_b) in attached_pairs:
                    continue
                if check_obb_collisions_3d(obj_a, obj_b):
                    collisions.append((id_a, id_b))
                    name_a = str(obj_a.get('name', id_a))
                    name_b = str(obj_b.get('name', id_b))
                    fatal_errors.append(f"Item '{name_a}' physically collides with '{name_b}'.")
                    # Calculate separation vector between centers
                    pos_a = obj_a.get('position', [0, 0, 0])
                    pos_b = obj_b.get('position', [0, 0, 0])
                    sep_dx = pos_a[0] - pos_b[0]
                    sep_dz = pos_a[2] - pos_b[2]
                    norm = math.hypot(sep_dx, sep_dz)
                    if norm < 1e-4:
                        sep_dx, sep_dz = 0.2, 0.0
                    else:
                        sep_dx /= norm
                        sep_dz /= norm
                    collision_details.append({
                        'pair': (id_a, id_b),
                        'separation_direction': (sep_dx, sep_dz),
                    })

        # 3. Doorway Circulation Clearance
        door_violations: List[Dict[str, Any]] = []
        for obj in objects:
            oid = str(obj.get('id', ''))
            oname = str(obj.get('name', oid))
            d_issues = check_doorway_landing_clearance(obj, room_dict)
            if d_issues:
                fatal_errors.append(f"Item '{oname}' blocks door circulation: {'; '.join(d_issues)}")
                door_violations.append({
                    'object_id': oid,
                    'name': oname,
                    'issues': d_issues,
                })

        is_valid = (len(boundary_violations) == 0 and len(collisions) == 0 and len(door_violations) == 0)

        return {
            'is_valid': is_valid,
            'is_approval_eligible': is_valid,
            'boundary_violations': boundary_violations,
            'collisions': collisions,
            'collision_details': collision_details,
            'door_violations': door_violations,
            'fatal_errors': fatal_errors,
        }

