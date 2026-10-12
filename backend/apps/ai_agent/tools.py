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
                    'confirm': {'type': 'boolean', 'description': 'Confirmation flag.'},
                },
                'required': ['confirm'],
            },
        },
    ]


def validate_and_simulate_actions(
    current_scene: dict[str, Any],
    proposed_actions: list[dict[str, Any]]
) -> dict[str, Any]:
    """
    Deterministically validates and simulates proposed actions against current_scene.
    Does NOT mutate current_scene. Returns:
      - is_valid: bool (True if all proposed actions are allowlisted and pass validation)
      - errors: list[str] (blocking errors)
      - warnings: list[str] (non-blocking notices, e.g. unpriced items or room boundaries)
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
    warnings: list[str] = []

    # Calculate starting budget
    try:
        before_budget = calculate_scene_budget(current_scene)
    except Exception as e:
        before_budget = {'total_paise': 0, 'total_inr': '0.00', 'items': []}

    if not isinstance(proposed_actions, list):
        return {
            'is_valid': False,
            'errors': ["Proposed actions must be a list."],
            'warnings': [],
            'candidate_scene': candidate_scene,
            'budget_diff': {},
        }

    for action_idx, action in enumerate(proposed_actions):
        if not isinstance(action, dict):
            errors.append(f"Action at index {action_idx} must be a dictionary.")
            continue

        action_type = action.get('type') or action.get('action')
        if action_type not in ALLOWED_ACTION_TYPES:
            errors.append(
                f"Action [{action_idx}] '{action_type}' is not an allowlisted operation. "
                f"Allowed: {sorted(ALLOWED_ACTION_TYPES)}"
            )
            continue

        # 1. ADD FURNITURE
        if action_type == 'add_furniture':
            asset_id = action.get('asset_id')
            asset = FurnitureAsset.objects.filter(id=asset_id, is_active=True).first()
            if not asset:
                errors.append(f"Action [{action_idx}]: Asset '{asset_id}' does not exist in catalogue.")
                continue

            # Position
            raw_pos = action.get('position')
            dims = [float(asset.width), float(asset.height), float(asset.depth)]
            half_height = dims[1] / 2.0

            if raw_pos and isinstance(raw_pos, (list, tuple)) and len(raw_pos) == 3:
                try:
                    pos = validate_vector3(raw_pos, f"add_furniture.position")
                except Exception as e:
                    errors.append(f"Action [{action_idx}]: Invalid position vector: {e}")
                    continue
            else:
                # Default centered on floor
                pos = [0.0, half_height, 0.0]

            # Rotation
            raw_rot = action.get('rotation_euler', [0.0, 0.0, 0.0])
            try:
                rot = validate_vector3(raw_rot, f"add_furniture.rotation_euler")
            except Exception as e:
                errors.append(f"Action [{action_idx}]: Invalid rotation: {e}")
                continue

            # Scale
            raw_scale = action.get('scale', [1.0, 1.0, 1.0])
            try:
                scale = validate_vector3(raw_scale, f"add_furniture.scale", min_val=0.1, max_val=5.0)
            except Exception as e:
                errors.append(f"Action [{action_idx}]: Invalid scale: {e}")
                continue

            color = action.get('color', '#4f46e5')
            new_item_id = f"item-{uuid.uuid4().hex[:8]}"

            objects_list.append({
                'id': new_item_id,
                'assetId': asset.id,
                'name': asset.name,
                'dimensions': dims,
                'position': pos,
                'rotationEuler': rot,
                'scale': scale,
                'materialOverrides': {'color': color} if color else {},
            })

        # 2. MOVE OBJECT
        elif action_type == 'move_object':
            object_id = action.get('object_id')
            target_obj = next((o for o in objects_list if o.get('id') == object_id), None)
            if not target_obj:
                errors.append(f"Action [{action_idx}]: Object '{object_id}' not found in scene.")
                continue

            if 'position' in action:
                try:
                    pos = validate_vector3(action['position'], f"move_object.position")
                    target_obj['position'] = pos
                except Exception as e:
                    errors.append(f"Action [{action_idx}]: Invalid position: {e}")

            if 'rotation_euler' in action:
                try:
                    rot = validate_vector3(action['rotation_euler'], f"move_object.rotation_euler")
                    target_obj['rotationEuler'] = rot
                except Exception as e:
                    errors.append(f"Action [{action_idx}]: Invalid rotation: {e}")

        # 3. REPLACE FURNITURE
        elif action_type == 'replace_furniture':
            object_id = action.get('object_id')
            new_asset_id = action.get('new_asset_id')
            target_obj = next((o for o in objects_list if o.get('id') == object_id), None)
            if not target_obj:
                errors.append(f"Action [{action_idx}]: Object '{object_id}' not found in scene.")
                continue

            asset = FurnitureAsset.objects.filter(id=new_asset_id, is_active=True).first()
            if not asset:
                errors.append(f"Action [{action_idx}]: Replacement asset '{new_asset_id}' not in catalogue.")
                continue

            target_obj['assetId'] = asset.id
            target_obj['name'] = asset.name
            target_obj['dimensions'] = [float(asset.width), float(asset.height), float(asset.depth)]
            # Adjust vertical height to rest on floor
            if 'position' in target_obj and len(target_obj['position']) == 3:
                target_obj['position'][1] = float(asset.height) / 2.0

        # 4. REMOVE OBJECT
        elif action_type == 'remove_object':
            object_id = action.get('object_id')
            exists = any(o.get('id') == object_id for o in objects_list)
            if not exists:
                errors.append(f"Action [{action_idx}]: Object '{object_id}' not found in scene.")
                continue
            objects_list[:] = [o for o in objects_list if o.get('id') != object_id]

        # 5. SET MATERIAL
        elif action_type == 'set_material':
            object_id = action.get('object_id')
            target_obj = next((o for o in objects_list if o.get('id') == object_id), None)
            if not target_obj:
                errors.append(f"Action [{action_idx}]: Object '{object_id}' not found in scene.")
                continue

            mat = target_obj.setdefault('materialOverrides', {})
            if 'color' in action and isinstance(action['color'], str):
                mat['color'] = action['color'][:30]
            if 'roughness' in action and is_finite_number(action['roughness']):
                mat['roughness'] = max(0.0, min(1.0, float(action['roughness'])))
            if 'metalness' in action and is_finite_number(action['metalness']):
                mat['metalness'] = max(0.0, min(1.0, float(action['metalness'])))

        # 6. CLEAR ROOM
        elif action_type == 'clear_room':
            objects_list.clear()

    # Calculate resulting candidate budget & containment
    try:
        after_budget = calculate_scene_budget(candidate_scene)
    except Exception as e:
        errors.append(f"Candidate scene failed budget or constraint validation: {str(e)}")
        after_budget = before_budget

    # Compute deterministic integer paise difference
    diff_paise = after_budget.get('total_paise', 0) - before_budget.get('total_paise', 0)
    diff_inr = f"{Decimal(diff_paise) / Decimal(100):+.2f}"

    budget_diff = {
        'currency': 'INR',
        'before_total_paise': before_budget.get('total_paise', 0),
        'before_paise': before_budget.get('total_paise', 0),
        'before_total_inr': before_budget.get('total_inr', '0.00'),
        'after_total_paise': after_budget.get('total_paise', 0),
        'after_paise': after_budget.get('total_paise', 0),
        'after_total_inr': after_budget.get('total_inr', '0.00'),
        'diff_paise': diff_paise,
        'diff_inr': diff_inr,
        'before_items_count': before_budget.get('total_items', 0),
        'after_items_count': after_budget.get('total_items', 0),
        'room_containment_valid': after_budget.get('room_constraints', {}).get('is_valid', True),
        'room_violations': after_budget.get('room_constraints', {}).get('violations', []),
    }

    if not budget_diff['room_containment_valid']:
        errors.append(
            f"Candidate layout violates 3D room containment: {len(budget_diff['room_violations'])} item(s) extend beyond room walls/ceiling."
        )

    return {
        'is_valid': len(errors) == 0 and budget_diff.get('room_containment_valid', True),
        'errors': errors,
        'warnings': warnings,
        'candidate_scene': candidate_scene,
        'budget_diff': budget_diff,
    }
