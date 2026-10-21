from typing import Any
from apps.designs.validators import compute_transformed_aabb_extents
from apps.furniture.budget import calculate_scene_budget

# Task definitions conforming strictly to docs/RESEARCH_PROTOCOL_AND_TASKS.md Section 5
TASK_SPECIFICATIONS = {
    'living_room': {
        'name': 'Contemporary Living Room',
        'budget_ceiling_paise': 6000000,  # ₹60,000
        'room_dimensions': {'width': 5.0, 'length': 4.0, 'height': 2.8},
        'doorway_keep_out': {
            'x_min': -0.60,
            'x_max': 0.60,
            'y_min': 0.00,
            'y_max': 2.10,
            'z_min': 0.80,
            'z_max': 2.00,
        },
        'mandatory_fixed_assets': {
            'sofa-modern-3seater',
            'table-oak-coffee',
            'chair-accent-armchair',
        },
        'mandatory_choice_assets': {
            'decor-plant-floor-vase',
            'storage-bookshelf-tall',
        },
    },
    'home_study': {
        'name': 'Modern Executive Study',
        'budget_ceiling_paise': 5000000,  # ₹50,000
        'room_dimensions': {'width': 4.5, 'length': 3.5, 'height': 2.8},
        'doorway_keep_out': {
            'x_min': 1.05,
            'x_max': 2.25,
            'y_min': 0.00,
            'y_max': 2.10,
            'z_min': -0.60,
            'z_max': 0.60,
        },
        'mandatory_fixed_assets': {
            'desk-workspace-study',
            'chair-accent-armchair',
            'storage-bookshelf-tall',
        },
        'mandatory_choice_assets': {
            'decor-plant-floor-vase',
            'table-oak-coffee',
        },
    },
}


def sanitize_scene_snapshot(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """
    Sanitizes raw scene snapshots to guarantee that NO signed asset URLs,
    temporary cloud URLs with credentials, bearer tokens, or session queries
    are persisted in research evaluation logs or exported datasets.
    """
    if not isinstance(snapshot, dict):
        return None

    room_raw = snapshot.get('room')
    if isinstance(room_raw, dict):
        room = {
            'width': float(room_raw.get('width', 5.0)),
            'length': float(room_raw.get('length', 4.0)),
            'height': float(room_raw.get('height', 2.8)),
        }
    else:
        room = {'width': 5.0, 'length': 4.0, 'height': 2.8}

    sanitized_objects = []
    raw_objects = snapshot.get('objects') or []
    if isinstance(raw_objects, list):
        for idx, obj in enumerate(raw_objects):
            if not isinstance(obj, dict):
                continue
            
            placement_id = str(obj.get('id', f'item-{idx}')).strip()
            asset_id = str(obj.get('assetId', '')).strip()
            name = str(obj.get('name', 'Furniture Item')).strip()

            pos = [float(v) for v in obj.get('position', [0.0, 0.0, 0.0])[:3]]
            rot = [float(v) for v in obj.get('rotationEuler', [0.0, 0.0, 0.0])[:3]]
            scale = [float(v) for v in obj.get('scale', [1.0, 1.0, 1.0])[:3]]
            dims = [float(v) for v in obj.get('dimensions', [1.0, 1.0, 1.0])[:3]]

            clean_obj: dict[str, Any] = {
                'id': placement_id,
                'assetId': asset_id,
                'name': name,
                'dimensions': dims,
                'position': pos,
                'rotationEuler': rot,
                'scale': scale,
            }

            mat = obj.get('materialOverrides')
            if isinstance(mat, dict):
                clean_mat = {}
                if 'color' in mat and isinstance(mat['color'], str):
                    clean_mat['color'] = mat['color'][:30]
                if 'roughness' in mat and isinstance(mat['roughness'], (int, float)):
                    clean_mat['roughness'] = float(mat['roughness'])
                if 'metalness' in mat and isinstance(mat['metalness'], (int, float)):
                    clean_mat['metalness'] = float(mat['metalness'])
                if clean_mat:
                    clean_obj['materialOverrides'] = clean_mat

            reconstruction_id = obj.get('reconstructionJobId')
            if reconstruction_id and isinstance(reconstruction_id, str):
                clean_obj['reconstructionJobId'] = reconstruction_id[:64]
            if obj.get('isCustomReconstruction') is True:
                clean_obj['isCustomReconstruction'] = True

            # SECURITY INVARIANT: modelUrl, thumbnail, blob URLs, and credentialed strings
            # are deliberately excluded here.
            sanitized_objects.append(clean_obj)

    return {
        'schemaVersion': int(snapshot.get('schemaVersion', 1)),
        'unit': 'm',
        'room': room,
        'objects': sanitized_objects,
    }


def compute_object_aabb(obj: dict[str, Any]) -> tuple[float, float, float, float, float, float]:
    """
    Computes [min_x, max_x, min_y, max_y, min_z, max_z] for a furniture item
    using its transformed analytical AABB extents.
    """
    dims = [float(v) for v in obj.get('dimensions', [1.0, 1.0, 1.0])[:3]]
    scale = [float(v) for v in obj.get('scale', [1.0, 1.0, 1.0])[:3]]
    rot = [float(v) for v in obj.get('rotationEuler', [0.0, 0.0, 0.0])[:3]]
    pos = [float(v) for v in obj.get('position', [0.0, 0.0, 0.0])[:3]]

    ex, ey, ez = compute_transformed_aabb_extents(dims, scale, rot)

    min_x = pos[0] - ex
    max_x = pos[0] + ex
    min_y = pos[1] - ey
    max_y = pos[1] + ey
    min_z = pos[2] - ez
    max_z = pos[2] + ez

    return min_x, max_x, min_y, max_y, min_z, max_z


def evaluate_aabb_overlap_pairs_count(objects: list[dict[str, Any]], tolerance: float = 0.02) -> int:
    """
    Calculates the count of distinct furniture AABB overlap pairs (i < j).
    Overlap serves as a geometric collision proxy using a 0.02m (2 cm) numerical tolerance threshold.
    Pairs must intersect across all 3 axes (X, Y, Z) by more than 2 cm.
    """
    if len(objects) < 2:
        return 0

    aabbs = [compute_object_aabb(obj) for obj in objects]
    overlap_pairs = 0
    n = len(aabbs)

    for i in range(n):
        min_xi, max_xi, min_yi, max_yi, min_zi, max_zi = aabbs[i]
        for j in range(i + 1, n):
            min_xj, max_xj, min_yj, max_yj, min_zj, max_zj = aabbs[j]

            # Overlap span along X
            overlap_x = min(max_xi, max_xj) - max(min_xi, min_xj)
            if overlap_x <= tolerance:
                continue

            # Overlap span along Y
            overlap_y = min(max_yi, max_yj) - max(min_yi, min_yj)
            if overlap_y <= tolerance:
                continue

            # Overlap span along Z
            overlap_z = min(max_zi, max_zj) - max(min_zi, min_zj)
            if overlap_z <= tolerance:
                continue

            overlap_pairs += 1

    return overlap_pairs


def evaluate_doorway_intrusions_count(
    task_name: str,
    objects: list[dict[str, Any]],
    tolerance: float = 0.01
) -> int:
    """
    Silently evaluates the count of furniture items intruding into the task's doorway keep-out box.
    """
    task_spec = TASK_SPECIFICATIONS.get(task_name)
    if not task_spec:
        return 0

    dk = task_spec['doorway_keep_out']
    dk_min_x, dk_max_x = dk['x_min'], dk['x_max']
    dk_min_y, dk_max_y = dk['y_min'], dk['y_max']
    dk_min_z, dk_max_z = dk['z_min'], dk['z_max']

    intrusions = 0
    for obj in objects:
        min_x, max_x, min_y, max_y, min_z, max_z = compute_object_aabb(obj)

        overlap_x = min(max_x, dk_max_x) - max(min_x, dk_min_x)
        if overlap_x <= tolerance:
            continue

        overlap_y = min(max_y, dk_max_y) - max(min_y, dk_min_y)
        if overlap_y <= tolerance:
            continue

        overlap_z = min(max_z, dk_max_z) - max(min_z, dk_min_z)
        if overlap_z <= tolerance:
            continue

        intrusions += 1

    return intrusions


def evaluate_final_scene_out_of_bounds_count(
    room: dict[str, Any],
    objects: list[dict[str, Any]],
    tolerance: float = 0.01
) -> int:
    """
    Verifies that all placed furniture AABBs fit within the canonical room envelope.
    Returns count of boundary-violating objects.
    """
    room_w = float(room.get('width', 5.0))
    room_l = float(room.get('length', 4.0))
    room_h = float(room.get('height', 2.8))

    half_w = room_w / 2.0
    half_l = room_l / 2.0

    violations = 0
    for obj in objects:
        min_x, max_x, min_y, max_y, min_z, max_z = compute_object_aabb(obj)

        if (
            min_x < -half_w - tolerance or max_x > half_w + tolerance or
            min_z < -half_l - tolerance or max_z > half_l + tolerance or
            min_y < 0.0 - tolerance or max_y > room_h + tolerance
        ):
            violations += 1

    return violations


def evaluate_task_success(
    task_name: str,
    objects: list[dict[str, Any]],
    is_budget_compliant: bool,
    doorway_intrusions_count: int
) -> bool:
    """
    Determines composite task success:
    1. Satisfies all 4 mandatory functional furniture items (3 fixed + 1 choice).
    2. Strictly budget compliant (budgetTotalPaise <= budgetCeilingPaise).
    3. Exactly zero doorway keep-out clearance intrusions.
    """
    if not is_budget_compliant:
        return False
    if doorway_intrusions_count > 0:
        return False

    task_spec = TASK_SPECIFICATIONS.get(task_name)
    if not task_spec:
        return False

    present_asset_ids = {str(obj.get('assetId', '')).strip() for obj in objects if obj.get('assetId')}

    # Check 3 mandatory fixed items
    fixed_required = task_spec['mandatory_fixed_assets']
    if not fixed_required.issubset(present_asset_ids):
        return False

    # Check that at least one of the choice items is present
    choice_required = task_spec['mandatory_choice_assets']
    if not (present_asset_ids & choice_required):
        return False

    # Check that at least 4 items are placed
    if len(objects) < 4:
        return False

    return True


def calculate_authoritative_session_metrics(
    task_name: str,
    sanitized_snapshot: dict[str, Any]
) -> dict[str, Any]:
    """
    Authoritative server-side evaluation engine for completed research sessions.
    Computes integer paise budget, containment, AABB overlaps, doorway intrusions,
    and composite task success directly from validated scene geometry.
    """
    task_spec = TASK_SPECIFICATIONS.get(task_name, TASK_SPECIFICATIONS['living_room'])
    budget_ceiling = task_spec['budget_ceiling_paise']

    room = sanitized_snapshot.get('room', {})
    objects = sanitized_snapshot.get('objects', [])

    # 1. Authoritative integer paise budget calculation
    budget_summary = calculate_scene_budget(sanitized_snapshot)
    budget_total_paise = budget_summary.get('total_paise', 0)
    is_budget_compliant = budget_total_paise <= budget_ceiling

    # 2. Out-of-bounds containment verification
    out_of_bounds_count = evaluate_final_scene_out_of_bounds_count(room, objects)

    # 3. AABB overlap pairs count (2cm tolerance)
    aabb_overlap_pairs_count = evaluate_aabb_overlap_pairs_count(objects)

    # 4. Doorway keep-out intrusion count
    doorway_intrusions_count = evaluate_doorway_intrusions_count(task_name, objects)

    # 5. Composite task success rate
    is_task_successful = evaluate_task_success(
        task_name=task_name,
        objects=objects,
        is_budget_compliant=is_budget_compliant,
        doorway_intrusions_count=doorway_intrusions_count
    )

    return {
        'budget_total_paise': budget_total_paise,
        'budget_ceiling_paise': budget_ceiling,
        'is_budget_compliant': is_budget_compliant,
        'final_scene_out_of_bounds_count': out_of_bounds_count,
        'aabb_overlap_pairs_count': aabb_overlap_pairs_count,
        'doorway_intrusions_count': doorway_intrusions_count,
        'is_task_successful': is_task_successful,
    }
