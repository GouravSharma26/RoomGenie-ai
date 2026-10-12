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


def compute_transformed_aabb_extents(
    dimensions: list[float],
    scale: list[float],
    rotation_euler: list[float]
) -> tuple[float, float, float]:
    """
    Computes the world half-extents (Ex, Ey, Ez) of a 3D box oriented by
    Euler angles (Three.js standard XYZ order in radians) and scaled by scale factors.
    Uses the exact analytical AABB formula for oriented bounding boxes.
    """
    hx = (dimensions[0] * scale[0]) / 2.0
    hy = (dimensions[1] * scale[1]) / 2.0
    hz = (dimensions[2] * scale[2]) / 2.0

    rx, ry, rz = rotation_euler
    c1, s1 = math.cos(rx), math.sin(rx)
    c2, s2 = math.cos(ry), math.sin(ry)
    c3, s3 = math.cos(rz), math.sin(rz)

    # Standard Three.js Euler 'XYZ' rotation matrix elements
    r00 = c2 * c3
    r01 = -c2 * s3
    r02 = s2

    r10 = c1 * s3 + c3 * s1 * s2
    r11 = c1 * c3 - s1 * s2 * s3
    r12 = -c2 * s1

    r20 = s1 * s3 - c1 * c3 * s2
    r21 = c3 * s1 + c1 * s2 * s3
    r22 = c1 * c2

    ex = abs(r00) * hx + abs(r01) * hy + abs(r02) * hz
    ey = abs(r10) * hx + abs(r11) * hy + abs(r12) * hz
    ez = abs(r20) * hx + abs(r21) * hy + abs(r22) * hz

    return (ex, ey, ez)


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

        # Position (X, Y, Z) and full transformed 3D footprint containment check
        pos = validate_vector3(obj.get('position', [0.0, 0.0, 0.0]), f"objects[{idx}].position")

        # Compute exact world half-extents considering scale and 3D Euler rotation
        ex, ey, ez = compute_transformed_aabb_extents(dims, scale, rotation)

        min_x = pos[0] - ex
        max_x = pos[0] + ex
        min_y = pos[1] - ey
        max_y = pos[1] + ey
        min_z = pos[2] - ez
        max_z = pos[2] + ez

        half_room_w = room_w / 2.0
        half_room_l = room_l / 2.0
        tolerance = 0.01  # 1cm numerical tolerance for floating-point calculations

        # 1. Room Width containment (X axis)
        if min_x < -half_room_w - tolerance or max_x > half_room_w + tolerance:
            raise serializers.ValidationError(
                f"objects[{idx}] ('{name}') extends beyond room width boundaries: "
                f"X span [{min_x:.2f}m, {max_x:.2f}m] exceeds room limits [{-half_room_w:.2f}m, {half_room_w:.2f}m]."
            )

        # 2. Room Length containment (Z axis)
        if min_z < -half_room_l - tolerance or max_z > half_room_l + tolerance:
            raise serializers.ValidationError(
                f"objects[{idx}] ('{name}') extends beyond room length boundaries: "
                f"Z span [{min_z:.2f}m, {max_z:.2f}m] exceeds room limits [{-half_room_l:.2f}m, {half_room_l:.2f}m]."
            )

        # 3. Room Floor containment (Y axis base)
        if min_y < 0.0 - tolerance:
            raise serializers.ValidationError(
                f"objects[{idx}] ('{name}') extends below floor level: "
                f"base Y ({min_y:.2f}m) penetrates the floor plane (0.00m)."
            )

        # 4. Room Ceiling containment (Y axis top)
        if max_y > room_h + tolerance:
            raise serializers.ValidationError(
                f"objects[{idx}] ('{name}') extends above room ceiling: "
                f"top Y ({max_y:.2f}m) exceeds ceiling height ({room_h:.2f}m)."
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
