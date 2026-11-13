import copy
import uuid
import time
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
from apps.ai_agent.sockets import (
    get_socket_definition,
    is_compatible_with_socket,
    compute_child_transform_from_socket,
    check_relationship_cycle,
    validate_room_footprint_containment,
    check_obb_collisions_3d,
    check_doorway_landing_clearance,
)

# Allowlisted agent action types
ALLOWED_ACTION_TYPES = {
    'add_furniture',
    'move_object',
    'replace_furniture',
    'remove_object',
    'set_material',
    'clear_room',
    'attach_to_socket',
    'propose_zone_arrangement',
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
                    'object_id': {
                        'type': 'string',
                        'description': 'Optional unique instance ID for referencing this item in subsequent actions.',
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
        {
            'name': 'attach_to_socket',
            'description': 'Attach a child furniture item to an anchor furniture item via a designated spatial socket with strict relative transform calculation.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'child_object_id': {
                        'type': 'string',
                        'description': 'Placement ID of the child item in the scene to be attached.',
                    },
                    'anchor_object_id': {
                        'type': 'string',
                        'description': 'Placement ID of the anchor host furniture item in the scene.',
                    },
                    'socket_id': {
                        'type': 'string',
                        'description': 'Authoritative socket ID registered on the anchor item (e.g. "sofa-front-table", "sofa-left-accent", "bed-left-nightstand", "desk-knee-well-chair").',
                    },
                    'gap_meters': {
                        'type': 'number',
                        'description': 'Physical gap distance in metres between anchor and child surfaces. If omitted, socket recommendedGap is used.',
                    },
                    'relative_yaw': {
                        'type': 'number',
                        'description': 'Optional additional relative yaw rotation in radians (default: 0.0).',
                    },
                },
                'required': ['child_object_id', 'anchor_object_id', 'socket_id'],
            },
        },
        {
            'name': 'propose_zone_arrangement',
            'description': 'Propose a complete functional room zone arrangement (living, sleeping, workspace, dining) respecting room boundaries, openings, sockets, and existing furniture.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'zone_type': {
                        'type': 'string',
                        'enum': ['living', 'sleeping', 'workspace', 'dining'],
                        'description': 'Functional category of the room zone.',
                    },
                    'intent': {
                        'type': 'string',
                        'description': 'Natural language description of the design intent (e.g. "Create a conversational seating area with sofa, coffee table, and accent chairs").',
                    },
                    'requirements': {
                        'type': 'object',
                        'properties': {
                            'required_categories': {
                                'type': 'array',
                                'items': {'type': 'string'},
                                'description': 'Required furniture categories (e.g. ["seating", "tables"]).',
                            },
                            'preferred_categories': {
                                'type': 'array',
                                'items': {'type': 'string'},
                                'description': 'Preferred optional furniture categories.',
                            },
                            'preserve_existing_furniture': {
                                'type': 'boolean',
                                'description': 'If true, existing furniture must not be removed, replaced, or displaced.',
                            },
                        },
                    },
                },
                'required': ['zone_type', 'intent'],
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
         - Incompatible socket attachment or occupied socket.
         - Physical OBB-on-OBB collision between unrelated furniture.
         - Doorway landing obstruction.
         - Zone preservation violations.
      4. Budget Errors:
         - Layout cost exceeds authoritative design budget limit.

    Returns:
      - is_valid: bool (True only if all actions succeed across all categories)
      - schema_valid: bool (True if all proposed actions adhere to tool schemas and parameter types)
      - reference_valid: bool (True if all catalogue assets and scene objects resolve)
      - domain_valid: bool (True if room containment, collisions, sockets, and spatial bounds are satisfied)
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

            # Dimensions and floor grounding
            dims = [float(asset.width), float(asset.height), float(asset.depth)]
            half_height = (dims[1] * cleaned_scale[1]) / 2.0
            if cleaned_pos is not None:
                pos = list(cleaned_pos)
                # If LLM provided Y=0 (floor level), ground object automatically at half-height
                if abs(pos[1]) < 0.01:
                    pos[1] = half_height
            else:
                pos = [0.0, half_height, 0.0]

            color = raw_color if raw_color is not None else '#4f46e5'
            custom_item_id = action.get('object_id')
            if custom_item_id and isinstance(custom_item_id, str) and custom_item_id.strip():
                new_item_id = custom_item_id.strip()
            else:
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
            raw_obj_id = action.get('object_id')
            if raw_obj_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'object_id' for 'move_object'.")
            elif not isinstance(raw_obj_id, str) or not raw_obj_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'object_id' must be a non-empty string.")

            cleaned_pos = None
            if 'position' in action:
                try:
                    cleaned_pos = validate_vector3(action['position'], f"move_object.position")
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid position vector: {e}")

            cleaned_rot = None
            if 'rotation_euler' in action:
                try:
                    cleaned_rot = validate_vector3(action['rotation_euler'], f"move_object.rotation_euler")
                except Exception as e:
                    add_schema_error(f"Action [{action_idx}]: Invalid rotation vector: {e}")

            if len(schema_errors) > action_schema_errs_count:
                continue

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

            target_obj = next((o for o in objects_list if o.get('id') == raw_obj_id), None)
            if not target_obj:
                add_reference_error(f"Action [{action_idx}]: Object '{raw_obj_id}' not found in scene.")
                continue

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

            exists = any(o.get('id') == raw_obj_id for o in objects_list)
            if not exists:
                add_reference_error(f"Action [{action_idx}]: Object '{raw_obj_id}' not found in scene.")
                continue

            objects_list[:] = [o for o in objects_list if o.get('id') != raw_obj_id]
            # Clean up relationships involving removed item
            if 'relationships' in candidate_scene:
                candidate_scene['relationships'] = [
                    r for r in candidate_scene['relationships']
                    if r.get('anchorObjectId') != raw_obj_id and r.get('childObjectId') != raw_obj_id
                ]

        # 5. SET MATERIAL
        elif action_type == 'set_material':
            raw_obj_id = action.get('object_id')
            if raw_obj_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'object_id' for 'set_material'.")
            elif not isinstance(raw_obj_id, str) or not raw_obj_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'object_id' must be a non-empty string.")

            raw_color = action.get('color')
            if raw_color is not None and not isinstance(raw_color, str):
                add_schema_error(f"Action [{action_idx}]: Parameter 'color' must be a string.")

            raw_roughness = action.get('roughness')
            cleaned_roughness = None
            if raw_roughness is not None:
                if not is_finite_number(raw_roughness) or float(raw_roughness) < 0.0 or float(raw_roughness) > 1.0:
                    add_schema_error(f"Action [{action_idx}]: Parameter 'roughness' must be a number between 0.0 and 1.0.")
                else:
                    cleaned_roughness = float(raw_roughness)

            raw_metalness = action.get('metalness')
            cleaned_metalness = None
            if raw_metalness is not None:
                if not is_finite_number(raw_metalness) or float(raw_metalness) < 0.0 or float(raw_metalness) > 1.0:
                    add_schema_error(f"Action [{action_idx}]: Parameter 'metalness' must be a number between 0.0 and 1.0.")
                else:
                    cleaned_metalness = float(raw_metalness)

            if len(schema_errors) > action_schema_errs_count:
                continue

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
            if 'relationships' in candidate_scene:
                candidate_scene['relationships'].clear()
            if 'zones' in candidate_scene:
                candidate_scene['zones'].clear()

        # 7. ATTACH TO SOCKET
        elif action_type == 'attach_to_socket':
            raw_child_id = action.get('child_object_id')
            if raw_child_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'child_object_id' for 'attach_to_socket'.")
            elif not isinstance(raw_child_id, str) or not raw_child_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'child_object_id' must be a non-empty string.")

            raw_anchor_id = action.get('anchor_object_id')
            if raw_anchor_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'anchor_object_id' for 'attach_to_socket'.")
            elif not isinstance(raw_anchor_id, str) or not raw_anchor_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'anchor_object_id' must be a non-empty string.")

            raw_socket_id = action.get('socket_id')
            if raw_socket_id is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'socket_id' for 'attach_to_socket'.")
            elif not isinstance(raw_socket_id, str) or not raw_socket_id.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'socket_id' must be a non-empty string.")

            raw_gap = action.get('gap_meters')
            cleaned_gap = None
            if raw_gap is not None:
                if not is_finite_number(raw_gap) or float(raw_gap) < 0.0:
                    add_schema_error(f"Action [{action_idx}]: Parameter 'gap_meters' must be a non-negative finite number.")
                else:
                    cleaned_gap = float(raw_gap)

            raw_yaw = action.get('relative_yaw')
            cleaned_yaw = 0.0
            if raw_yaw is not None:
                if not is_finite_number(raw_yaw):
                    add_schema_error(f"Action [{action_idx}]: Parameter 'relative_yaw' must be a finite number.")
                else:
                    cleaned_yaw = float(raw_yaw)

            # Self-attachment validation
            if raw_child_id and raw_anchor_id and raw_child_id == raw_anchor_id:
                add_domain_error(f"Action [{action_idx}]: Item '{raw_child_id}' cannot attach to itself.")

            if len(schema_errors) > action_schema_errs_count:
                continue

            # Reference Resolution: Anchor and Child in scene
            anchor_obj = next((o for o in objects_list if o.get('id') == raw_anchor_id), None)
            if not anchor_obj:
                add_reference_error(f"Action [{action_idx}]: Anchor item '{raw_anchor_id}' not found in scene.")
                continue

            child_obj = next((o for o in objects_list if o.get('id') == raw_child_id), None)
            if not child_obj:
                add_reference_error(f"Action [{action_idx}]: Child item '{raw_child_id}' not found in scene.")
                continue

            # Authoritative socket definition lookup
            socket_def = get_socket_definition(anchor_obj.get('assetId', ''), raw_socket_id)
            if not socket_def:
                add_domain_error(
                    f"Action [{action_idx}]: Socket '{raw_socket_id}' is not registered on anchor "
                    f"'{anchor_obj.get('name')}' ({anchor_obj.get('assetId')})."
                )
                continue

            # Semantic compatibility check
            child_asset = FurnitureAsset.objects.filter(id=child_obj.get('assetId')).first()  # pyrefly: ignore[missing-attribute]
            child_cat = child_asset.category if child_asset else 'decor'
            child_tags = child_asset.style_tags if child_asset else []

            is_compat, compat_reason = is_compatible_with_socket(socket_def, child_cat, child_tags)
            if not is_compat:
                add_domain_error(f"Action [{action_idx}]: {compat_reason}")
                continue

            # Socket exclusivity check (is socket occupied by a different item?)
            relationships = candidate_scene.setdefault('relationships', [])
            for r in relationships:
                if r.get('anchorObjectId') == raw_anchor_id and r.get('socketId') == raw_socket_id:
                    if r.get('childObjectId') != raw_child_id:
                        add_domain_error(
                            f"Action [{action_idx}]: Socket '{socket_def.get('name')}' is already occupied by item '{r.get('childObjectId')}'."
                        )
                        break

            # Graph cycle detection
            if check_relationship_cycle(relationships, raw_child_id, raw_anchor_id):
                add_domain_error(
                    f"Action [{action_idx}]: Cycle detected: '{anchor_obj.get('name')}' is already a descendant of '{child_obj.get('name')}'."
                )
                continue

            # Gap limits check
            if cleaned_gap is not None:
                if cleaned_gap < socket_def['min_gap'] or cleaned_gap > socket_def['max_gap']:
                    add_domain_error(
                        f"Action [{action_idx}]: Requested gap {cleaned_gap}m is outside permitted range "
                        f"[{socket_def['min_gap']}m, {socket_def['max_gap']}m] for socket '{socket_def.get('name')}'."
                    )
                    continue

            # Deterministic transform calculation
            anchor_pos = [float(p) for p in anchor_obj.get('position', [0.0, 0.0, 0.0])]
            anchor_rot = [float(r) for r in anchor_obj.get('rotationEuler', [0.0, 0.0, 0.0])]
            anchor_dims = [float(d) for d in anchor_obj.get('dimensions', [1.0, 1.0, 1.0])]
            anchor_scale = [float(s) for s in anchor_obj.get('scale', [1.0, 1.0, 1.0])]

            child_dims = [float(d) for d in child_obj.get('dimensions', [1.0, 1.0, 1.0])]
            child_scale = [float(s) for s in child_obj.get('scale', [1.0, 1.0, 1.0])]

            transform_res = compute_child_transform_from_socket(
                anchor_pos=anchor_pos,
                anchor_yaw=anchor_rot[1] if len(anchor_rot) > 1 else 0.0,
                anchor_dims=anchor_dims,
                anchor_scale=anchor_scale,
                child_dims=child_dims,
                child_scale=child_scale,
                socket_def=socket_def,
                desired_gap=cleaned_gap,
                relative_yaw=cleaned_yaw,
            )

            # Build candidate child placement for physical validation
            candidate_child = dict(child_obj)
            candidate_child['position'] = transform_res['position']
            candidate_child['rotationEuler'] = transform_res['rotation_euler']

            # Physical validation: Room boundary / footprint containment
            containment_violations = validate_room_footprint_containment(candidate_child, room)
            if containment_violations:
                add_domain_error(
                    f"Action [{action_idx}]: Attached item '{child_obj.get('name')}' violates room boundary: "
                    + "; ".join(containment_violations)
                )
                continue

            # Physical validation: OBB collisions with unrelated items (excluding anchor and self)
            collision_detected = False
            for other_obj in objects_list:
                if other_obj.get('id') == raw_child_id or other_obj.get('id') == raw_anchor_id:
                    continue
                if check_obb_collisions_3d(candidate_child, other_obj):
                    add_domain_error(
                        f"Action [{action_idx}]: Attached item '{child_obj.get('name')}' physically collides with '{other_obj.get('name')}'."
                    )
                    collision_detected = True
                    break
            if collision_detected:
                continue

            # Physical validation: Doorway landing zone protection
            door_violations = check_doorway_landing_clearance(candidate_child, room)
            if door_violations:
                add_domain_error(
                    f"Action [{action_idx}]: Attached item '{child_obj.get('name')}' blocks door circulation: "
                    + "; ".join(door_violations)
                )
                continue

            # Mutate child position & rotation in simulation scene
            child_obj['position'] = transform_res['position']
            child_obj['rotationEuler'] = transform_res['rotation_euler']

            # Record relationship (one-anchor-per-child rule: replace any previous attachment for this child)
            relationships[:] = [r for r in relationships if r.get('childObjectId') != raw_child_id]
            relationships.append({
                'id': f"rel-{raw_anchor_id}-{raw_socket_id}-{raw_child_id}",
                'anchorObjectId': raw_anchor_id,
                'childObjectId': raw_child_id,
                'socketId': raw_socket_id,
                'gap': transform_res['gap'],
                'relativeYaw': transform_res['relative_yaw'],
                'createdAt': int(time.time() * 1000),
            })

        # 8. PROPOSE ZONE ARRANGEMENT
        elif action_type == 'propose_zone_arrangement':
            raw_zone_type = action.get('zone_type')
            allowed_zone_types = {'living', 'sleeping', 'workspace', 'dining'}
            if raw_zone_type is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'zone_type' for 'propose_zone_arrangement'.")
            elif not isinstance(raw_zone_type, str) or raw_zone_type.lower() not in allowed_zone_types:
                add_schema_error(
                    f"Action [{action_idx}]: Unsupported zone_type '{raw_zone_type}'. Allowed: {sorted(allowed_zone_types)}."
                )

            raw_intent = action.get('intent')
            if raw_intent is None:
                add_schema_error(f"Action [{action_idx}]: Missing required parameter 'intent' for 'propose_zone_arrangement'.")
            elif not isinstance(raw_intent, str) or not raw_intent.strip():
                add_schema_error(f"Action [{action_idx}]: Parameter 'intent' must be a non-empty string.")

            reqs = action.get('requirements')
            preserve_furniture = True
            if reqs is not None:
                if not isinstance(reqs, dict):
                    add_schema_error(f"Action [{action_idx}]: Parameter 'requirements' must be a dictionary.")
                else:
                    if 'preserve_existing_furniture' in reqs and isinstance(reqs['preserve_existing_furniture'], bool):
                        preserve_furniture = reqs['preserve_existing_furniture']

            if len(schema_errors) > action_schema_errs_count:
                continue

            # Preservation check: if preserve_existing_furniture is True, no destructive actions allowed in proposal
            if preserve_furniture:
                destructive_types = {'clear_room', 'remove_object'}
                has_destructive = any(
                    isinstance(a, dict) and (a.get('type') in destructive_types or a.get('action') in destructive_types)
                    for a in proposed_actions
                )
                if has_destructive:
                    add_domain_error(
                        f"Action [{action_idx}]: Preservation violation: 'preserve_existing_furniture' is True, "
                        "but proposal contains destructive operations ('clear_room' or 'remove_object')."
                    )
                    continue

            # Room space feasibility check
            room_area = room_w * room_l
            if room_area < 2.5:
                add_domain_error(
                    f"Action [{action_idx}]: Insufficient room space ({room_area:.2f}m²) for functional '{raw_zone_type}' zone arrangement."
                )
                continue

            # Record zone in candidate scene
            zones = candidate_scene.setdefault('zones', [])
            zone_id = f"zone-{raw_zone_type}-{uuid.uuid4().hex[:6]}"
            zone_members = [o.get('id') for o in objects_list if o.get('id')]
            zones.append({
                'id': zone_id,
                'type': raw_zone_type.lower(),
                'name': f"{raw_zone_type.capitalize()} Area",
                'memberObjectIds': zone_members,
            })

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
