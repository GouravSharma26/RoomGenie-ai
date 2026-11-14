import math
import time
from typing import Any

# Authoritative socket definitions for RoomGenie AI furniture catalogue.
# Strictly matches frontend CANONICAL_SOCKET_DEFINITIONS in socketDefinitions.ts.
CANONICAL_SOCKET_DEFINITIONS: list[dict[str, Any]] = [
    # --- Modern 3-Seater Sofa ---
    {
        'id': 'sofa-front-table',
        'name': 'Front Coffee Table',
        'anchor_asset_id': 'sofa-modern-3seater',
        'anchor_category': 'seating',
        'allowed_categories': ['tables'],
        'allowed_asset_tags': ['living-room'],
        'surface_normal': [0.0, 0.0, 1.0],  # Front face (+Z)
        'lateral_ratio': 0.0,               # Centered
        'facing_mode': 'same-direction',
        'base_relative_yaw': 0.0,
        'recommended_gap': 0.45,            # 45cm standard legroom
        'min_gap': 0.30,                    # 30cm minimum knee clearance
        'max_gap': 0.70,                    # 70cm maximum arm reach
    },
    {
        'id': 'sofa-left-accent',
        'name': 'Left Accent Armchair',
        'anchor_asset_id': 'sofa-modern-3seater',
        'anchor_category': 'seating',
        'allowed_categories': ['seating'],
        'allowed_asset_tags': ['accent', 'reading'],
        'surface_normal': [-1.0, 0.0, 0.0],  # Left side face (-X)
        'lateral_ratio': 0.35,               # Shifted forward toward conversation center
        'facing_mode': 'face-anchor',        # Turns to face sofa
        'base_relative_yaw': round(math.pi / 4.0, 4),  # 45 degree angle
        'recommended_gap': 0.50,
        'min_gap': 0.35,
        'max_gap': 1.00,
    },
    {
        'id': 'sofa-right-accent',
        'name': 'Right Accent Armchair',
        'anchor_asset_id': 'sofa-modern-3seater',
        'anchor_category': 'seating',
        'allowed_categories': ['seating'],
        'allowed_asset_tags': ['accent', 'reading'],
        'surface_normal': [1.0, 0.0, 0.0],   # Right side face (+X)
        'lateral_ratio': 0.35,               # Shifted forward toward conversation center
        'facing_mode': 'face-anchor',        # Turns to face sofa
        'base_relative_yaw': round(-math.pi / 4.0, 4),  # -45 degree angle
        'recommended_gap': 0.50,
        'min_gap': 0.35,
        'max_gap': 1.00,
    },

    # --- Nordic Queen Platform Bed ---
    {
        'id': 'bed-left-nightstand',
        'name': 'Left Bedside Nightstand',
        'anchor_asset_id': 'bed-queen-platform',
        'anchor_category': 'beds',
        'allowed_categories': ['tables'],
        'allowed_asset_tags': ['bedroom'],
        'surface_normal': [-1.0, 0.0, 0.0],  # Left side face (-X)
        'lateral_ratio': -0.65,              # Aligned near headboard (-Z in bed local space)
        'facing_mode': 'same-direction',
        'base_relative_yaw': 0.0,
        'recommended_gap': 0.08,             # 8cm bedside gap
        'min_gap': 0.03,                     # 3cm minimum clearance
        'max_gap': 0.35,
    },
    {
        'id': 'bed-right-nightstand',
        'name': 'Right Bedside Nightstand',
        'anchor_asset_id': 'bed-queen-platform',
        'anchor_category': 'beds',
        'allowed_categories': ['tables'],
        'allowed_asset_tags': ['bedroom'],
        'surface_normal': [1.0, 0.0, 0.0],   # Right side face (+X)
        'lateral_ratio': -0.65,              # Aligned near headboard
        'facing_mode': 'same-direction',
        'base_relative_yaw': 0.0,
        'recommended_gap': 0.08,
        'min_gap': 0.03,
        'max_gap': 0.35,
    },

    # --- Ergonomic Study Desk ---
    {
        'id': 'desk-knee-well-chair',
        'name': 'Task / Study Chair',
        'anchor_asset_id': 'desk-workspace-study',
        'anchor_category': 'tables',
        'allowed_categories': ['seating'],
        'allowed_asset_tags': ['workspace', 'accent', 'living-room'],
        'surface_normal': [0.0, 0.0, 1.0],   # Front face (+Z / user side)
        'lateral_ratio': 0.0,                # Centered in knee well
        'facing_mode': 'face-anchor',        # Chair faces toward desk
        'base_relative_yaw': 0.0,
        'recommended_gap': 0.20,             # 20cm pull-out distance
        'min_gap': 0.05,                     # 5cm pushed in
        'max_gap': 0.65,
    },
]


# Fast lookup index by (anchor_asset_id, socket_id)
SOCKET_REGISTRY: dict[tuple[str, str], dict[str, Any]] = {
    (s['anchor_asset_id'], s['id']): s for s in CANONICAL_SOCKET_DEFINITIONS
}


def get_socket_definition(anchor_asset_id: str, socket_id: str) -> dict[str, Any] | None:
    """
    Retrieves authoritative socket definition for given anchor asset and socket ID.
    Supports exact match as well as direct socket ID lookup if asset matches.
    """
    key = (anchor_asset_id, socket_id)
    if key in SOCKET_REGISTRY:
        return SOCKET_REGISTRY[key]
    for s in CANONICAL_SOCKET_DEFINITIONS:
        if s['id'] == socket_id and s['anchor_asset_id'] == anchor_asset_id:
            return s
    return None




def is_compatible_with_socket(
    socket_def: dict[str, Any],
    child_category: str,
    child_tags: list[str] | None = None
) -> tuple[bool, str]:
    """
    Validates semantic category and tag compatibility for a socket.
    Returns (is_compatible, reason_if_invalid).
    """
    allowed_categories = socket_def.get('allowed_categories', [])
    if child_category not in allowed_categories:
        return (
            False,
            f"Category '{child_category}' is not allowed for socket '{socket_def.get('name')}'. "
            f"Allowed categories: {allowed_categories}."
        )

    allowed_tags = socket_def.get('allowed_asset_tags', [])
    if allowed_tags and child_tags:
        # If socket defines allowed style tags, verify overlap
        matching_tags = set(allowed_tags).intersection(set(child_tags))
        if not matching_tags:
            return (
                False,
                f"Item tags {child_tags} do not match socket required style tags {allowed_tags}."
            )

    return (True, "")


def normalize_angle(rad: float) -> float:
    """Computes normalized angle in radians between -pi and +pi."""
    angle = rad % (math.pi * 2.0)
    if angle > math.pi:
        angle -= math.pi * 2.0
    if angle < -math.pi:
        angle += math.pi * 2.0
    return round(angle, 4)


def compute_child_yaw(
    anchor_yaw: float,
    socket_def: dict[str, Any],
    relative_yaw: float = 0.0
) -> float:
    """
    Computes world yaw orientation of child item attached to socket.
    Follows Three.js Euler convention around Y vertical axis.
    """
    nx, _, nz = socket_def['surface_normal']
    outward_angle = math.atan2(nx, nz)
    facing_mode = socket_def.get('facing_mode', 'same-direction')

    if facing_mode == 'same-direction':
        mode_offset = 0.0
    elif facing_mode == 'face-anchor':
        mode_offset = outward_angle + math.pi
    elif facing_mode == 'perpendicular-left':
        mode_offset = math.pi / 2.0
    elif facing_mode == 'perpendicular-right':
        mode_offset = -math.pi / 2.0
    else:
        mode_offset = 0.0

    base_yaw = float(socket_def.get('base_relative_yaw', 0.0))
    total_yaw = anchor_yaw + mode_offset + base_yaw + relative_yaw
    return normalize_angle(total_yaw)


def compute_child_transform_from_socket(
    anchor_pos: list[float],
    anchor_yaw: float,
    anchor_dims: list[float],
    anchor_scale: list[float],
    child_dims: list[float],
    child_scale: list[float],
    socket_def: dict[str, Any],
    desired_gap: float | None = None,
    relative_yaw: float = 0.0,
) -> dict[str, Any]:
    """
    Deterministically computes the world transform (position, rotation, gap)
    for a child item attached to an anchor via a spatial socket.
    Applies gap strictly once between contact surfaces.
    Matches TypeScript computeChildTransformFromSocket exactly.
    """
    min_gap = float(socket_def['min_gap'])
    max_gap = float(socket_def['max_gap'])
    rec_gap = float(socket_def['recommended_gap'])

    if desired_gap is not None and math.isfinite(desired_gap):
        gap = max(min_gap, min(max_gap, float(desired_gap)))
    else:
        gap = rec_gap

    child_yaw = compute_child_yaw(anchor_yaw, socket_def, relative_yaw)
    delta_yaw = child_yaw - anchor_yaw

    # Local anchor surface point
    half_anchor_x = (anchor_dims[0] * anchor_scale[0]) / 2.0
    half_anchor_z = (anchor_dims[2] * anchor_scale[2]) / 2.0
    nx, _, nz = socket_def['surface_normal']
    lat_ratio = float(socket_def.get('lateral_ratio', 0.0))

    px = nx * half_anchor_x
    pz = nz * half_anchor_z
    if abs(nz) > 0.5:
        px += lat_ratio * half_anchor_x
    elif abs(nx) > 0.5:
        pz += lat_ratio * half_anchor_z

    # Child extent along normal direction
    child_half_x = (child_dims[0] * child_scale[0]) / 2.0
    child_half_z = (child_dims[2] * child_scale[2]) / 2.0
    cos_y = abs(math.cos(delta_yaw))
    sin_y = abs(math.sin(delta_yaw))

    if abs(nz) > 0.5:
        child_extent = sin_y * child_half_x + cos_y * child_half_z
    else:
        child_extent = cos_y * child_half_x + sin_y * child_half_z

    # Center offset in anchor local space
    total_offset = gap + child_extent
    local_child_x = px + nx * total_offset
    local_child_z = pz + nz * total_offset

    # Rotate by anchor_yaw around Y
    cos_a = math.cos(anchor_yaw)
    sin_a = math.sin(anchor_yaw)
    world_child_x = anchor_pos[0] + (local_child_x * cos_a + local_child_z * sin_a)
    world_child_z = anchor_pos[2] + (-local_child_x * sin_a + local_child_z * cos_a)
    world_child_y = (child_dims[1] * child_scale[1]) / 2.0  # Floor grounded

    return {
        'position': [round(world_child_x, 4), round(world_child_y, 4), round(world_child_z, 4)],
        'rotation_euler': [0.0, round(child_yaw, 4), 0.0],
        'gap': round(gap, 4),
        'relative_yaw': round(relative_yaw, 4),
    }


def check_relationship_cycle(
    relationships: list[dict[str, Any]],
    potential_child_id: str,
    potential_anchor_id: str
) -> bool:
    """
    Checks whether attaching potential_child_id to potential_anchor_id
    would produce a cycle in the directed relationship graph.
    Returns True if cycle detected.
    """
    if potential_child_id == potential_anchor_id:
        return True

    visited = set()
    queue = [potential_anchor_id]

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)

        for rel in relationships:
            # If current item is a child of another, check its anchor
            if rel.get('childObjectId') == current:
                parent_id = rel.get('anchorObjectId')
                if parent_id == potential_child_id:
                    return True
                if parent_id and parent_id not in visited:
                    queue.append(parent_id)

    return False


# --- Physical Geometry Validators (OBB SAT, Polygon Containment, Door Landing) ---

def get_furniture_corners_2d(
    pos: list[float],
    dims: list[float],
    scale: list[float],
    yaw: float
) -> list[tuple[float, float]]:
    """
    Computes the 4 corners [x, z] of a furniture item's 2D floor footprint in world coordinates.
    """
    half_x = (dims[0] * scale[0]) / 2.0
    half_z = (dims[2] * scale[2]) / 2.0

    cos_y = math.cos(yaw)
    sin_y = math.sin(yaw)

    corners = []
    for dx, dz in [(-half_x, -half_z), (half_x, -half_z), (half_x, half_z), (-half_x, half_z)]:
        wx = pos[0] + (dx * cos_y + dz * sin_y)
        wz = pos[2] + (-dx * sin_y + dz * cos_y)
        corners.append((wx, wz))
    return corners


def is_point_in_polygon_2d(pt: tuple[float, float], polygon: list[list[float]], tolerance: float = 0.01) -> bool:
    """
    Tests if 2D point [x, z] is inside polygon using ray-casting algorithm.
    """
    x, z = pt
    n = len(polygon)
    inside = False

    p1x, p1z = polygon[0][0], polygon[0][1]
    for i in range(n + 1):
        p2x, p2z = polygon[i % n][0], polygon[i % n][1]
        if min(p1z, p2z) - tolerance <= z <= max(p1z, p2z) + tolerance:
            if x <= max(p1x, p2x) + tolerance:
                if p1z != p2z:
                    xinters = (z - p1z) * (p2x - p1x) / (p2z - p1z) + p1x
                    if p1x == p2x or x <= xinters + tolerance:
                        inside = not inside
        p1x, p1z = p2x, p2z

    return inside


def validate_room_footprint_containment(
    placement: dict[str, Any],
    room: dict[str, Any],
    tolerance: float = 0.01
) -> list[str]:
    """
    Validates if placement is completely contained within room boundaries.
    Supports rectangular room dimensions and parametric polygon footprints.
    """
    violations = []
    pos = placement.get('position', [0.0, 0.0, 0.0])
    dims = placement.get('dimensions', [1.0, 1.0, 1.0])
    scale = placement.get('scale', [1.0, 1.0, 1.0])
    rot = placement.get('rotationEuler', [0.0, 0.0, 0.0])
    yaw = rot[1] if len(rot) > 1 else 0.0

    corners = get_furniture_corners_2d(pos, dims, scale, yaw)

    room_w = float(room.get('width', 5.0))
    room_l = float(room.get('length', 4.0))
    room_h = float(room.get('height', 2.8))

    half_w = room_w / 2.0
    half_l = room_l / 2.0

    # Rectangular boundary check
    for cx, cz in corners:
        if cx < -half_w - tolerance or cx > half_w + tolerance:
            violations.append(f"X coordinate {cx:.2f}m exceeds room width limits [-{half_w:.2f}m, {half_w:.2f}m]")
            break
    for cx, cz in corners:
        if cz < -half_l - tolerance or cz > half_l + tolerance:
            violations.append(f"Z coordinate {cz:.2f}m exceeds room length limits [-{half_l:.2f}m, {half_l:.2f}m]")
            break

    # Floor & ceiling checks
    base_y = pos[1] - (dims[1] * scale[1]) / 2.0
    top_y = pos[1] + (dims[1] * scale[1]) / 2.0
    if base_y < 0.0 - tolerance:
        violations.append(f"Base Y {base_y:.2f}m is below floor level (0.0m)")
    if top_y > room_h + tolerance:
        violations.append(f"Top Y {top_y:.2f}m exceeds ceiling height ({room_h:.2f}m)")

    # Parametric polygon footprint check
    footprint = room.get('footprint')
    if footprint and isinstance(footprint, list) and len(footprint) >= 3:
        for cx, cz in corners:
            if not is_point_in_polygon_2d((cx, cz), footprint, tolerance):
                violations.append(f"Footprint corner [{cx:.2f}m, {cz:.2f}m] lies outside parametric room polygon")
                break

    return violations


def obb_intersect_2d(
    corners_a: list[tuple[float, float]],
    corners_b: list[tuple[float, float]],
    tolerance: float = 0.002
) -> bool:
    """
    Separating Axis Theorem (SAT) for two 2D oriented bounding boxes.
    Returns True if boxes intersect.
    """
    for box in (corners_a, corners_b):
        for i in range(4):
            p1 = box[i]
            p2 = box[(i + 1) % 4]
            # Edge normal vector
            normal = (-(p2[1] - p1[1]), p2[0] - p1[0])
            length = math.hypot(normal[0], normal[1])
            if length < 1e-6:
                continue
            axis = (normal[0] / length, normal[1] / length)

            # Project corners_a onto axis
            dots_a = [c[0] * axis[0] + c[1] * axis[1] for c in corners_a]
            min_a, max_a = min(dots_a), max(dots_a)

            # Project corners_b onto axis
            dots_b = [c[0] * axis[0] + c[1] * axis[1] for c in corners_b]
            min_b, max_b = min(dots_b), max(dots_b)

            # If separated by tolerance margin, no intersection
            if max_a - tolerance < min_b or max_b - tolerance < min_a:
                return False

    return True


def check_obb_collisions_3d(
    item_a: dict[str, Any],
    item_b: dict[str, Any],
    tolerance: float = 0.002
) -> bool:
    """
    Checks if two furniture items physically intersect in 3D using vertical interval overlap
    and 2D Separating Axis Theorem (SAT) on the XZ floor plane.
    """
    if item_a.get('id') == item_b.get('id'):
        return False

    pos_a = item_a.get('position', [0.0, 0.0, 0.0])
    dims_a = item_a.get('dimensions', [1.0, 1.0, 1.0])
    scale_a = item_a.get('scale', [1.0, 1.0, 1.0])
    rot_a = item_a.get('rotationEuler', [0.0, 0.0, 0.0])

    pos_b = item_b.get('position', [0.0, 0.0, 0.0])
    dims_b = item_b.get('dimensions', [1.0, 1.0, 1.0])
    scale_b = item_b.get('scale', [1.0, 1.0, 1.0])
    rot_b = item_b.get('rotationEuler', [0.0, 0.0, 0.0])

    # 1. Height overlap check (Y axis)
    half_ha = (dims_a[1] * scale_a[1]) / 2.0
    half_hb = (dims_b[1] * scale_b[1]) / 2.0
    min_ya, max_ya = pos_a[1] - half_ha, pos_a[1] + half_ha
    min_yb, max_yb = pos_b[1] - half_hb, pos_b[1] + half_hb

    if max_ya - tolerance < min_yb or max_yb - tolerance < min_ya:
        return False  # No vertical overlap

    # 2. 2D SAT on floor plane (XZ)
    yaw_a = rot_a[1] if len(rot_a) > 1 else 0.0
    yaw_b = rot_b[1] if len(rot_b) > 1 else 0.0

    corners_a = get_furniture_corners_2d(pos_a, dims_a, scale_a, yaw_a)
    corners_b = get_furniture_corners_2d(pos_b, dims_b, scale_b, yaw_b)

    return obb_intersect_2d(corners_a, corners_b, tolerance=tolerance)


def check_doorway_landing_clearance(
    placement: dict[str, Any],
    room: dict[str, Any],
    landing_depth_meters: float = 0.90
) -> list[str]:
    """
    Validates that furniture placement does not intrude into architectural doorway landing zones.
    If architectural openings are defined, validates against each door.
    If room is rectangular without openings, falls back to protecting the standard south entrance.
    """
    violations = []
    openings = room.get('openings', [])
    walls = {w.get('id'): w for w in room.get('walls', []) if isinstance(w, dict) and 'id' in w}

    pos = placement.get('position', [0.0, 0.0, 0.0])
    dims = placement.get('dimensions', [1.0, 1.0, 1.0])
    scale = placement.get('scale', [1.0, 1.0, 1.0])
    rot = placement.get('rotationEuler', [0.0, 0.0, 0.0])
    yaw = rot[1] if len(rot) > 1 else 0.0

    corners = get_furniture_corners_2d(pos, dims, scale, yaw)

    if not openings:
        # Fallback for rectangular room: standard South wall entrance [0, length/2]
        room_l = float(room.get('length', 4.0))
        door_cx = 0.0
        door_cz = room_l / 2.0
        landing_cz = door_cz - (landing_depth_meters / 2.0)
        landing_radius = (0.90 + landing_depth_meters) / 2.0
        for cx, cz in corners:
            if math.hypot(cx - door_cx, cz - landing_cz) < landing_radius:
                violations.append("intrudes into default south entrance landing zone")
                break
        return violations


    for op in openings:
        if not isinstance(op, dict) or op.get('type') != 'door':
            continue

        wall_id = op.get('wallId')
        wall = walls.get(wall_id)
        if not wall:
            continue

        sp = wall.get('startPoint', [0.0, 0.0])
        ep = wall.get('endPoint', [0.0, 0.0])
        dx = ep[0] - sp[0]
        dz = ep[1] - sp[1]
        wall_len = math.hypot(dx, dz)
        if wall_len < 1e-4:
            continue

        # Inward wall normal
        # Vector along wall: (ux, uz)
        ux = dx / wall_len
        uz = dz / wall_len
        # Interior normal (pointing inside room): (-uz, ux) or (uz, -ux)
        # Check center of room (0, 0)
        nx = -uz
        nz = ux
        # Midpoint of door
        dist = float(op.get('distanceAlongWall', 0.0))
        width = float(op.get('width', 0.9))
        door_center_dist = dist + width / 2.0
        door_cx = sp[0] + ux * door_center_dist
        door_cz = sp[1] + uz * door_center_dist

        # If inward normal points away from room center, invert
        if (0.0 - door_cx) * nx + (0.0 - door_cz) * nz < 0:
            nx = -nx
            nz = -nz

        # Door access landing point
        landing_cx = door_cx + nx * (landing_depth_meters / 2.0)
        landing_cz = door_cz + nz * (landing_depth_meters / 2.0)

        # Distance from furniture center or corners to landing center
        landing_radius = (width + landing_depth_meters) / 2.0
        for cx, cz in corners:
            dist_to_landing = math.hypot(cx - landing_cx, cz - landing_cz)
            if dist_to_landing < landing_radius * 0.75:
                violations.append(
                    f"Intrudes into doorway landing zone for door '{op.get('id', 'door')}' on wall '{wall_id}'."
                )
                break

    return violations
