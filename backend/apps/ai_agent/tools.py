import copy
import uuid
from decimal import Decimal
from typing import Any
from django.core.exceptions import ValidationError
from apps.furniture.models import FurnitureAsset
from apps.furniture.budget import calculate_scene_budget
from apps.designs.validators import (
    compute_transformed_aabb_extents,
    is_finite_number,
    validate_vector3,
)

# Allowlisted agent action types
ALLOWED_ACTION_TYPES = {
    'add_furniture',
    'move_object',
    'replace_furniture',
    'remove_object',
    'set_material',
    'clear_room',
}


def get_available_tool_definitions() -> list[dict[str, Any]]:
    """
    Returns OpenAI / Gemini function-calling compatible tool schemas
    strictly constrained to safe, typed interior design operations.
    """
    return [
        {
            'name': 'add_furniture',
            'description': 'Add a piece of furniture from the catalogue into the room.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'asset_id': {
                        'type': 'string',
                        'description': 'Catalogue ID of the furniture model to add.',
                    },
                    'position': {
                        'type': 'array',
                        'items': {'type': 'number'},
                        'description': 'Floor position [x, y, z] in metres. X: [-width/2, width/2], Z: [-length/2, length/2].',
                    },
                    'rotation_euler': {
                        'type': 'array',
                        'items': {'type': 'number'},
                        'description': 'Euler rotation in radians [rx, ry, rz].',
                    },
                    'scale': {
                        'type': 'array',
                        'items': {'type': 'number'},
                        'description': 'Scale multipliers [sx, sy, sz], each between 0.1 and 5.0.',
                    },
                    'color': {
                        'type': 'string',
                        'description': 'Optional hex color for material customization, e.g. "#4f46e5".',
                    },
                },
                'required': ['asset_id'],
            },
        },
        {
            'name': 'move_object',
            'description': 'Reposition or rotate an existing furniture item in the room.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'object_id': {
                        'type': 'string',
                        'description': 'Placement ID of the item in the current scene to move.',
                    },
                    'position': {
                        'type': 'array',
                        'items': {'type': 'number'},
                        'description': 'New floor position [x, y, z] in metres.',
                    },
                    'rotation_euler': {
                        'type': 'array',
                        'items': {'type': 'number'},
                        'description': 'New rotation [rx, ry, rz] in radians.',
                    },
                },
                'required': ['object_id'],
            },
        },
        {
            'name': 'replace_furniture',
            'description': 'Swap an existing item with another item from the catalogue.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'object_id': {
                        'type': 'string',
                        'description': 'Placement ID of the item to replace.',
                    },
                    'new_asset_id': {
                        'type': 'string',
                        'description': 'Catalogue ID of the new replacement furniture item.',
                    },
                },
                'required': ['object_id', 'new_asset_id'],
            },
        },
        {
            'name': 'remove_object',
            'description': 'Remove an existing item from the room.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'object_id': {
                        'type': 'string',
                        'description': 'Placement ID of the item to remove.',
                    },
                },
                'required': ['object_id'],
            },
        },
        {
            'name': 'set_material',
            'description': 'Change the material color, roughness, or metalness of an existing item.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'object_id': {
                        'type': 'string',
                        'description': 'Placement ID of the item to modify.',
                    },
                    'color': {'type': 'string', 'description': 'Hex color code.'},
                    'roughness': {'type': 'number', 'description': 'Roughness between 0.0 and 1.0.'},
                    'metalness': {'type': 'number', 'description': 'Metalness between 0.0 and 1.0.'},
                },
                'required': ['object_id'],
            },
        },
        {
            'name': 'clear_room',
            'description': 'Remove all furniture items to start with an empty room envelope.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'confirm': {'type': 'boolean', 'description': 'Optional confirmation flag.'},
                },
                'required': [],
            },
        },
    ]


def validate_and_simulate_actions(
    current_scene: dict[str, Any],
    proposed_actions: list[dict[str, Any]],
    max_budget_paise: int | None = None,
) -> dict[str, Any]:
    """
    Deterministically validates and simulates proposed actions against current_scene.
    Does NOT mutate current_scene.

    Separates validation into four strict categories:
      1. Schema Errors (Tier 2):
         - Unsupported action type or malformed action structure.
         - Missing required fields according to action signatures.
         - Invalid parameter types (e.g. non-string IDs, non-3D numeric vectors, out-of-range scales/roughness).
      2. Reference-Resolution Errors:
         - Validly shaped action references missing/inactive catalogue asset.
         - Validly shaped action references nonexistent scene object.
      3. Domain/Spatial Constraint Errors (Tier 3):
         - Room boundary containment breaches.
         - Bounding box / coordinate calculation errors.
      4. Budget Errors:
         - Layout cost exceeds authoritative design budget limit.

    Returns:
      - is_valid: bool (True only if all actions succeed across all categories)
      - schema_valid: bool (True if all proposed actions adhere to tool schemas and parameter types)
      - reference_valid: bool (True if all catalogue assets and scene objects resolve)
      - domain_valid: bool (True if room containment and spatial bounds are satisfied)
      - budget_valid: bool (True if budget limits are satisfied)
      - schema_errors: list[str]
      - reference_errors: list[str]
      - domain_errors: list[str]
      - budget_errors: list[str]
      - errors: list[str] (combined blocking errors)
      - warnings: list[str]
      - candidate_scene: dict (simulated result scene)
      - budget_diff: dict (authoritative before/after integer paise comparison)
    """
    if not isinstance(current_scene, dict) or 'room' not in current_scene:
        raise ValidationError("Invalid base scene for agent simulation.")

    candidate_scene = copy.deepcopy(current_scene)
    room = candidate_scene.get('room', {})
    room_w = float(room.get('width', 5.0))
    room_l = float(room.get('length', 4.0))
    room_h = float(room.get('height', 2.8))

    objects_list = candidate_scene.setdefault('objects', [])
    errors: list[str] = []
    schema_errors: list[str] = []
    reference_errors: list[str] = []
    domain_errors: list[str] = []
    budget_errors: list[str] = []
    warnings: list[str] = []

    def add_schema_error(msg: str) -> None:
        errors.append(msg)
        schema_errors.append(msg)

    def add_reference_error(msg: str) -> None:
        errors.append(msg)
        reference_errors.append(msg)

    def add_domain_error(msg: str) -> None:
        errors.append(msg)
        domain_errors.append(msg)

    def add_budget_error(msg: str) -> None:
        errors.append(msg)
        budget_errors.append(msg)

    # Calculate starting budget
    try:
        before_budget = calculate_scene_budget(current_scene)
    except Exception as e:
        before_budget = {'total_paise': 0, 'total_inr': '0.00', 'items': []}

    if not isinstance(proposed_actions, list):
        add_schema_error("Proposed actions must be a list.")
        return {
            'is_valid': False,
            'schema_valid': False,
            'reference_valid': True,
            'domain_valid': True,
            'budget_valid': True,
            'schema_errors': schema_errors,
            'reference_errors': reference_errors,
            'domain_errors': domain_errors,
            'budget_errors': budget_errors,
            'errors': errors,
            'warnings': [],
            'candidate_scene': candidate_scene,
            'budget_diff': {},
        }

    for action_idx, action in enumerate(proposed_actions):
        if not isinstance(action, dict):
            add_schema_error(f"Action at index {action_idx} must be a dictionary.")
            continue

        action_type = action.get('type') or action.get('action')
        if not isinstance(action_type, str) or action_type not in ALLOWED_ACTION_TYPES:
            add_schema_error(
                f"Action [{action_idx}] '{action_type}' is not an allowlisted operation. "
                f"Allowed: {sorted(ALLOWED_ACTION_TYPES)}"
            )
            continue

        action_schema_errs_count = len(schema_errors)

        # 1. ADD FURNITURE
        if action_type == 'add_furniture':
            # Schema: required 'asset_id' must be a non-empty string
            raw_asset_id = action.get('asset_id')
            if raw_asset_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'asset_id' for 'add_furniture'.")
            elif not isinstance(raw_asset_id, str) or not raw_asset_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'asset_id' must be a non-empty string.")

            # Schema: optional 'position' must be 3 finite numbers
            raw_pos = action.get('position')
            cleaned_pos = None
            if raw_pos is not None:
                try:
                    cleaned_pos = validate_vector3(raw_pos, f"add_furniture.position")
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid position vector: {e}")

            # Schema: optional 'rotation_euler' must be 3 finite numbers
            raw_rot = action.get('rotation_euler')
            cleaned_rot = [0.0, 0.0, 0.0]
            if raw_rot is not None:
                try:
                    cleaned_rot = validate_vector3(raw_rot, f"add_furniture.rotation_euler")
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid rotation vector: {e}")

            # Schema: optional 'scale' must be 3 finite numbers in [0.1, 5.0]
            raw_scale = action.get('scale')
            cleaned_scale = [1.0, 1.0, 1.0]
            if raw_scale is not None:
                try:
                    cleaned_scale = validate_vector3(raw_scale, f"add_furniture.scale", min_val=0.1, max_val=5.0)
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid scale vector: {e}")

            # Schema: optional 'color' must be a string
            raw_color = action.get('color')
            if raw_color is not None and not isinstance(raw_color, str):
                add_schema_error(f"Action [{action_idx}]: Parameter 'color' must be a string.")

            # If action has schema errors, do not attempt reference resolution or placement
            if len(schema_errors) > action_schema_errs_count:
                continue

            # Reference Resolution: Catalogue asset lookup
            asset = FurnitureAsset.objects.filter(id=raw_asset_id, is_active=True).first()  # pyrefly: ignore[missing-attribute]
            if not asset:
                add_reference_error(f"Action [{action_idx}]: Asset '{raw_asset_id}' does not exist in catalogue or is inactive.")
                continue

            # Default position if not provided: center on floor resting at half-height
            dims = [float(asset.width), float(asset.height), float(asset.depth)]
            half_height = dims[1] / 2.0
            pos = cleaned_pos if cleaned_pos is not None else [0.0, half_height, 0.0]

            color = raw_color if raw_color is not None else '#4f46e5'
            new_item_id = f"item-{uuid.uuid4().hex[:8]}"

            objects_list.append({
                'id': new_item_id,
                'assetId': asset.id,
                'name': asset.name,
                'dimensions': dims,
                'position': pos,
                'rotationEuler': cleaned_rot,
                'scale': cleaned_scale,
                'materialOverrides': {'color': color} if color else {},
            })

        # 2. MOVE OBJECT
        elif action_type == 'move_object':
            # Schema: required 'object_id' must be a non-empty string
            raw_obj_id = action.get('object_id')
            if raw_obj_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'object_id' for 'move_object'.")
            elif not isinstance(raw_obj_id, str) or not raw_obj_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'object_id' must be a non-empty string.")

            # Schema: optional 'position'
            cleaned_pos = None
            if 'position' in action:
                try:
                    cleaned_pos = validate_vector3(action['position'], f"move_object.position")
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid position vector: {e}")

            # Schema: optional 'rotation_euler'
            cleaned_rot = None
            if 'rotation_euler' in action:
                try:
                    cleaned_rot = validate_vector3(action['rotation_euler'], f"move_object.rotation_euler")
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid rotation vector: {e}")

            if len(schema_errors) > action_schema_errs_count:
                continue

            # Reference Resolution: Object in current scene
            target_obj = next((o for o in objects_list if o.get('id') == raw_obj_id), None)
            if not target_obj:
                add_reference_error(f"Action [{action_idx}]: Object '{raw_obj_id}' not found in scene.")
                continue

            if cleaned_pos is not None:
                target_obj['position'] = cleaned_pos
            if cleaned_rot is not None:
                target_obj['rotationEuler'] = cleaned_rot

        # 3. REPLACE FURNITURE
        elif action_type == 'replace_furniture':
            # Schema: required 'object_id' and 'new_asset_id' must be non-empty strings
            raw_obj_id = action.get('object_id')
            if raw_obj_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'object_id' for 'replace_furniture'.")
            elif not isinstance(raw_obj_id, str) or not raw_obj_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'object_id' must be a non-empty string.")

            raw_new_asset_id = action.get('new_asset_id')
            if raw_new_asset_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'new_asset_id' for 'replace_furniture'.")
            elif not isinstance(raw_new_asset_id, str) or not raw_new_asset_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'new_asset_id' must be a non-empty string.")

            if len(schema_errors) > action_schema_errs_count:
                continue

            # Reference Resolution: Scene object
            target_obj = next((o for o in objects_list if o.get('id') == raw_obj_id), None)
            if not target_obj:
                add_reference_error(f"Action [{action_idx}]: Object '{raw_obj_id}' not found in scene.")
                continue

            # Reference Resolution: Replacement asset
            asset = FurnitureAsset.objects.filter(id=raw_new_asset_id, is_active=True).first()  # pyrefly: ignore[missing-attribute]
            if not asset:
                add_reference_error(f"Action [{action_idx}]: Replacement asset '{raw_new_asset_id}' not in catalogue or is inactive.")
                continue

            target_obj['assetId'] = asset.id
            target_obj['name'] = asset.name
            target_obj['dimensions'] = [float(asset.width), float(asset.height), float(asset.depth)]
            if 'position' in target_obj and isinstance(target_obj['position'], list) and len(target_obj['position']) == 3:
                target_obj['position'][1] = float(asset.height) / 2.0

        # 4. REMOVE OBJECT
        elif action_type == 'remove_object':
            raw_obj_id = action.get('object_id')
            if raw_obj_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'object_id' for 'remove_object'.")
            elif not isinstance(raw_obj_id, str) or not raw_obj_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'object_id' must be a non-empty string.")

            if len(schema_errors) > action_schema_errs_count:
                continue

            # Reference Resolution: Scene object
            exists = any(o.get('id') == raw_obj_id for o in objects_list)
            if not exists:
                add_reference_error(f"Action [{action_idx}]: Object '{raw_obj_id}' not found in scene.")
                continue

            objects_list[:] = [o for o in objects_list if o.get('id') != raw_obj_id]

        # 5. SET MATERIAL
        elif action_type == 'set_material':
            raw_obj_id = action.get('object_id')
            if raw_obj_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'object_id' for 'set_material'.")
            elif not isinstance(raw_obj_id, str) or not raw_obj_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'object_id' must be a non-empty string.")

            # Schema: optional 'color'
            raw_color = action.get('color')
            if raw_color is not None and not isinstance(raw_color, str):
                add_schema_error(f"Action [{action_idx}]: Parameter 'color' must be a string.")

            # Schema: optional 'roughness' [0.0, 1.0]
            raw_roughness = action.get('roughness')
            cleaned_roughness = None
            if raw_roughness is not None:
                if not is_finite_number(raw_roughness) or float(raw_roughness) < 0.0 or float(raw_roughness) > 1.0:
                    add_schema_error(f"Action [{action_idx}]: Parameter 'roughness' must be a number between 0.0 and 1.0.")
                else:
                    cleaned_roughness = float(raw_roughness)

            # Schema: optional 'metalness' [0.0, 1.0]
            raw_metalness = action.get('metalness')
            cleaned_metalness = None
            if raw_metalness is not None:
                if not is_finite_number(raw_metalness) or float(raw_metalness) < 0.0 or float(raw_metalness) > 1.0:
                    add_schema_error(f"Action [{action_idx}]: Parameter 'metalness' must be a number between 0.0 and 1.0.")
                else:
                    cleaned_metalness = float(raw_metalness)

            if len(schema_errors) > action_schema_errs_count:
                continue

            # Reference Resolution: Scene object
            target_obj = next((o for o in objects_list if o.get('id') == raw_obj_id), None)
            if not target_obj:
                add_reference_error(f"Action [{action_idx}]: Object '{raw_obj_id}' not found in scene.")
                continue

            mat = target_obj.setdefault('materialOverrides', {})
            if raw_color is not None:
                mat['color'] = raw_color[:30]
            if cleaned_roughness is not None:
                mat['roughness'] = cleaned_roughness
            if cleaned_metalness is not None:
                mat['metalness'] = cleaned_metalness

        # 6. CLEAR ROOM
        elif action_type == 'clear_room':
            raw_confirm = action.get('confirm')
            if raw_confirm is not None and not isinstance(raw_confirm, bool):
                add_schema_error(f"Action [{action_idx}]: Parameter 'confirm' must be a boolean.")

            if len(schema_errors) > action_schema_errs_count:
                continue

            objects_list.clear()

    # Calculate resulting candidate budget & containment
    try:
        after_budget = calculate_scene_budget(candidate_scene)
    except Exception as e:
        add_domain_error(f"Candidate scene failed budget or constraint validation: {str(e)}")
        after_budget = before_budget

    # Compute deterministic integer paise difference
    after_raw = after_budget.get('total_paise', 0)
    after_paise: int = int(after_raw) if isinstance(after_raw, (int, float, str)) else 0
    before_raw = before_budget.get('total_paise', 0)
    before_paise: int = int(before_raw) if isinstance(before_raw, (int, float, str)) else 0
    diff_paise = after_paise - before_paise
    diff_inr = f"{Decimal(diff_paise) / Decimal(100):+.2f}"

    constraints_raw = after_budget.get('room_constraints')
    constraints: dict[str, Any] = constraints_raw if isinstance(constraints_raw, dict) else {}
    room_containment_valid = bool(constraints.get('is_valid', True))
    room_violations = list(constraints.get('violations', []))

    if not room_containment_valid:
        add_domain_error(
            f"Candidate layout violates 3D room containment: {len(room_violations)} item(s) extend beyond room walls/ceiling."
        )

    # Budget ceiling check
    effective_max_budget = max_budget_paise
    if effective_max_budget is None and isinstance(current_scene, dict):
        effective_max_budget = (
            current_scene.get('budget_paise')
            or current_scene.get('budget')
            or current_scene.get('max_budget_paise')
        )

    if effective_max_budget is not None:
        try:
            effective_max_budget = int(effective_max_budget)
            if after_paise > effective_max_budget:
                add_budget_error(
                    f"Candidate layout cost exceeds budget limit: ₹{Decimal(after_paise)/100:.2f} exceeds ₹{Decimal(effective_max_budget)/100:.2f} limit."
                )
        except (ValueError, TypeError):
            pass

    budget_diff = {
        'currency': 'INR',
        'before_total_paise': before_paise,
        'before_paise': before_paise,
        'before_total_inr': before_budget.get('total_inr', '0.00'),
        'after_total_paise': after_paise,
        'after_paise': after_paise,
        'after_total_inr': after_budget.get('total_inr', '0.00'),
        'diff_paise': diff_paise,
        'diff_inr': diff_inr,
        'before_items_count': before_budget.get('total_items', 0),
        'after_items_count': after_budget.get('total_items', 0),
        'room_containment_valid': room_containment_valid,
        'room_violations': room_violations,
        'max_budget_paise': effective_max_budget,
        'is_budget_compliant': len(budget_errors) == 0,
    }

    schema_valid = len(schema_errors) == 0
    reference_valid = len(reference_errors) == 0
    domain_valid = len(domain_errors) == 0 and room_containment_valid
    budget_valid = len(budget_errors) == 0
    is_valid = len(errors) == 0 and domain_valid

    return {
        'is_valid': is_valid,
        'schema_valid': schema_valid,
        'reference_valid': reference_valid,
        'domain_valid': domain_valid,
        'budget_valid': budget_valid,
        'schema_errors': schema_errors,
        'reference_errors': reference_errors,
        'domain_errors': domain_errors,
        'budget_errors': budget_errors,
        'errors': errors,
        'warnings': warnings,
        'candidate_scene': candidate_scene,
        'budget_diff': budget_diff,
    }
