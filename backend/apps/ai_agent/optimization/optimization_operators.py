"""
Spatial Optimization Operators for RoomGenie AI (Phase 7.2).
Implements 10 deterministic geometric and topological mutation operators:
1. repair_boundary
2. repair_collision
3. wall_alignment
4. group_translation
5. group_rotation
6. socket_reassignment
7. zone_relocation
8. perimeter_distribution
9. open_space_recovery
10. clearance_nudge
"""

import copy
import math
import random
from typing import Any, Dict, List, Optional, Set, Tuple
from apps.ai_agent.optimization.optimization_constraints import (
    ConstraintEvaluator,
    point_line_segment_distance_and_closest,
)
from apps.ai_agent.optimization.optimization_state import CandidateSceneState
from apps.ai_agent.sockets import (
    CANONICAL_SOCKET_DEFINITIONS,
    compute_child_transform_from_socket,
    check_obb_collisions_3d,
    validate_room_footprint_containment,
)


def recalculate_child_transform(
    anchor_obj: Dict[str, Any],
    child_obj: Dict[str, Any],
    socket_id: str,
    desired_gap: float,
) -> Optional[Dict[str, Any]]:
    sdef = None
    for s in CANONICAL_SOCKET_DEFINITIONS:
        if s['id'] == socket_id:
            sdef = s
            break
    if not sdef:
        return None
    a_pos = anchor_obj.get('position', [0.0, 0.0, 0.0])
    a_rot = anchor_obj.get('rotationEuler', [0.0, 0.0, 0.0])
    a_yaw = a_rot[1] if len(a_rot) > 1 else 0.0
    a_dims = anchor_obj.get('dimensions', [1.0, 1.0, 1.0])
    a_scale = anchor_obj.get('scale', [1.0, 1.0, 1.0])
    c_dims = child_obj.get('dimensions', [1.0, 1.0, 1.0])
    c_scale = child_obj.get('scale', [1.0, 1.0, 1.0])
    return compute_child_transform_from_socket(
        anchor_pos=a_pos,
        anchor_yaw=a_yaw,
        anchor_dims=a_dims,
        anchor_scale=a_scale,
        child_dims=c_dims,
        child_scale=c_scale,
        socket_def=sdef,
        desired_gap=desired_gap,
    )


class OptimizationOperators:
    """
    Collection of deterministic spatial mutation and repair operators.
    """

    @staticmethod
    def op_repair_boundary(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 1: Identifies objects breaching room boundary or polygon footprint,
        and pushes them inward along the penetration normal or toward room centroid.
        """
        eval_res = ConstraintEvaluator.evaluate_state(state)
        b_viols = eval_res.get('boundary_violations', [])
        if not b_viols:
            return False, "No boundary violations to repair"

        changed = False
        half_w = state.room_width / 2.0 - 0.05
        half_l = state.room_length / 2.0 - 0.05
        polygon = state.room_polygon

        for viol in b_viols:
            oid = viol['object_id']
            obj = state.get_object(oid)
            if not obj:
                continue

            pos = state.get_object_position(oid)
            if not pos:
                continue

            # Check if this object is part of a functional group
            groups = state.get_functional_groups()
            target_group = None
            for g in groups:
                if oid in g:
                    target_group = g
                    break

            if target_group and len(target_group) > 1:
                # 1. First try compacting socket gaps for attached children in the group
                for rel in state.relationships:
                    c_id = rel.get('childObjectId')
                    if c_id in target_group:
                        sock_id = rel.get('socketId')
                        curr_gap = float(rel.get('gapMeters', 0.15))
                        min_gap = 0.03
                        for s_def in CANONICAL_SOCKET_DEFINITIONS:
                            if s_def['id'] == sock_id:
                                min_gap = s_def.get('min_gap', 0.03)
                                break
                        if curr_gap > min_gap + 0.01:
                            new_gap = max(min_gap, curr_gap - 0.15)
                            rel['gapMeters'] = round(new_gap, 4)
                            a_obj = state.get_object(rel.get('anchorObjectId'))
                            c_obj = state.get_object(c_id)
                            if a_obj and c_obj:
                                recalc = recalculate_child_transform(a_obj, c_obj, sock_id, new_gap)
                                if recalc:
                                    state.set_object_position(c_id, recalc['position'])
                                    state.set_object_yaw(c_id, recalc['rotation_euler'][1])
                                    changed = True

                # 2. Check if group bounding box exceeds room dimension and rotate if longer along other axis
                all_corners = [c for gid in target_group for c in state.get_object_corners_2d(gid)]
                if all_corners:
                    g_min_x = min(c[0] for c in all_corners)
                    g_max_x = max(c[0] for c in all_corners)
                    g_min_z = min(c[1] for c in all_corners)
                    g_max_z = max(c[1] for c in all_corners)
                    gw = g_max_x - g_min_x
                    gl = g_max_z - g_min_z

                    if gw > state.room_width - 0.10 and state.room_length >= gw + 0.20:
                        # Rotate group 90 degrees to fit along room length
                        state.rotate_group(target_group, math.pi / 2.0)
                        changed = True
                        # Recalculate corners after rotation
                        all_corners = [c for gid in target_group for c in state.get_object_corners_2d(gid)]
                        g_min_x = min(c[0] for c in all_corners)
                        g_max_x = max(c[0] for c in all_corners)
                        g_min_z = min(c[1] for c in all_corners)
                        g_max_z = max(c[1] for c in all_corners)

                    # Translate group inside rectangular bounds
                    shift_x = 0.0
                    shift_z = 0.0
                    if g_min_x < -half_w:
                        shift_x = -half_w - g_min_x
                    elif g_max_x > half_w:
                        shift_x = half_w - g_max_x
                    if g_min_z < -half_l:
                        shift_z = -half_l - g_min_z
                    elif g_max_z > half_l:
                        shift_z = half_l - g_max_z

                    # Bounded displacement check: do not teleport items across the universe
                    MAX_REPAIR_DISP = 0.80
                    if abs(shift_x) > MAX_REPAIR_DISP or abs(shift_z) > MAX_REPAIR_DISP:
                        continue

                    if abs(shift_x) > 1e-4 or abs(shift_z) > 1e-4:
                        state.translate_group(target_group, shift_x, shift_z)
                        changed = True

                    # For parametric polygon rooms, push group along edge inward penetration normal
                    if polygon and len(polygon) >= 3:
                        pv = viol.get('push_vector', (0.0, 0.0))
                        pv_norm = math.hypot(pv[0], pv[1])
                        c_corners = state.get_object_corners_2d(oid)
                        from apps.ai_agent.sockets import is_point_in_polygon_2d
                        if any(not is_point_in_polygon_2d(c, polygon, 0.01) for c in c_corners):
                            if pv_norm > 1e-3 and viol.get('max_penetration', 0.20) <= MAX_REPAIR_DISP:
                                step = viol.get('max_penetration', 0.20) + 0.12
                                state.translate_group(target_group, (pv[0] / pv_norm) * step, (pv[1] / pv_norm) * step)
                                changed = True
                    continue

            # Standalone or single item: clamp directly
            corners = state.get_object_corners_2d(oid)
            if corners:
                c_min_x = min(c[0] for c in corners)
                c_max_x = max(c[0] for c in corners)
                c_min_z = min(c[1] for c in corners)
                c_max_z = max(c[1] for c in corners)

                shift_x = 0.0
                shift_z = 0.0
                if c_min_x < -half_w:
                    shift_x = -half_w - c_min_x
                elif c_max_x > half_w:
                    shift_x = half_w - c_max_x
                if c_min_z < -half_l:
                    shift_z = -half_l - c_min_z
                elif c_max_z > half_l:
                    shift_z = half_l - c_max_z

                # Bounded displacement check: do not teleport items across the universe
                MAX_REPAIR_DISP = 0.80
                if abs(shift_x) > MAX_REPAIR_DISP or abs(shift_z) > MAX_REPAIR_DISP:
                    continue

                if abs(shift_x) > 1e-4 or abs(shift_z) > 1e-4:
                    state.translate_object(oid, shift_x, shift_z)
                    changed = True

                # For parametric polygon, push along edge inward penetration normal
                if polygon and len(polygon) >= 3:
                    pv = viol.get('push_vector', (0.0, 0.0))
                    pv_norm = math.hypot(pv[0], pv[1])
                    from apps.ai_agent.sockets import is_point_in_polygon_2d
                    if any(not is_point_in_polygon_2d(c, polygon, 0.01) for c in state.get_object_corners_2d(oid)):
                        if pv_norm > 1e-3 and viol.get('max_penetration', 0.20) <= MAX_REPAIR_DISP:
                            step = viol.get('max_penetration', 0.20) + 0.12
                            state.translate_object(oid, (pv[0] / pv_norm) * step, (pv[1] / pv_norm) * step)
                            changed = True

        return changed, "Repaired boundary penetration" if changed else "No boundary repair applied"

    @staticmethod
    def op_repair_collision(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 2: Identifies colliding 3D OBB pairs and applies repulsive separation.
        Follows strict deterministic resolution policy (Architectural Issue 2):
        1. Identify colliding pair and minimum separation direction.
        2. Detect concentric duplicates (< 0.15m separation) - reject if unrepairable.
        3. Check semantic groups: prefer moving independent item over breaking group.
        4. Move group atomically when attached group must move.
        5. Revalidate and rollback if repair introduces new hard violations.
        """
        eval_res = ConstraintEvaluator.evaluate_state(state)
        coll_details = eval_res.get('collision_details', [])
        if not coll_details:
            return False, "No collisions to repair"

        changed = False
        groups = state.get_functional_groups()

        for c in coll_details:
            id_a, id_b = c['pair']
            sep_dir = c.get('separation_direction', (0.1, 0.0))

            obj_a = state.get_object(id_a)
            obj_b = state.get_object(id_b)
            if not obj_a or not obj_b:
                continue

            pos_a = state.get_object_position(id_a)
            pos_b = state.get_object_position(id_b)
            if not pos_a or not pos_b:
                continue

            # Detect duplicate placements (identical item placed directly on top of itself)
            center_dist = math.hypot(pos_a[0] - pos_b[0], pos_a[2] - pos_b[2])
            if obj_a.get('assetId') == obj_b.get('assetId') and center_dist < 0.10:
                # Identical duplicate placement cannot be separated within local displacement
                continue

            # Check if one of them is an attached child
            child_rel = None
            child_id = None
            for rel in state.relationships:
                if rel.get('childObjectId') in (id_a, id_b):
                    child_rel = rel
                    child_id = rel.get('childObjectId')
                    break

            if child_rel and child_id:
                # Adjust child gap within permissible limits
                curr_gap = float(child_rel.get('gapMeters', 0.20))
                anchor_id = child_rel.get('anchorObjectId')
                sock_id = child_rel.get('socketId')
                new_gap = curr_gap + 0.08
                anchor_obj = state.get_object(anchor_id)
                child_obj = state.get_object(child_id)
                if anchor_obj and child_obj:
                    recalc = recalculate_child_transform(anchor_obj, child_obj, sock_id, new_gap)
                    if recalc:
                        state.set_object_position(child_id, recalc['position'])
                        state.set_object_yaw(child_id, recalc['rotation_euler'][1])
                        child_rel['gapMeters'] = round(new_gap, 4)
                        changed = True
                        continue

            # Identify group membership for atomic movement
            grp_a = next((g for g in groups if id_a in g), None)
            grp_b = next((g for g in groups if id_b in g), None)

            sd_len = math.hypot(sep_dir[0], sep_dir[1])
            u_dir = (sep_dir[0] / sd_len, sep_dir[1] / sd_len) if sd_len > 1e-4 else (1.0, 0.0)
            step = 0.20
            dx = u_dir[0] * step
            dz = u_dir[1] * step

            # Clone backup in case separation increases hard violations
            backup_state = state.clone()

            if grp_a and not grp_b:
                # Move independent object b alone
                state.translate_object(id_b, -dx, -dz)
            elif grp_b and not grp_a:
                # Move independent object a alone
                state.translate_object(id_a, dx, dz)
            elif grp_a and grp_b:
                # Both belong to groups: move groups atomically
                state.translate_group(grp_a, dx * 0.5, dz * 0.5)
                state.translate_group(grp_b, -dx * 0.5, -dz * 0.5)
            else:
                # Both independent: deterministic tie-breaking by ID
                if str(id_a) < str(id_b):
                    state.translate_object(id_a, dx * 0.5, dz * 0.5)
                    state.translate_object(id_b, -dx * 0.5, -dz * 0.5)
                else:
                    state.translate_object(id_a, -dx * 0.5, -dz * 0.5)
                    state.translate_object(id_b, dx * 0.5, dz * 0.5)

            # Rollback check: ensure separation did not increase hard violations
            post_eval = ConstraintEvaluator.evaluate_state(state)
            if len(post_eval.get('boundary_violations', [])) > len(eval_res.get('boundary_violations', [])):
                # Rollback! Separation breached boundary
                state.scene = copy.deepcopy(backup_state.scene)
                state.actions = copy.deepcopy(backup_state.actions)
            else:
                changed = True

        return changed, "Separated colliding objects" if changed else "No collision repair applied"

    @staticmethod
    def op_wall_alignment(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 3: Snaps the back face of perimeter furniture (beds, sofas, desks, storage)
        parallel to the nearest wall segment with clearance margin.
        """
        # Find candidate perimeter furniture
        perimeter_assets = {'bed', 'sofa', 'desk', 'wardrobe', 'bookshelf', 'storage', 'cabinet'}
        candidates = []
        for obj in state.objects:
            aid = str(obj.get('assetId', '')).lower()
            name = str(obj.get('name', '')).lower()
            if any(p in aid or p in name for p in perimeter_assets):
                candidates.append(obj.get('id'))

        if not candidates:
            return False, "No perimeter furniture found"

        target_id = rng.choice(candidates)
        obj = state.get_object(target_id)
        if not obj:
            return False, "Target object not found"

        pos = state.get_object_position(target_id)
        if not pos:
            return False, "Target has no position"

        walls = state.walls
        wall_clearance = 0.08

        if walls:
            # Find closest wall
            closest_wall = None
            min_dist = float('inf')
            best_angle = 0.0
            for w in walls:
                sp = w.get('startPoint', [0, 0])
                ep = w.get('endPoint', [0, 0])
                dist, cl_x, cl_z = point_line_segment_distance_and_closest(
                    pos[0], pos[2], sp[0], sp[1], ep[0], ep[1]
                )
                if dist < min_dist:
                    min_dist = dist
                    closest_wall = w
                    # Wall direction angle
                    w_dx = ep[0] - sp[0]
                    w_dz = ep[1] - sp[1]
                    # Angle of wall normal (facing into the room)
                    wall_angle = math.atan2(w_dz, w_dx)
                    # Perpendicular inward normal
                    best_angle = wall_angle + math.pi / 2.0

            if closest_wall:
                state.set_object_yaw(target_id, best_angle)
                return True, f"Aligned '{obj.get('name')}' to nearest wall segment"

        # Fallback for rectangular rooms: snap yaw to 0, 90, 180, or 270 degrees
        discrete_yaws = [0.0, math.pi / 2.0, math.pi, -math.pi / 2.0]
        curr_yaw = state.get_object_yaw(target_id)
        # Find closest cardinal yaw
        best_yaw = min(discrete_yaws, key=lambda y: abs((y - curr_yaw + math.pi) % (2 * math.pi) - math.pi))
        state.set_object_yaw(target_id, best_yaw)
        return True, f"Snapped '{obj.get('name')}' to cardinal wall orientation"

    @staticmethod
    def op_group_translation(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 4: Translates an entire functional cluster together, preserving relative socket offsets.
        """
        groups = state.get_functional_groups()
        if not groups:
            return False, "No groups to translate"

        group = rng.choice(groups)
        dx = rng.choice([-0.20, -0.10, 0.10, 0.20])
        dz = rng.choice([-0.20, -0.10, 0.10, 0.20])

        state.translate_group(group, dx, dz)
        return True, f"Translated group of {len(group)} items by ({dx:.2f}m, {dz:.2f}m)"

    @staticmethod
    def op_group_rotation(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 5: Rotates an entire functional group around its anchor or centroid by 90 or 180 degrees.
        """
        groups = state.get_functional_groups()
        if not groups:
            return False, "No groups to rotate"

        # Prefer groups with >1 item or anchor item
        multi_groups = [g for g in groups if len(g) > 1]
        target_group = rng.choice(multi_groups) if multi_groups else rng.choice(groups)

        angle = rng.choice([math.pi / 2.0, -math.pi / 2.0, math.pi])
        state.rotate_group(target_group, angle)
        return True, f"Rotated group of {len(target_group)} items by {math.degrees(angle):.0f}°"

    @staticmethod
    def op_socket_reassignment(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 6: Modifies socket gap distance within allowable range [min_gap, max_gap]
        or alters socket attachment parameters.
        """
        rels = state.relationships
        if not rels:
            return False, "No socket relationships present"

        rel = rng.choice(rels)
        sock_id = rel.get('socketId')
        anchor_id = rel.get('anchorObjectId')
        child_id = rel.get('childObjectId')

        # Find socket definition
        target_sdef = None
        for sdef in CANONICAL_SOCKET_DEFINITIONS:
            if sdef['id'] == sock_id:
                target_sdef = sdef
                break

        if not target_sdef:
            return False, "Socket definition not found"

        min_gap = target_sdef.get('min_gap', 0.05)
        max_gap = target_sdef.get('max_gap', 0.60)
        curr_gap = float(rel.get('gapMeters', target_sdef.get('recommended_gap', 0.20)))

        # Choose a new gap within allowable limits
        possible_gaps = [
            min_gap,
            (min_gap + target_sdef.get('recommended_gap', 0.20)) / 2.0,
            target_sdef.get('recommended_gap', 0.20),
            max_gap,
        ]
        new_gap = rng.choice([g for g in possible_gaps if abs(g - curr_gap) > 0.02] or possible_gaps)

        rel['gapMeters'] = round(new_gap, 4)
        anchor_obj = state.get_object(anchor_id)
        child_obj = state.get_object(child_id)
        if anchor_obj and child_obj:
            recalc = recalculate_child_transform(anchor_obj, child_obj, sock_id, new_gap)
            if recalc:
                state.set_object_position(child_id, recalc['position'])
                state.set_object_yaw(child_id, recalc['rotation_euler'][1])
                return True, f"Adjusted socket '{sock_id}' gap to {new_gap:.2f}m"

        return False, "Socket recalculation failed"

    @staticmethod
    def op_zone_relocation(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 7: Moves a functional group to an alternate room quadrant.
        """
        groups = state.get_functional_groups()
        if not groups:
            return False, "No groups to relocate"

        target_group = rng.choice(groups)
        half_w = state.room_width * 0.25
        half_l = state.room_length * 0.25

        quadrant_offsets = [
            (-half_w, -half_l),
            (half_w, -half_l),
            (half_w, half_l),
            (-half_w, half_l),
        ]
        dx, dz = rng.choice(quadrant_offsets)
        state.translate_group(target_group, dx * 0.4, dz * 0.4)
        return True, f"Relocated zone to alternate room quadrant ({dx * 0.4:+.2f}m, {dz * 0.4:+.2f}m)"

    @staticmethod
    def op_perimeter_distribution(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 8: Distributes secondary storage and accent pieces along unobstructed wall spans.
        """
        # Find secondary pieces not anchored
        anchored_ids = {rel.get('childObjectId') for rel in state.relationships}
        anchor_ids = {rel.get('anchorObjectId') for rel in state.relationships}
        standalone = [
            obj['id'] for obj in state.objects
            if obj['id'] not in anchored_ids and obj['id'] not in anchor_ids
        ]

        if not standalone:
            return False, "No standalone pieces for perimeter distribution"

        target_id = rng.choice(standalone)
        half_w = state.room_width / 2.0 - 0.50
        half_l = state.room_length / 2.0 - 0.50

        # Choose one of the 4 perimeter walls
        wall_slot = rng.choice(['north', 'south', 'east', 'west'])
        if wall_slot == 'north':
            new_pos = [rng.uniform(-half_w * 0.6, half_w * 0.6), 0.0, half_l]
            new_yaw = math.pi
        elif wall_slot == 'south':
            new_pos = [rng.uniform(-half_w * 0.6, half_w * 0.6), 0.0, -half_l]
            new_yaw = 0.0
        elif wall_slot == 'east':
            new_pos = [half_w, 0.0, rng.uniform(-half_l * 0.6, half_l * 0.6)]
            new_yaw = -math.pi / 2.0
        else:
            new_pos = [-half_w, 0.0, rng.uniform(-half_l * 0.6, half_l * 0.6)]
            new_yaw = math.pi / 2.0

        curr_pos = state.get_object_position(target_id)
        if curr_pos:
            new_pos[1] = curr_pos[1]
            state.set_object_position(target_id, new_pos)
            state.set_object_yaw(target_id, new_yaw)
            return True, f"Distributed item '{target_id}' along {wall_slot} perimeter wall"

        return False, "Position not set"

    @staticmethod
    def op_open_space_recovery(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 9: Pushes non-central pieces outward away from room center of mass
        to maximize central contiguous walkable floor space.
        """
        changed = False
        for obj in state.objects:
            oid = obj.get('id')
            pos = state.get_object_position(oid)
            if not pos:
                continue

            dist_from_center = math.hypot(pos[0], pos[2])
            # If item is close to room center (< 1.2m), push outward
            if dist_from_center < 1.2:
                if dist_from_center < 1e-3:
                    push_x, push_z = 0.2, 0.0
                else:
                    push_x = (pos[0] / dist_from_center) * 0.20
                    push_z = (pos[2] / dist_from_center) * 0.20

                state.translate_object(oid, push_x, push_z)
                changed = True

        return changed, "Expanded central open space" if changed else "Central space already clear"

    @staticmethod
    def op_clearance_nudge(state: CandidateSceneState, rng: random.Random) -> Tuple[bool, str]:
        """
        Operator 10: Local micro-perturbation (±0.04m to ±0.12m) to resolve tight clearance conflicts.
        """
        if not state.objects:
            return False, "No objects to nudge"

        obj = rng.choice(state.objects)
        oid = obj.get('id')
        step = rng.choice([0.04, 0.08, -0.04, -0.08])
        axis = rng.choice(['x', 'z'])

        dx = step if axis == 'x' else 0.0
        dz = step if axis == 'z' else 0.0

        state.translate_object(oid, dx, dz)
        return True, f"Micro-nudged '{obj.get('name')}' by {step:+.2f}m along {axis.upper()}"
