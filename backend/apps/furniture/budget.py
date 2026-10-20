from decimal import Decimal
from typing import Any
from django.core.exceptions import ValidationError
from rest_framework import serializers
from apps.furniture.models import FurnitureAsset
from apps.designs.validators import (
    compute_transformed_aabb_extents,
    is_finite_number,
    validate_vector3,
)


def validate_budget_scene_data(scene_data: dict[str, Any]) -> tuple[float, float, float, list[dict[str, Any]]]:
    """
    Validates budget scene inputs to ensure malformed data cannot produce
    a normal-looking estimate through permissive defaults.
    """
    if not isinstance(scene_data, dict):
        raise serializers.ValidationError("Scene payload must be a JSON object.")

    room = scene_data.get('room')
    if not isinstance(room, dict):
        raise serializers.ValidationError(
            "Scene must define a 'room' dictionary with 'width', 'length', and 'height'."
        )

    for dim_key in ('width', 'length', 'height'):
        if dim_key not in room:
            raise serializers.ValidationError(f"room.{dim_key} is required.")
        val = room[dim_key]
        if not is_finite_number(val) or float(val) <= 0.0:
            raise serializers.ValidationError(
                f"room.{dim_key} must be a positive finite number, received: {val}."
            )

    room_w = float(room['width'])
    room_l = float(room['length'])
    room_h = float(room['height'])

    raw_objects = scene_data.get('objects')
    if not isinstance(raw_objects, list):
        raise serializers.ValidationError("Scene 'objects' must be a list.")

    validated_objects = []
    for idx, obj in enumerate(raw_objects):
        if not isinstance(obj, dict):
            raise serializers.ValidationError(f"objects[{idx}] must be a dictionary.")

        placement_id = obj.get('id', f'item-{idx}')
        if not isinstance(placement_id, str):
            placement_id = str(placement_id)

        asset_id = obj.get('assetId')
        if asset_id is not None and not isinstance(asset_id, str):
            raise serializers.ValidationError(f"objects[{idx}].assetId must be a string or null.")

        name = obj.get('name', 'Furniture Item')
        if not isinstance(name, str):
            name = str(name)

        # Validate dimensions if provided
        if 'dimensions' in obj:
            dims = validate_vector3(obj['dimensions'], f"objects[{idx}].dimensions", min_val=0.01)
        else:
            dims = None

        # Validate position if provided
        if 'position' in obj:
            pos = validate_vector3(obj['position'], f"objects[{idx}].position")
        else:
            pos = [0.0, 0.0, 0.0]

        # Validate scale if provided
        if 'scale' in obj:
            scale = validate_vector3(obj['scale'], f"objects[{idx}].scale", min_val=0.01)
        else:
            scale = [1.0, 1.0, 1.0]

        # Validate rotationEuler if provided
        if 'rotationEuler' in obj:
            rot = validate_vector3(obj['rotationEuler'], f"objects[{idx}].rotationEuler")
        else:
            rot = [0.0, 0.0, 0.0]

        validated_objects.append({
            'id': placement_id,
            'assetId': asset_id,
            'name': name,
            'dimensions': dims,
            'position': pos,
            'scale': scale,
            'rotationEuler': rot,
        })

    return room_w, room_l, room_h, validated_objects


def calculate_scene_budget(
    scene_data: dict[str, Any],
    design_title: str | None = None
) -> dict[str, Any]:
    """
    Deterministic, authoritative backend budget calculator for 3D room scenes.
    - All money totals are computed strictly using integer paise (INR minor units).
    - Unpriced or unregistered assets are labeled 'unpriced'/'unregistered' and NOT invented.
    - Room containment constraints are evaluated against the canonical room dimensions.
    """
    room_w, room_l, room_h, raw_objects = validate_budget_scene_data(scene_data)

    # Pre-fetch catalogue assets for all asset IDs in the scene
    asset_ids = {obj.get('assetId') for obj in raw_objects if obj.get('assetId')}
    assets_by_id = {
        asset.id: asset
        for asset in FurnitureAsset.objects.filter(id__in=asset_ids)  # pyrefly: ignore[missing-attribute]
    }

    total_paise = 0
    priced_count = 0
    unpriced_count = 0
    has_unknown_prices = False

    category_stats: dict[str, dict[str, Any]] = {}
    item_breakdown: list[dict[str, Any]] = []
    boundary_violations: list[dict[str, Any]] = []

    half_room_w = room_w / 2.0
    half_room_l = room_l / 2.0
    tolerance = 0.01  # 1cm tolerance

    for idx, obj in enumerate(raw_objects):
        placement_id = obj.get('id', f'item-{idx}')
        asset_id = obj.get('assetId')
        item_name = obj.get('name', 'Furniture Item')
        dimensions = obj.get('dimensions')
        asset = assets_by_id.get(asset_id) if asset_id else None
        if dimensions is None:
            if asset:
                dimensions = [float(asset.width), float(asset.height), float(asset.depth)]
            else:
                dimensions = [1.0, 1.0, 1.0]

        position = obj.get('position', [0.0, 0.0, 0.0])
        rotation = obj.get('rotationEuler', [0.0, 0.0, 0.0])
        scale = obj.get('scale', [1.0, 1.0, 1.0])

        # 1. Price evaluation
        if asset and asset.price_paise is not None:
            price_paise = asset.price_paise
            price_inr_str = f"{Decimal(price_paise) / Decimal(100):.2f}"
            status = 'priced'
            category = asset.category
            priced_count += 1
            total_paise += price_paise
        elif asset and asset.price_paise is None:
            price_paise = None
            price_inr_str = None
            status = 'unpriced'
            category = asset.category
            unpriced_count += 1
            has_unknown_prices = True
        else:
            price_paise = None
            price_inr_str = None
            status = 'unregistered'
            category = 'custom'
            unpriced_count += 1
            has_unknown_prices = True

        # Category subtotal aggregation
        if category not in category_stats:
            category_stats[category] = {
                'category': category,
                'item_count': 0,
                'subtotal_paise': 0,
                'has_unpriced': False,
            }
        category_stats[category]['item_count'] += 1
        if price_paise is not None:
            category_stats[category]['subtotal_paise'] += price_paise
        else:
            category_stats[category]['has_unpriced'] = True

        item_breakdown.append({
            'index': idx,
            'placement_id': placement_id,
            'asset_id': asset_id,
            'name': item_name,
            'category': category,
            'status': status,
            'price_paise': price_paise,
            'price_inr': price_inr_str,
            'currency': 'INR',
            'is_known_price': price_paise is not None,
            'dimensions': dimensions,
            'position': position,
            'scale': scale,
            'rotationEuler': rotation,
        })

        # 2. Containment and boundary violation check
        try:
            dims_f = [float(d) for d in dimensions[:3]]
            scale_f = [float(s) for s in scale[:3]]
            rot_f = [float(r) for r in rotation[:3]]
            pos_f = [float(p) for p in position[:3]]

            ex, ey, ez = compute_transformed_aabb_extents(dims_f, scale_f, rot_f)
            min_x = pos_f[0] - ex
            max_x = pos_f[0] + ex
            min_y = pos_f[1] - ey
            max_y = pos_f[1] + ey
            min_z = pos_f[2] - ez
            max_z = pos_f[2] + ez

            if min_x < -half_room_w - tolerance or max_x > half_room_w + tolerance:
                boundary_violations.append({
                    'placement_id': placement_id,
                    'name': item_name,
                    'axis': 'X',
                    'message': f"Exceeds room width boundaries (span [{min_x:.2f}m, {max_x:.2f}m] vs room limits [{-half_room_w:.2f}m, {half_room_w:.2f}m])"
                })
            if min_z < -half_room_l - tolerance or max_z > half_room_l + tolerance:
                boundary_violations.append({
                    'placement_id': placement_id,
                    'name': item_name,
                    'axis': 'Z',
                    'message': f"Exceeds room length boundaries (span [{min_z:.2f}m, {max_z:.2f}m] vs room limits [{-half_room_l:.2f}m, {half_room_l:.2f}m])"
                })
            if min_y < 0.0 - tolerance:
                boundary_violations.append({
                    'placement_id': placement_id,
                    'name': item_name,
                    'axis': 'Floor',
                    'message': f"Base at {min_y:.2f}m penetrates below the room floor plane (0.00m)"
                })
            if max_y > room_h + tolerance:
                boundary_violations.append({
                    'placement_id': placement_id,
                    'name': item_name,
                    'axis': 'Ceiling',
                    'message': f"Top at {max_y:.2f}m exceeds the ceiling height ({room_h:.2f}m)"
                })
        except Exception as e:
            # Fallback for unexpected coordinate format in unverified scenes
            boundary_violations.append({
                'placement_id': placement_id,
                'name': item_name,
                'axis': 'General',
                'message': f"Invalid transform coordinates: {str(e)}"
            })

    # Format category breakdown with Decimal INR strings
    category_breakdown = {}
    for cat_name, stats in category_stats.items():
        sub_paise = stats['subtotal_paise']
        category_breakdown[cat_name] = {
            'category': cat_name,
            'item_count': stats['item_count'],
            'subtotal_paise': sub_paise,
            'subtotal_inr': f"{Decimal(sub_paise) / Decimal(100):.2f}",
            'currency': 'INR',
            'has_unpriced': stats['has_unpriced'],
        }

    total_inr_str = f"{Decimal(total_paise) / Decimal(100):.2f}"

    return {
        'design_title': design_title,
        'currency': 'INR',
        'total_paise': total_paise,
        'total_inr': total_inr_str,
        'total_items': len(raw_objects),
        'priced_items_count': priced_count,
        'unpriced_items_count': unpriced_count,
        'has_unknown_prices': has_unknown_prices,
        'category_breakdown': category_breakdown,
        'items': item_breakdown,
        'room_constraints': {
            'is_valid': len(boundary_violations) == 0,
            'violations_count': len(boundary_violations),
            'violations': boundary_violations,
        }
    }
