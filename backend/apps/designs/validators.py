import math
from rest_framework import serializers

SUPPORTED_SCHEMA_VERSIONS = {1}
SUPPORTED_UNITS = {'m'}

MIN_ROOM_WIDTH = 2.0
MAX_ROOM_WIDTH = 25.0
MIN_ROOM_LENGTH = 2.0
MAX_ROOM_LENGTH = 25.0
MIN_ROOM_HEIGHT = 2.0
MAX_ROOM_HEIGHT = 10.0

MIN_OBJECT_DIM = 0.05
MAX_OBJECT_DIM = 20.0
MIN_SCALE = 0.1
MAX_SCALE = 5.0
MAX_OBJECT_COUNT = 150


def is_finite_number(val) -> bool:
    if isinstance(val, bool):
        return False
    if not isinstance(val, (int, float)):
        return False
    return not (math.isnan(val) or math.isinf(val))


def validate_vector3(vec, field_name: str, min_val: float = None, max_val: float = None) -> list[float]:
    if not isinstance(vec, (list, tuple)) or len(vec) != 3:
        raise serializers.ValidationError(
            f"{field_name} must be a 3-element array of numbers [x, y, z]."
        )
    cleaned = []
    for i, v in enumerate(vec):
        if not is_finite_number(v):
            raise serializers.ValidationError(
                f"{field_name}[{i}] must be a finite number, received: {v}."
            )
        v_float = float(v)
        if min_val is not None and v_float < min_val:
            raise serializers.ValidationError(
                f"{field_name}[{i}] ({v_float}) is below minimum allowed value ({min_val})."
            )
        if max_val is not None and v_float > max_val:
            raise serializers.ValidationError(
                f"{field_name}[{i}] ({v_float}) exceeds maximum allowed value ({max_val})."
            )
        cleaned.append(v_float)
    return cleaned


def validate_canonical_scene(data: dict) -> dict:
    """
    Authoritative backend validation for canonical scene JSON schemas.
    Validates units, coordinate dimensions, room boundary rules, and transforms.
    """
    if not isinstance(data, dict):
        raise serializers.ValidationError("Scene payload must be a JSON object.")

    # 1. Schema Version
    schema_version = data.get('schemaVersion')
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise serializers.ValidationError(
            f"Unsupported schemaVersion: {schema_version}. Supported versions: {sorted(SUPPORTED_SCHEMA_VERSIONS)}."
        )

    # 2. Measurement Unit
    unit = data.get('unit')
    if unit not in SUPPORTED_UNITS:
        raise serializers.ValidationError(
            f"Unsupported unit: '{unit}'. RoomGenie authoritatively requires metres ('m')."
        )

    # 3. Room Envelope
    room = data.get('room')
    if not isinstance(room, dict):
        raise serializers.ValidationError("Scene must define a 'room' object.")

    for dim_key, (min_dim, max_dim) in {
        'width': (MIN_ROOM_WIDTH, MAX_ROOM_WIDTH),
        'length': (MIN_ROOM_LENGTH, MAX_ROOM_LENGTH),
        'height': (MIN_ROOM_HEIGHT, MAX_ROOM_HEIGHT),
    }.items():
        val = room.get(dim_key)
        if not is_finite_number(val):
            raise serializers.ValidationError(
                f"room.{dim_key} must be a finite positive number."
            )
        val_float = float(val)
        if val_float < min_dim or val_float > max_dim:
            raise serializers.ValidationError(
                f"room.{dim_key} must be between {min_dim}m and {max_dim}m (got {val_float}m)."
            )

    room_w = float(room['width'])
    room_l = float(room['length'])
    room_h = float(room['height'])

    # 4. Objects Array
    objects = data.get('objects')
    if not isinstance(objects, list):
        raise serializers.ValidationError("Scene 'objects' must be a list.")
    if len(objects) > MAX_OBJECT_COUNT:
        raise serializers.ValidationError(
            f"Maximum object limit exceeded ({len(objects)} > {MAX_OBJECT_COUNT})."
        )

    seen_ids = set()
    cleaned_objects = []

    for idx, obj in enumerate(objects):
        if not isinstance(obj, dict):
            raise serializers.ValidationError(f"objects[{idx}] must be an object.")

        obj_id = str(obj.get('id', '')).strip()
        if not obj_id:
            raise serializers.ValidationError(f"objects[{idx}].id must be a non-empty string.")
        if obj_id in seen_ids:
            raise serializers.ValidationError(f"Duplicate object ID detected: '{obj_id}'.")
        seen_ids.add(obj_id)

        asset_id = str(obj.get('assetId', '')).strip()
        if not asset_id:
            raise serializers.ValidationError(f"objects[{idx}].assetId must be a non-empty string.")

        name = str(obj.get('name', 'Furniture')).strip()

        # Dimensions
        dims = validate_vector3(
            obj.get('dimensions', [1.0, 1.0, 1.0]),
            f"objects[{idx}].dimensions",
            min_val=MIN_OBJECT_DIM,
            max_val=MAX_OBJECT_DIM
        )

        # Scale Multipliers
        scale = validate_vector3(
            obj.get('scale', [1.0, 1.0, 1.0]),
            f"objects[{idx}].scale",
            min_val=MIN_SCALE,
            max_val=MAX_SCALE
        )

        # Rotation Euler
        rotation = validate_vector3(
            obj.get('rotationEuler', [0.0, 0.0, 0.0]),
            f"objects[{idx}].rotationEuler"
        )

        # Position (X, Y, Z) with room boundary bounds check
        # Room boundaries: X in [-room_w/2, +room_w/2], Z in [-room_l/2, +room_l/2]
        # Y in [0, room_h]
        tolerance = 0.5  # 50cm tolerance to permit boundary edge alignment
        max_x = (room_w / 2.0) + tolerance
        max_z = (room_l / 2.0) + tolerance
        max_y = room_h + tolerance

        pos = validate_vector3(obj.get('position', [0.0, 0.0, 0.0]), f"objects[{idx}].position")
        if abs(pos[0]) > max_x:
            raise serializers.ValidationError(
                f"objects[{idx}] position X ({pos[0]:.2f}m) exceeds room width bounds (±{room_w/2:.2f}m)."
            )
        if abs(pos[2]) > max_z:
            raise serializers.ValidationError(
                f"objects[{idx}] position Z ({pos[2]:.2f}m) exceeds room length bounds (±{room_l/2:.2f}m)."
            )
        if pos[1] < -0.1 or pos[1] > max_y:
            raise serializers.ValidationError(
                f"objects[{idx}] position Y ({pos[1]:.2f}m) must be within floor level and ceiling (0 - {room_h:.2f}m)."
            )

        # Material Overrides (optional)
        mat_overrides = obj.get('materialOverrides')
        cleaned_mat = {}
        if isinstance(mat_overrides, dict):
            if 'color' in mat_overrides and isinstance(mat_overrides['color'], str):
                cleaned_mat['color'] = mat_overrides['color'][:30]
            if 'roughness' in mat_overrides and is_finite_number(mat_overrides['roughness']):
                cleaned_mat['roughness'] = max(0.0, min(1.0, float(mat_overrides['roughness'])))
            if 'metalness' in mat_overrides and is_finite_number(mat_overrides['metalness']):
                cleaned_mat['metalness'] = max(0.0, min(1.0, float(mat_overrides['metalness'])))

        cleaned_objects.append({
            'id': obj_id,
            'assetId': asset_id,
            'name': name,
            'position': pos,
            'rotationEuler': rotation,
            'scale': scale,
            'dimensions': dims,
            'materialOverrides': cleaned_mat,
        })

    return {
        'schemaVersion': schema_version,
        'unit': 'm',
        'room': {
            'width': room_w,
            'length': room_l,
            'height': room_h,
        },
        'objects': cleaned_objects,
    }
