"""
Spatial Context Engine for RoomGenie AI (Phase 6.1).
Parses, validates, and formats compact spatial representations of canonical scenes
for consumption by LLM spatial reasoning and tool calling.
"""

from typing import Any


def parse_spatial_context(raw_data: Any) -> dict[str, Any] | None:
    """
    Parses and sanitizes client-supplied spatial context.
    Returns a normalized dictionary adhering to SpatialContext schema v1, or None if invalid.
    """
    if not isinstance(raw_data, dict):
        return None

    schema_version = raw_data.get('schemaVersion', 1)
    room = raw_data.get('room', {})
    if not isinstance(room, dict):
        return None

    dims = room.get('dimensions', [5.0, 2.8, 4.0])
    area = room.get('areaSqm', 20.0)
    footprint = room.get('footprint', [])
    walls = room.get('walls', [])
    openings = room.get('openings', [])
    placed_objects = raw_data.get('placedObjects', [])
    relationships = raw_data.get('relationships', [])
    available_sockets = raw_data.get('availableSockets', [])
    walkability = raw_data.get('walkability')
    usable_space = raw_data.get('usableSpace', {})

    return {
        'schema_version': schema_version,
        'room': {
            'dimensions': dims,
            'area_sqm': area,
            'footprint': footprint,
            'is_parametric': bool(room.get('isParametric', len(footprint) >= 3)),
            'wall_count': len(walls),
            'walls': walls,
            'openings': openings,
        },
        'placed_objects': placed_objects,
        'relationships': relationships,
        'available_sockets': available_sockets,
        'walkability': walkability,
        'usable_space': usable_space,
    }


def format_spatial_context_for_prompt(context: dict[str, Any] | None, fallback_scene: dict[str, Any] | None = None) -> str:
    """
    Formats the structured spatial context into a concise, high-signal text prompt block
    for Gemini system instructions. Eliminates mesh bloat while preserving exact spatial geometry,
    wall orientations, door access points, socket availability, and circulation metrics.
    """
    if not context and fallback_scene:
        room = fallback_scene.get('room', {})
        width = room.get('width', 5.0)
        length = room.get('length', 4.0)
        height = room.get('height', 2.8)
        objects = fallback_scene.get('objects', [])
        return (
            f"Room Envelope: {width}m wide × {length}m long × {height}m high (rectangular).\n"
            f"Currently placed items ({len(objects)}): {[o.get('name', 'item') for o in objects]}\n"
        )

    if not context:
        return "Room Envelope: 5.0m wide × 4.0m long × 2.8m high (standard rectangular room).\n"

    room = context.get('room', {})
    dims = room.get('dimensions', [5.0, 2.8, 4.0])
    area = room.get('area_sqm', 20.0)
    footprint = room.get('footprint', [])
    walls = room.get('walls', [])
    openings = room.get('openings', [])
    placed = context.get('placed_objects', [])
    sockets = context.get('available_sockets', [])
    walkability = context.get('walkability')
    usable = context.get('usable_space', {})

    lines: list[str] = [
        f"--- Authoritative Spatial Context (v{context.get('schema_version', 1)}) ---",
        f"Room Dimensions: {dims[0]}m (X width) × {dims[1]}m (Y height) × {dims[2]}m (Z length). Floor Area: {area} m².",
    ]

    if footprint and len(footprint) >= 3:
        fp_str = ", ".join(f"[{p[0]:.2f}, {p[1]:.2f}]" for p in footprint[:8])
        lines.append(f"Polygon Footprint ({len(footprint)} vertices): {fp_str}")

    # Walls summary
    if walls:
        wall_summaries = []
        for w in walls[:8]:
            wall_summaries.append(f"{w.get('id', 'wall')} ({w.get('cardinalOrientation', 'slanted')}, {w.get('lengthMeters', 0):.1f}m)")
        lines.append(f"Walls ({len(walls)}): {'; '.join(wall_summaries)}")

    # Architectural openings summary
    if openings:
        op_summaries = []
        for op in openings:
            op_type = op.get('type', 'opening')
            center = op.get('center', [0, 0])
            width = op.get('widthMeters', 0.9)
            portal_flag = " [PEDESTRIAN ENTRANCE]" if op.get('isPedestrianPortal') else ""
            op_summaries.append(f"{op_type} '{op.get('id', '')}' at [{center[0]:.1f}, {center[1]:.1f}] width {width:.1f}m{portal_flag}")
        lines.append(f"Architectural Openings ({len(openings)}): {'; '.join(op_summaries)}")

    # Placed objects summary
    if placed:
        lines.append(f"Currently Placed Objects ({len(placed)}):")
        for obj in placed:
            pos = obj.get('position', [0, 0, 0])
            rot = obj.get('rotationEuler', [0, 0, 0])
            dims_obj = obj.get('dimensions', [1, 1, 1])
            anchor_flag = " (Anchor Object)" if obj.get('isAnchor') else ""
            lines.append(
                f"  • {obj.get('name', 'Item')} (id: '{obj.get('id')}', assetId: '{obj.get('assetId')}', cat: {obj.get('category')}{anchor_flag}): "
                f"pos=[{pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f}], size=[{dims_obj[0]:.2f}W × {dims_obj[2]:.2f}D], rotY={rot[1]:.2f}rad"
            )
    else:
        lines.append("Currently Placed Objects: None (Room is empty).")

    # Available sockets
    if sockets:
        lines.append(f"Available Sockets for Attachment ({len(sockets)}):")
        for s in sockets[:6]:
            wpos = s.get('worldPosition', [0, 0, 0])
            lines.append(
                f"  • Socket '{s.get('socketId')}' on '{s.get('anchorName')}' (type: {s.get('socketType')}, allowed: {s.get('allowedCategories')}) at pos=[{wpos[0]:.2f}, {wpos[2]:.2f}]"
            )

    # Walkability summary
    if walkability and isinstance(walkability, dict):
        score = walkability.get('walkabilityScore', 100)
        passable = "Yes" if walkability.get('isRoomPassable') else "NO (Blocked entrances or severe congestion)"
        entrances = walkability.get('unblockedEntranceCount', 1)
        blocked_doors = walkability.get('blockedDoorIds', [])
        lines.append(f"Walkability Analysis: Score {score}/100, Passable: {passable}, Active Entrances: {entrances}")
        if blocked_doors:
            lines.append(f"  WARNING: Blocked Doorway(s): {', '.join(blocked_doors)}. Keep door swing zones completely clear!")

    # Usable floor space
    free_ratio = usable.get('freeAreaRatio', 1.0)
    lines.append(f"Remaining Free Floor Space: {int(free_ratio * 100)}% available.")

    return "\n".join(lines) + "\n"
