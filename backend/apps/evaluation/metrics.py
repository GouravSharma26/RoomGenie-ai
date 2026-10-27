import math
import re
import uuid
from typing import Any
from apps.designs.validators import compute_transformed_aabb_extents
from apps.furniture.budget import calculate_scene_budget

# Crossover assignment sequences strictly conforming to docs/RESEARCH_PROTOCOL_AND_TASKS.md Section 4.2
ASSIGNMENT_SEQUENCES = {
    'G1': {
        1: {'condition': 'manual', 'task_name': 'living_room'},
        2: {'condition': 'ai_assisted', 'task_name': 'home_study'},
    },
    'G2': {
        1: {'condition': 'ai_assisted', 'task_name': 'living_room'},
        2: {'condition': 'manual', 'task_name': 'home_study'},
    },
    'G3': {
        1: {'condition': 'manual', 'task_name': 'home_study'},
        2: {'condition': 'ai_assisted', 'task_name': 'living_room'},
    },
    'G4': {
        1: {'condition': 'ai_assisted', 'task_name': 'home_study'},
        2: {'condition': 'manual', 'task_name': 'living_room'},
    },
}


def validate_study_assignment(
    sequence_order: str,
    condition: str,
    task_name: str,
    trial_period: int | None = None
) -> int:
    """
    Validates that (sequence_order, condition, task_name) matches the pre-registered
    4-sequence counterbalanced crossover design.
    Returns the validated trial_period (1 or 2).
    Raises ValueError with diagnostic details if invalid.
    """
    if sequence_order not in ASSIGNMENT_SEQUENCES:
        raise ValueError(f"Unknown sequence order '{sequence_order}'. Must be one of G1, G2, G3, G4.")

    group_periods = ASSIGNMENT_SEQUENCES[sequence_order]
    matched_period = None
    for period, expected in group_periods.items():
        if expected['condition'] == condition and expected['task_name'] == task_name:
            matched_period = period
            break

    if matched_period is None:
        valid_assignments = [
            f"Period {p}: condition='{exp['condition']}', task='{exp['task_name']}'"
            for p, exp in group_periods.items()
        ]
        raise ValueError(
            f"Invalid assignment for group {sequence_order}: condition='{condition}', task='{task_name}'. "
            f"Allowed combinations for {sequence_order} are: {'; '.join(valid_assignments)}."
        )

    if trial_period is not None and trial_period != matched_period:
        raise ValueError(
            f"Specified trialPeriod={trial_period} does not match the period ({matched_period}) "
            f"determined by group {sequence_order} assignment."
        )

    return matched_period


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

URL_CREDENTIAL_PATTERN = re.compile(
    r'(https?://|blob:|data:|ftp://|\bbearer\b|\bbearer\s+|\btoken\b|\btoken=|\bsig=|\bsignature=|\bkey=|\bsecret=|\bcredential=|\bauth=|\bpassword\b)',
    re.IGNORECASE
)
SAFE_IDENTIFIER_PATTERN = re.compile(r'^[a-zA-Z0-9_\-\.]+$')
SAFE_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_\-\.\s\(\)\'\"]+$')
HEX_COLOR_PATTERN = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def _is_finite_number(val: Any) -> bool:
    if isinstance(val, bool):
        return False
    if isinstance(val, (int, float)):
        return not (math.isnan(val) or math.isinf(val))
    return False


def _check_no_url_or_credentials(text: str, field_name: str) -> None:
    if URL_CREDENTIAL_PATTERN.search(text):
        raise ValueError(
            f"Prohibited URL or credential string detected in '{field_name}'."
        )


def validate_and_sanitize_canonical_scene(
    snapshot: Any,
    expected_task_name: str | None = None
) -> dict[str, Any]:
    """
    Validates canonical scene snapshot structure and enforces task-specific room constraints.
    Rejects malformed structures, non-finite vectors, and mismatched room envelopes.
    Strips asset URLs and sensitive credentials.
    Raises ValueError with specific diagnostic message on invalid scene schema.
    """
    if not isinstance(snapshot, dict):
        raise ValueError("Scene snapshot must be a JSON dictionary.")

    # 1. Schema version: must be 1 (or '1' / '1.0.0'), cannot be boolean
    schema_version = snapshot.get('schemaVersion')
    if isinstance(schema_version, bool) or schema_version not in (1, '1', '1.0.0'):
        raise ValueError(f"Unsupported scene schemaVersion: {schema_version}. Expected 1.")

    # 2. Units: must be strictly SI metres ('m')
    unit = snapshot.get('unit')
    if unit != 'm':
        raise ValueError(f"Prohibited scene unit: '{unit}'. Must be strictly SI metres ('m').")

    # 3. Room dimensions
    room = snapshot.get('room')
    if not isinstance(room, dict):
        raise ValueError("Scene 'room' must be a dictionary specifying width, length, and height.")

    for dim in ('width', 'length', 'height'):
        val = room.get(dim)
        if not _is_finite_number(val) or val <= 0:
            raise ValueError(f"Room dimension '{dim}' must be a positive finite number, got: {val}.")

    room_w = float(room['width'])
    room_l = float(room['length'])
    room_h = float(room['height'])

    # Enforce task room dimensions if task is provided
    if expected_task_name:
        task_spec = TASK_SPECIFICATIONS.get(expected_task_name)
        if task_spec:
            expected_dims = task_spec['room_dimensions']
            tolerance = 0.05
            if (
                abs(room_w - expected_dims['width']) > tolerance or
                abs(room_l - expected_dims['length']) > tolerance or
                abs(room_h - expected_dims['height']) > tolerance
            ):
                raise ValueError(
                    f"Room dimensions ({room_w}x{room_l}x{room_h}) do not match required dimensions "
                    f"for task '{expected_task_name}' ({expected_dims['width']}x{expected_dims['length']}x{expected_dims['height']})."
                )

    # 4. Objects validation
    raw_objects = snapshot.get('objects')
    if not isinstance(raw_objects, list):
        raise ValueError("Scene 'objects' must be a list of placed furniture items.")
    if len(raw_objects) > 50:
        raise ValueError(f"Too many placed items in scene ({len(raw_objects)}). Maximum permitted is 50.")

    sanitized_objects = []
    seen_placement_ids = set()

    for idx, obj in enumerate(raw_objects):
        if not isinstance(obj, dict):
            raise ValueError(f"Placed item at index {idx} must be a dictionary.")

        # ID: unique placement ID (no whitespace)
        placement_id = obj.get('id')
        if not placement_id or not isinstance(placement_id, str):
            raise ValueError(f"Item at index {idx} is missing a non-empty string 'id'.")
        placement_id = placement_id.strip()
        _check_no_url_or_credentials(placement_id, f"objects[{idx}].id")
        if not SAFE_IDENTIFIER_PATTERN.match(placement_id):
            raise ValueError(f"Item id '{placement_id}' contains unsafe characters.")
        if placement_id in seen_placement_ids:
            raise ValueError(f"Duplicate placement ID detected in scene: '{placement_id}'. Placement IDs must be unique.")
        seen_placement_ids.add(placement_id)

        # Asset ID
        asset_id = obj.get('assetId')
        if not asset_id or not isinstance(asset_id, str):
            raise ValueError(f"Item '{placement_id}' is missing a valid 'assetId'.")
        asset_id = asset_id.strip()
        _check_no_url_or_credentials(asset_id, f"objects[{idx}].assetId")
        if not SAFE_IDENTIFIER_PATTERN.match(asset_id):
            raise ValueError(f"Item assetId '{asset_id}' contains unsafe characters.")

        # Name
        name = obj.get('name', 'Furniture Item')
        if not isinstance(name, str):
            raise ValueError(f"Item '{placement_id}' 'name' must be a string.")
        name = name.strip()[:128]
        _check_no_url_or_credentials(name, f"objects[{idx}].name")
        if not SAFE_NAME_PATTERN.match(name):
            raise ValueError(f"Item name '{name}' contains unsafe characters.")

        # Exactly 3-component vectors: position, rotationEuler, scale, dimensions
        def _parse_vec3(key: str, positive_only: bool = False) -> list[float]:
            vec = obj.get(key)
            if not isinstance(vec, (list, tuple)) or len(vec) != 3:
                raise ValueError(f"Item '{placement_id}' '{key}' must be a 3-component vector [x, y, z] of length exactly 3.")
            parsed = []
            for coord_idx, v in enumerate(vec):
                if not _is_finite_number(v):
                    raise ValueError(f"Item '{placement_id}' '{key}[{coord_idx}]' must be a finite number.")
                v_float = float(v)
                if positive_only and v_float <= 0:
                    raise ValueError(f"Item '{placement_id}' '{key}[{coord_idx}]' must be positive.")
                parsed.append(v_float)
            return parsed

        pos = _parse_vec3('position', positive_only=False)
        rot = _parse_vec3('rotationEuler', positive_only=False)
        scale = _parse_vec3('scale', positive_only=True)
        dims = _parse_vec3('dimensions', positive_only=True)

        clean_obj: dict[str, Any] = {
            'id': placement_id,
            'assetId': asset_id,
            'name': name,
            'dimensions': dims,
            'position': pos,
            'rotationEuler': rot,
            'scale': scale,
        }

        # Material overrides
        mat = obj.get('materialOverrides')
        if mat is not None:
            if not isinstance(mat, dict):
                raise ValueError(f"Item '{placement_id}' 'materialOverrides' must be a dictionary.")
            clean_mat = {}
            if 'color' in mat and mat['color'] is not None:
                color_val = str(mat['color']).strip()
                _check_no_url_or_credentials(color_val, f"objects[{idx}].materialOverrides.color")
                if not (HEX_COLOR_PATTERN.match(color_val) or SAFE_IDENTIFIER_PATTERN.match(color_val)):
                    raise ValueError(f"Prohibited color format in materialOverrides: '{color_val}'.")
                clean_mat['color'] = color_val[:32]
            if 'roughness' in mat and mat['roughness'] is not None:
                if not _is_finite_number(mat['roughness']) or not (0.0 <= float(mat['roughness']) <= 1.0):
                    raise ValueError(f"Item '{placement_id}' roughness must be between 0.0 and 1.0.")
                clean_mat['roughness'] = float(mat['roughness'])
            if 'metalness' in mat and mat['metalness'] is not None:
                if not _is_finite_number(mat['metalness']) or not (0.0 <= float(mat['metalness']) <= 1.0):
                    raise ValueError(f"Item '{placement_id}' metalness must be between 0.0 and 1.0.")
                clean_mat['metalness'] = float(mat['metalness'])
            if clean_mat:
                clean_obj['materialOverrides'] = clean_mat

        # Reconstruction reference: must be a valid UUID string
        reconstruction_id = obj.get('reconstructionJobId')
        if reconstruction_id is not None:
            if not isinstance(reconstruction_id, str):
                raise ValueError(f"Item '{placement_id}' 'reconstructionJobId' must be a valid UUID string.")
            reconstruction_id = reconstruction_id.strip()
            _check_no_url_or_credentials(reconstruction_id, f"objects[{idx}].reconstructionJobId")
            try:
                parsed_uuid = uuid.UUID(reconstruction_id)
                clean_obj['reconstructionJobId'] = str(parsed_uuid)
            except (ValueError, AttributeError, TypeError):
                raise ValueError(f"Item '{placement_id}' 'reconstructionJobId' ('{reconstruction_id}') is not a valid UUID.")

        if obj.get('isCustomReconstruction') is True:
            clean_obj['isCustomReconstruction'] = True

        # SECURITY INVARIANT: modelUrl, thumbnail, blob URLs, and credentialed strings are strictly excluded
        sanitized_objects.append(clean_obj)

    return {
        'schemaVersion': 1,
        'unit': 'm',
        'room': {'width': room_w, 'length': room_l, 'height': room_h},
        'objects': sanitized_objects,
    }


def sanitize_scene_snapshot(snapshot: dict[str, Any] | None, expected_task_name: str | None = None) -> dict[str, Any] | None:
    """
    Sanitizes raw scene snapshots by executing strict canonical validation.
    Returns sanitized dictionary, or raises ValueError on validation failure.
    """
    if snapshot is None:
        return None
    return validate_and_sanitize_canonical_scene(snapshot, expected_task_name=expected_task_name)


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
    Determines composite task success (H04) strictly adhering to pre-registered protocol
    (docs/RESEARCH_PROTOCOL_AND_TASKS.md Section 1.2 & Section 9.3):
    1. Satisfies all 4 mandatory functional furniture items:
       - All 3 required fixed assets for the task
       - Exactly 1 permitted choice asset for the task
       - Total placed furniture count == EXACTLY 4
    2. Strictly budget compliant (budgetTotalPaise <= budgetCeilingPaise with all assets having known catalogue prices).
    3. Exactly zero doorway keep-out clearance intrusions (doorwayIntrusionsCount == 0).
    (Note: Room boundary containment is recorded independently as finalSceneOutOfBoundsCount,
    and AABB overlaps as exploratory metric E1. Neither is a disqualifier for H04 in the pre-registered protocol).
    """
    if not is_budget_compliant:
        return False
    if doorway_intrusions_count > 0:
        return False

    task_spec = TASK_SPECIFICATIONS.get(task_name)
    if not task_spec:
        return False

    # Task specification requires EXACTLY 4 placed items
    if len(objects) != 4:
        return False

    placed_asset_ids = [str(obj.get('assetId', '')).strip() for obj in objects]
    placed_asset_set = set(placed_asset_ids)

    # 1. Check all 3 mandatory fixed items
    fixed_required = task_spec['mandatory_fixed_assets']
    if not fixed_required.issubset(placed_asset_set):
        return False

    # 2. Check that exactly one permitted choice item is present
    choice_allowed = task_spec['mandatory_choice_assets']
    choice_items_present = [aid for aid in placed_asset_ids if aid in choice_allowed]
    if len(choice_items_present) != 1:
        return False

    # 3. Check that the 4 items placed are exactly the 3 fixed + 1 choice
    expected_set = fixed_required | {choice_items_present[0]}
    if placed_asset_set != expected_set:
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

    # Unknown prices rule: compliance is verified ONLY when every item has a known catalogue price
    unpriced_count = budget_summary.get('unpriced_items_count', 0)
    has_unknown = budget_summary.get('has_unknown_prices', False)
    is_budget_compliant = (not has_unknown) and (unpriced_count == 0) and (budget_total_paise <= budget_ceiling)

    # 2. Out-of-bounds containment verification
    out_of_bounds_count = evaluate_final_scene_out_of_bounds_count(room, objects)

    # 3. AABB overlap pairs count (2cm tolerance, exploratory metric E1)
    aabb_overlap_pairs_count = evaluate_aabb_overlap_pairs_count(objects)

    # 4. Doorway keep-out intrusion count (unannotated keep-out box)
    doorway_intrusions_count = evaluate_doorway_intrusions_count(task_name, objects)

    # 5. Composite task success rate (H04)
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


# Standard 10-Item System Usability Scale (SUS) questionnaire (Brooke, 1996)
SUS_QUESTIONS = [
    "I think that I would like to use this system frequently.",
    "I found the system unnecessarily complex.",
    "I thought the system was easy to use.",
    "I think that I would need the support of a technical person to be able to use this system.",
    "I found the various functions in this system were well integrated.",
    "I thought there was too much inconsistency in this system.",
    "I would imagine that most people would learn to use this system very quickly.",
    "I found the system very cumbersome to use.",
    "I felt very confident using the system.",
    "I needed to learn a lot of things before I could get going with this system.",
]


def validate_sus_responses(responses: Any) -> tuple[bool, list[int], str | None]:
    """
    Validates that survey responses contain all 10 integer answers (1..10)
    with Likert values strictly within the range [1, 5].
    Returns (is_valid, missing_questions, error_message).
    """
    if not isinstance(responses, dict):
        return False, list(range(1, 11)), "SUS responses must be a JSON dictionary mapping question numbers (1..10) to Likert ratings (1..5)."

    normalized: dict[int, int] = {}
    missing: list[int] = []

    for q in range(1, 11):
        # Support both integer and string keys e.g. 1 or "1"
        val = responses.get(q) if q in responses else responses.get(str(q))
        if val is None:
            missing.append(q)
            continue
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            return False, [], f"Question {q} response must be an integer between 1 and 5."
        int_val = int(val)
        if int_val < 1 or int_val > 5:
            return False, [], f"Question {q} rating '{int_val}' is out of range. Must be between 1 and 5."
        normalized[q] = int_val

    if missing:
        return False, missing, f"Missing responses for {len(missing)} question(s): {missing}."

    return True, [], None


def calculate_sus_score(responses: dict[Any, Any] | list[int]) -> dict[str, Any]:
    """
    Calculates composite System Usability Scale (SUS) score conforming strictly to
    Brooke (1996) and Bangor, Kortum & Miller (2008, 2009).

    Formula:
      - Odd items (1, 3, 5, 7, 9): contribution = rating - 1
      - Even items (2, 4, 6, 8, 10): contribution = 5 - rating
      - SUS = 2.5 * sum(contributions)

    Grading Bands (Bangor et al.):
      - >= 85.0: Grade A (Excellent Usability)
      - 71.0 - 84.9: Grade B (Good Usability)
      - 65.0 - 70.9: Grade C (Acceptable / Average; 68.0 industry mean)
      - 50.0 - 64.9: Grade D (Marginal / Below Average)
      - < 50.0: Grade F (Poor / Not Acceptable)
    """
    if isinstance(responses, list):
        resp_dict = {i + 1: val for i, val in enumerate(responses)}
    else:
        resp_dict = responses

    is_valid, missing, err = validate_sus_responses(resp_dict)
    if not is_valid:
        raise ValueError(err or "Invalid SUS responses.")

    # Normalize keys to ints
    norm = {int(k): int(v) for k, v in resp_dict.items() if str(k).isdigit() and 1 <= int(k) <= 10}

    total_contribution = 0.0
    item_contributions: dict[int, float] = {}

    for i in range(1, 11):
        q_val = norm[i]
        if i % 2 == 1:
            contrib = float(q_val - 1)
        else:
            contrib = float(5 - q_val)
        item_contributions[i] = contrib
        total_contribution += contrib

    raw_score = total_contribution * 2.5
    score = round(max(0.0, min(100.0, raw_score)), 1)

    if score >= 85.0:
        grade = 'A'
        description = 'Excellent Usability'
    elif score >= 71.0:
        grade = 'B'
        description = 'Good Usability'
    elif score >= 65.0:
        grade = 'C'
        description = 'Acceptable / Average'
    elif score >= 50.0:
        grade = 'D'
        description = 'Marginal / Below Average'
    else:
        grade = 'F'
        description = 'Poor / Not Acceptable'

    return {
        'score': score,
        'grade': grade,
        'description': description,
        'item_contributions': item_contributions,
        'normalized_responses': norm,
    }

