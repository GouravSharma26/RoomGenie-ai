"""
Candidate Types and Schemas for RoomGenie AI (Phase 6.3).
Defines strongly-typed data structures for multi-candidate layout proposals,
scoring components, validation feedback, and deterministic scene hashing.
"""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# Canonical Score Component Weights
# S = 0.25*C_bound + 0.25*C_coll + 0.20*C_circ + 0.15*C_clear + 0.10*C_util + 0.05*C_budget
SCORE_WEIGHTS: Dict[str, float] = {
    'boundary': 0.25,
    'collision': 0.25,
    'circulation': 0.20,
    'clearance': 0.15,
    'utilization': 0.10,
    'budget': 0.05,
}

DEFAULT_CANDIDATE_COUNT = 3
MAX_CANDIDATE_COUNT = 5
MAX_REFINEMENT_ATTEMPTS = 2


def normalize_num(val: Any, decimals: int = 4) -> float:
    try:
        f = float(val)
        return round(f, decimals)
    except (ValueError, TypeError):
        return 0.0


def normalize_polygon_vertices(vertices: Any, decimals: int = 4) -> List[List[float]]:
    """
    Normalizes a polygon vertex ring by cyclically shifting to the lexicographically smallest
    starting vertex while strictly preserving cyclic edge sequence and orientation.
    Preserves exact topological identity without hiding geometric differences.
    """
    if not isinstance(vertices, list) or len(vertices) < 3:
        return []

    norm_pts: List[List[float]] = []
    for pt in vertices:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            norm_pts.append([normalize_num(pt[0], decimals), normalize_num(pt[1], decimals)])

    if len(norm_pts) < 3:
        return norm_pts

    # If the ring is explicitly closed with duplicate start/end, slice to open ring for rotation
    closed = (norm_pts[0] == norm_pts[-1])
    pts_to_rotate = norm_pts[:-1] if closed else norm_pts

    n = len(pts_to_rotate)
    if n < 3:
        return norm_pts

    # Find candidate cyclic rotations starting at minimum (x, z)
    min_pt = min(pts_to_rotate)
    candidate_indices = [i for i, pt in enumerate(pts_to_rotate) if pt == min_pt]

    best_candidate = pts_to_rotate[candidate_indices[0]:] + pts_to_rotate[:candidate_indices[0]]
    for idx in candidate_indices[1:]:
        cand = pts_to_rotate[idx:] + pts_to_rotate[:idx]
        if cand < best_candidate:
            best_candidate = cand

    return best_candidate


def compute_canonical_scene_hash(scene: Dict[str, Any] | None) -> str:
    """
    Computes a deterministic SHA-256 hash of a canonical 3D scene.
    Strips transient UI fields, normalizes floating-point coordinates to 4 decimal places,
    performs cyclic starting-point normalization on polygon footprints preserving topology,
    and sorts objects, walls, openings, and relationships deterministically by ID.
    """
    if not isinstance(scene, dict):
        return hashlib.sha256(b"empty_or_null_scene").hexdigest()

    # 1. Normalize Room Envelope
    raw_room = scene.get('room', {})
    room_dict: Dict[str, Any] = {}
    if isinstance(raw_room, dict):
        room_dict['width'] = normalize_num(raw_room.get('width', 5.0))
        room_dict['length'] = normalize_num(raw_room.get('length', 4.0))
        room_dict['height'] = normalize_num(raw_room.get('height', 2.8))

        # Footprint polygon vertices (supports both 'footprint' and 'polygonVertices')
        footprint_raw = raw_room.get('footprint')
        if footprint_raw is None:
            footprint_raw = raw_room.get('polygonVertices')

        if isinstance(footprint_raw, list):
            norm_footprint = normalize_polygon_vertices(footprint_raw)
            if norm_footprint:
                room_dict['footprint'] = norm_footprint

        # Walls (normalized and sorted by ID)
        walls = raw_room.get('walls', [])
        if isinstance(walls, list):
            norm_walls = []
            for w in walls:
                if isinstance(w, dict):
                    sp = w.get('startPoint', [0, 0])
                    ep = w.get('endPoint', [0, 0])
                    norm_walls.append({
                        'id': str(w.get('id', '')),
                        'startPoint': [normalize_num(sp[0]), normalize_num(sp[1])],
                        'endPoint': [normalize_num(ep[0]), normalize_num(ep[1])],
                        'thickness': normalize_num(w.get('thickness', 0.15)),
                    })
            norm_walls.sort(key=lambda x: x['id'])
            room_dict['walls'] = norm_walls

        # Openings (normalized and sorted by ID)
        openings = raw_room.get('openings', [])
        if isinstance(openings, list):
            norm_openings = []
            for op in openings:
                if isinstance(op, dict):
                    norm_openings.append({
                        'id': str(op.get('id', '')),
                        'wallId': str(op.get('wallId', '')),
                        'type': str(op.get('type', 'door')),
                        'center': [normalize_num(op.get('center', [0, 0])[0]), normalize_num(op.get('center', [0, 0])[1])],
                        'width': normalize_num(op.get('widthMeters', op.get('width', 0.9))),
                    })
            norm_openings.sort(key=lambda o: o['id'])
            room_dict['openings'] = norm_openings

    # 2. Normalize Placed Objects (sorted by ID)
    raw_objects = scene.get('objects', [])
    norm_objects = []
    if isinstance(raw_objects, list):
        for obj in raw_objects:
            if not isinstance(obj, dict):
                continue
            obj_id = str(obj.get('id', ''))
            asset_id = str(obj.get('assetId', ''))
            name = str(obj.get('name', ''))

            pos = obj.get('position', [0.0, 0.0, 0.0])
            rot = obj.get('rotationEuler', [0.0, 0.0, 0.0])
            scale = obj.get('scale', [1.0, 1.0, 1.0])
            dims = obj.get('dimensions', [1.0, 1.0, 1.0])

            norm_obj = {
                'id': obj_id,
                'assetId': asset_id,
                'name': name,
                'position': [normalize_num(p) for p in (pos if isinstance(pos, list) else [0, 0, 0])[:3]],
                'rotationEuler': [normalize_num(r) for r in (rot if isinstance(rot, list) else [0, 0, 0])[:3]],
                'scale': [normalize_num(s) for s in (scale if isinstance(scale, list) else [1, 1, 1])[:3]],
                'dimensions': [normalize_num(d) for d in (dims if isinstance(dims, list) else [1, 1, 1])[:3]],
            }
            mat_overrides = obj.get('materialOverrides')
            if isinstance(mat_overrides, dict) and 'color' in mat_overrides:
                norm_obj['color'] = str(mat_overrides['color'])
            norm_objects.append(norm_obj)

    norm_objects.sort(key=lambda o: o['id'])

    # 3. Normalize Relationships (sorted by ID)
    raw_rels = scene.get('relationships', [])
    norm_rels = []
    if isinstance(raw_rels, list):
        for rel in raw_rels:
            if not isinstance(rel, dict):
                continue
            norm_rels.append({
                'id': str(rel.get('id', '')),
                'anchorObjectId': str(rel.get('anchorObjectId', '')),
                'childObjectId': str(rel.get('childObjectId', '')),
                'socketId': str(rel.get('socketId', '')),
                'gap': normalize_num(rel.get('gap', 0.0)),
                'relativeYaw': normalize_num(rel.get('relativeYaw', 0.0)),
            })
        norm_rels.sort(key=lambda r: r['id'])

    # 4. Normalize Zones (sorted by ID)
    raw_zones = scene.get('zones', [])
    norm_zones = []
    if isinstance(raw_zones, list):
        for zone in raw_zones:
            if not isinstance(zone, dict):
                continue
            norm_zones.append({
                'id': str(zone.get('id', '')),
                'type': str(zone.get('type', 'living')),
                'members': sorted([str(m) for m in zone.get('memberObjectIds', [])]),
            })
        norm_zones.sort(key=lambda z: z['id'])

    canonical_repr = {
        'schemaVersion': scene.get('schemaVersion', 1),
        'unit': scene.get('unit', 'm'),
        'room': room_dict,
        'objects': norm_objects,
        'relationships': norm_rels,
        'zones': norm_zones,
    }

    serialized = json.dumps(canonical_repr, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()



@dataclass
class ScoreBreakdown:
    boundary: float = 100.0
    collision: float = 100.0
    circulation: float = 100.0
    clearance: float = 100.0
    utilization: float = 100.0
    budget: float = 100.0
    overall: float = 100.0
    weights: Dict[str, float] = field(default_factory=lambda: dict(SCORE_WEIGHTS))
    explanations: Dict[str, str] = field(default_factory=dict)
    budget_evaluated: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            'boundary': round(self.boundary, 1),
            'collision': round(self.collision, 1),
            'circulation': round(self.circulation, 1),
            'clearance': round(self.clearance, 1),
            'utilization': round(self.utilization, 1),
            'budget': round(self.budget, 1),
            'overall': round(self.overall, 1),
            'weights': self.weights,
            'explanations': self.explanations,
            'budget_evaluated': self.budget_evaluated,
        }


@dataclass
class StructuredValidationIssue:
    code: str
    message: str
    severity: str = 'fatal'  # 'fatal' | 'warning' | 'info'
    object_ids: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'code': self.code,
            'message': self.message,
            'severity': self.severity,
            'object_ids': self.object_ids,
        }


@dataclass
class CandidateValidationFeedback:
    is_valid: bool = True
    is_approval_eligible: bool = True
    has_collisions: bool = False
    has_boundary_breaches: bool = False
    is_budget_compliant: bool = True
    is_room_passable: bool = True
    fatal_errors: List[StructuredValidationIssue] = field(default_factory=list)
    advisory_warnings: List[StructuredValidationIssue] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'is_valid': self.is_valid,
            'is_approval_eligible': self.is_approval_eligible,
            'has_collisions': self.has_collisions,
            'has_boundary_breaches': self.has_boundary_breaches,
            'is_budget_compliant': self.is_budget_compliant,
            'is_room_passable': self.is_room_passable,
            'fatal_errors': [e.to_dict() for e in self.fatal_errors],
            'advisory_warnings': [w.to_dict() for w in self.advisory_warnings],
            'errors': [e.message for e in self.fatal_errors],
            'warnings': [w.message for w in self.advisory_warnings],
        }


@dataclass
class LayoutCandidate:
    id: str
    label: str
    description: str
    reasoning_summary: str
    proposed_actions: List[Dict[str, Any]]
    candidate_scene: Dict[str, Any]
    source_scene_hash: str
    is_valid: bool = True
    is_approval_eligible: bool = True
    score: ScoreBreakdown = field(default_factory=ScoreBreakdown)
    validation_feedback: CandidateValidationFeedback = field(default_factory=CandidateValidationFeedback)
    trade_offs: List[str] = field(default_factory=list)
    intended_relationships: List[Dict[str, Any]] = field(default_factory=list)
    refinement_attempts: int = 0
    schema_version: int = 1
    created_at_ms: int = 0
    budget_diff: Dict[str, Any] = field(default_factory=dict)
    schema_valid: bool = True
    reference_valid: bool = True
    domain_valid: bool = True
    budget_valid: bool = True
    schema_errors: List[str] = field(default_factory=list)
    reference_errors: List[str] = field(default_factory=list)
    domain_errors: List[str] = field(default_factory=list)
    budget_errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'schema_version': self.schema_version,
            'label': self.label,
            'description': self.description,
            'reasoning_summary': self.reasoning_summary,
            'proposed_actions': self.proposed_actions,
            'intended_relationships': self.intended_relationships,
            'is_valid': self.is_valid,
            'is_approval_eligible': self.is_approval_eligible,
            'score': self.score.to_dict(),
            'validation_feedback': self.validation_feedback.to_dict(),
            'trade_offs': self.trade_offs,
            'refinement_attempts': self.refinement_attempts,
            'source_scene_hash': self.source_scene_hash,
            'created_at_ms': self.created_at_ms,
            'candidate_scene': self.candidate_scene,
            'budget_diff': self.budget_diff,
            'schema_valid': self.schema_valid,
            'reference_valid': self.reference_valid,
            'domain_valid': self.domain_valid,
            'budget_valid': self.budget_valid,
            'schema_errors': self.schema_errors,
            'reference_errors': self.reference_errors,
            'domain_errors': self.domain_errors,
            'budget_errors': self.budget_errors,
        }

