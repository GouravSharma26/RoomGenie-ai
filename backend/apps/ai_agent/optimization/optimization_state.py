"""
Optimization State Management for RoomGenie AI (Phase 7.2).
Provides an isolated, cloneable representation of a candidate 3D scene,
allowing fast spatial queries, transforms, functional clustering,
and socket hierarchy navigation without mutating canonical scene data.
"""

import copy
import math
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple
from apps.ai_agent.sockets import (
    CANONICAL_SOCKET_DEFINITIONS,
    get_furniture_corners_2d,
    is_point_in_polygon_2d,
)


class CandidateSceneState:
    """
    Mutable isolated scene state for optimization search.
    Provides fast geometric lookups and transformations.
    """

    def __init__(self, scene_dict: Dict[str, Any], actions: Optional[List[Dict[str, Any]]] = None):
        self.scene = copy.deepcopy(scene_dict)
        self.actions = copy.deepcopy(actions) if actions is not None else []
        self._ensure_structures()

    def _ensure_structures(self) -> None:
        if 'room' not in self.scene or not isinstance(self.scene['room'], dict):
            self.scene['room'] = {'width': 5.0, 'length': 4.0, 'height': 2.8}
        if 'objects' not in self.scene or not isinstance(self.scene['objects'], list):
            self.scene['objects'] = []
        if 'relationships' not in self.scene or not isinstance(self.scene['relationships'], list):
            self.scene['relationships'] = []

        # Auto-ground objects to prevent fractional floating-point grounding breaches
        for obj in self.scene.get('objects', []):
            dims = obj.get('dimensions', [1.0, 1.0, 1.0])
            scale = obj.get('scale', [1.0, 1.0, 1.0])
            correct_ground_y = round((dims[1] * scale[1]) / 2.0, 4)
            pos = obj.get('position', [0.0, 0.0, 0.0])
            if abs(pos[1] - correct_ground_y) > 0.005:
                obj['position'] = [round(pos[0], 4), correct_ground_y, round(pos[2], 4)]

    def clone(self) -> 'CandidateSceneState':
        return CandidateSceneState(self.scene, self.actions)

    @property
    def room(self) -> Dict[str, Any]:
        return self.scene['room']

    @property
    def room_width(self) -> float:
        return float(self.room.get('width', 5.0))

    @property
    def room_length(self) -> float:
        return float(self.room.get('length', 4.0))

    @property
    def room_height(self) -> float:
        return float(self.room.get('height', 2.8))

    @property
    def room_polygon(self) -> Optional[List[List[float]]]:
        fp = self.room.get('footprint')
        if fp is None:
            fp = self.room.get('polygonVertices')
        if isinstance(fp, list) and len(fp) >= 3:
            return [[float(p[0]), float(p[1])] for p in fp]
        # Generate default rectangular polygon from width and length
        half_w = self.room_width / 2.0
        half_l = self.room_length / 2.0
        return [
            [-half_w, -half_l],
            [half_w, -half_l],
            [half_w, half_l],
            [-half_w, half_l],
        ]

    @property
    def walls(self) -> List[Dict[str, Any]]:
        return self.room.get('walls', [])

    @property
    def openings(self) -> List[Dict[str, Any]]:
        return self.room.get('openings', [])

    @property
    def objects(self) -> List[Dict[str, Any]]:
        return self.scene['objects']

    @property
    def relationships(self) -> List[Dict[str, Any]]:
        return self.scene['relationships']

    def get_object(self, object_id: str) -> Optional[Dict[str, Any]]:
        for obj in self.objects:
            if obj.get('id') == object_id:
                return obj
        return None

    def get_object_position(self, object_id: str) -> Optional[List[float]]:
        obj = self.get_object(object_id)
        if obj and 'position' in obj:
            return list(obj['position'])
        return None

    def set_object_position(self, object_id: str, new_pos: List[float]) -> None:
        obj = self.get_object(object_id)
        if obj:
            obj['position'] = [round(new_pos[0], 4), round(new_pos[1], 4), round(new_pos[2], 4)]
            # Update corresponding action if exists
            for act in self.actions:
                if act.get('object_id') == object_id or act.get('objectId') == object_id:
                    act['position'] = list(obj['position'])

    def get_object_yaw(self, object_id: str) -> float:
        obj = self.get_object(object_id)
        if obj and 'rotationEuler' in obj:
            rot = obj['rotationEuler']
            return float(rot[1]) if len(rot) > 1 else 0.0
        return 0.0

    def set_object_yaw(self, object_id: str, yaw: float) -> None:
        obj = self.get_object(object_id)
        if obj:
            if 'rotationEuler' not in obj:
                obj['rotationEuler'] = [0.0, 0.0, 0.0]
            obj['rotationEuler'][1] = round(yaw, 4)
            for act in self.actions:
                if act.get('object_id') == object_id or act.get('objectId') == object_id:
                    if 'rotation_euler' in act:
                        act['rotation_euler'][1] = round(yaw, 4)
                    elif 'rotationEuler' in act:
                        act['rotationEuler'][1] = round(yaw, 4)

    def get_object_corners_2d(self, object_id: str) -> List[Tuple[float, float]]:
        obj = self.get_object(object_id)
        if not obj:
            return []
        pos = obj.get('position', [0.0, 0.0, 0.0])
        dims = obj.get('dimensions', [1.0, 1.0, 1.0])
        scale = obj.get('scale', [1.0, 1.0, 1.0])
        rot = obj.get('rotationEuler', [0.0, 0.0, 0.0])
        yaw = rot[1] if len(rot) > 1 else 0.0
        return get_furniture_corners_2d(pos, dims, scale, yaw)

    def get_functional_groups(self) -> List[Set[str]]:
        """
        Identifies functional clusters of connected furniture (e.g. Sofa + Table + Chairs).
        Builds connected components using socket attachments and relationship links.
        """
        adj: Dict[str, Set[str]] = {obj['id']: set() for obj in self.objects if 'id' in obj}
        for rel in self.relationships:
            a_id = rel.get('anchorObjectId')
            c_id = rel.get('childObjectId')
            if a_id in adj and c_id in adj:
                adj[a_id].add(c_id)
                adj[c_id].add(a_id)

        visited: Set[str] = set()
        groups: List[Set[str]] = []

        for obj_id in adj:
            if obj_id not in visited:
                group: Set[str] = set()
                queue = [obj_id]
                visited.add(obj_id)
                while queue:
                    curr = queue.pop(0)
                    group.add(curr)
                    for nbr in adj.get(curr, []):
                        if nbr not in visited:
                            visited.add(nbr)
                            queue.append(nbr)
                groups.append(group)

        return groups

    def get_group_anchor(self, group: Set[str]) -> str:
        """
        Returns the primary anchor object ID for a group (e.g. bed or sofa).
        """
        for rel in self.relationships:
            a_id = rel.get('anchorObjectId')
            if a_id in group:
                return a_id
        # Fallback to largest item or first item
        best_id = list(group)[0]
        max_vol = 0.0
        for oid in group:
            obj = self.get_object(oid)
            if obj:
                d = obj.get('dimensions', [1, 1, 1])
                vol = d[0] * d[1] * d[2]
                if vol > max_vol:
                    max_vol = vol
                    best_id = oid
        return best_id

    def translate_object(self, object_id: str, dx: float, dz: float) -> None:
        pos = self.get_object_position(object_id)
        if pos:
            self.set_object_position(object_id, [pos[0] + dx, pos[1], pos[2] + dz])

    def translate_group(self, group: Set[str], dx: float, dz: float) -> None:
        for oid in group:
            self.translate_object(oid, dx, dz)

    def rotate_group(self, group: Set[str], angle_rad: float, center: Optional[Tuple[float, float]] = None) -> None:
        """
        Rotates an entire group around a common 2D center (cx, cz).
        """
        if center is None:
            # Compute collective centroid
            cx, cz = 0.0, 0.0
            count = 0
            for oid in group:
                pos = self.get_object_position(oid)
                if pos:
                    cx += pos[0]
                    cz += pos[2]
                    count += 1
            if count > 0:
                center = (cx / count, cz / count)
            else:
                center = (0.0, 0.0)

        cx, cz = center
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        for oid in group:
            pos = self.get_object_position(oid)
            yaw = self.get_object_yaw(oid)
            if pos:
                rx = pos[0] - cx
                rz = pos[2] - cz
                nx = cx + (rx * cos_a - rz * sin_a)
                nz = cz + (rx * sin_a + rz * cos_a)
                self.set_object_position(oid, [nx, pos[1], nz])
                self.set_object_yaw(oid, yaw + angle_rad)

    def to_scene_dict(self) -> Dict[str, Any]:
        return copy.deepcopy(self.scene)
