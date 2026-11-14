"""
Candidate Simulator for RoomGenie AI (Phase 6.3).
Simulates proposed action sequences against an immutable canonical starting scene snapshot,
enforcing authoritative physical validation and producing structured validation feedback.
"""

import copy
import re
from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import (
    CandidateValidationFeedback,
    StructuredValidationIssue,
    compute_canonical_scene_hash,
)
from apps.ai_agent.tools import validate_and_simulate_actions
from apps.ai_agent.sockets import (
    check_obb_collisions_3d,
    check_doorway_landing_clearance,
    validate_room_footprint_containment,
)



def categorize_error(error_msg: str) -> StructuredValidationIssue:
    """
    Categorizes raw simulation error messages into structured validation issues with typed codes.
    """
    msg_lower = error_msg.lower()

    # Extract object IDs mentioned in quotes if present
    object_ids = re.findall(r"['\"]([a-zA-Z0-9_\-]+)['\"]", error_msg)

    if 'violates room boundary' in msg_lower or 'containment' in msg_lower or 'extend beyond room' in msg_lower:
        return StructuredValidationIssue(
            code='ROOM_BOUNDARY_BREACH',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'collides with' in msg_lower or 'obb' in msg_lower or 'collision' in msg_lower:
        return StructuredValidationIssue(
            code='OBB_COLLISION',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'door circulation' in msg_lower or 'doorway' in msg_lower or 'landing' in msg_lower:
        return StructuredValidationIssue(
            code='DOOR_BLOCKED',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'already occupied' in msg_lower:
        return StructuredValidationIssue(
            code='SOCKET_OCCUPIED',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'cycle detected' in msg_lower or 'cannot attach to itself' in msg_lower:
        return StructuredValidationIssue(
            code='CYCLE_DETECTED',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'not compatible' in msg_lower:
        return StructuredValidationIssue(
            code='SOCKET_INCOMPATIBLE',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'socket' in msg_lower and ('not found' in msg_lower or 'not registered' in msg_lower):
        return StructuredValidationIssue(
            code='SOCKET_NOT_FOUND',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'gap' in msg_lower and ('permitted range' in msg_lower or 'invalid' in msg_lower):
        return StructuredValidationIssue(
            code='INVALID_GAP',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'preserv' in msg_lower:
        return StructuredValidationIssue(
            code='ZONE_PRESERVATION_BREACH',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'budget' in msg_lower and ('exceed' in msg_lower or 'limit' in msg_lower):
        return StructuredValidationIssue(
            code='BUDGET_EXCEEDED',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'ground' in msg_lower or 'below floor' in msg_lower:
        return StructuredValidationIssue(
            code='GROUNDING_ERROR',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )
    if 'clearance' in msg_lower:
        return StructuredValidationIssue(
            code='CLEARANCE_VIOLATION',
            message=error_msg,
            severity='fatal',
            object_ids=object_ids,
        )

    return StructuredValidationIssue(
        code='DOMAIN_ERROR',
        message=error_msg,
        severity='fatal',
        object_ids=object_ids,
    )


def categorize_warning(warning_msg: str) -> StructuredValidationIssue:
    """
    Categorizes advisory warnings into structured advisory issues.
    """
    object_ids = re.findall(r"['\"]([a-zA-Z0-9_\-]+)['\"]", warning_msg)
    msg_lower = warning_msg.lower()

    if 'clearance' in msg_lower or 'spacing' in msg_lower:
        code = 'CLEARANCE_VIOLATION'
    elif 'passage' in msg_lower or 'narrow' in msg_lower:
        code = 'NARROW_PASSAGE'
    elif 'unreachable' in msg_lower:
        code = 'UNREACHABLE_FURNITURE'
    else:
        code = 'ADVISORY_WARNING'

    return StructuredValidationIssue(
        code=code,
        message=warning_msg,
        severity='warning',
        object_ids=object_ids,
    )


class CandidateSimulator:
    """
    Simulates candidate actions against an isolated copy of the canonical scene.
    Ensures that under no circumstances can the base scene be modified during simulation.
    """

    def __init__(self, base_scene: Dict[str, Any], max_budget_paise: Optional[int] = None):
        # Deepcopy to guarantee total isolation
        self.base_scene = copy.deepcopy(base_scene)
        self.source_scene_hash = compute_canonical_scene_hash(self.base_scene)
        self.max_budget_paise = max_budget_paise

    def simulate(
        self,
        proposed_actions: List[Dict[str, Any]],
        user_requirements: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Executes proposed actions in an isolated candidate environment.
        Returns:
            {
                'candidate_scene': Dict[str, Any],
                'is_valid': bool,
                'is_approval_eligible': bool,
                'validation_feedback': CandidateValidationFeedback,
                'budget_diff': Dict[str, Any],
                'raw_errors': List[str],
                'raw_warnings': List[str],
            }
        """
        # Determine budget limit: explicit max_budget_paise or user_requirements
        effective_budget = self.max_budget_paise
        if effective_budget is None and user_requirements and 'budget_paise' in user_requirements:
            effective_budget = user_requirements['budget_paise']

        # Run authoritative simulation
        sim_result = validate_and_simulate_actions(
            current_scene=self.base_scene,
            proposed_actions=proposed_actions,
            max_budget_paise=effective_budget,
        )

        fatal_issues: List[StructuredValidationIssue] = []
        advisory_issues: List[StructuredValidationIssue] = []

        # Process hard errors
        raw_errors = sim_result.get('errors', [])
        for err in raw_errors:
            fatal_issues.append(categorize_error(err))

        # Process domain / schema / reference / budget errors
        for err in sim_result.get('schema_errors', []):
            if err not in raw_errors:
                fatal_issues.append(categorize_error(err))
        for err in sim_result.get('reference_errors', []):
            if err not in raw_errors:
                fatal_issues.append(categorize_error(err))
        for err in sim_result.get('domain_errors', []):
            if err not in raw_errors:
                fatal_issues.append(categorize_error(err))
        for err in sim_result.get('budget_errors', []):
            if err not in raw_errors:
                fatal_issues.append(categorize_error(err))

        # Process advisory warnings
        raw_warnings = sim_result.get('warnings', [])
        for warn in raw_warnings:
            advisory_issues.append(categorize_warning(warn))

        # Check user-defined required categories
        if user_requirements and 'required_categories' in user_requirements:
            required_cats = set(c.lower() for c in user_requirements['required_categories'])
            placed_objects = sim_result['candidate_scene'].get('objects', [])
            from apps.furniture.models import FurnitureAsset
            placed_asset_ids = {o.get('assetId') for o in placed_objects if o.get('assetId')}
            present_cats = set(
                FurnitureAsset.objects.filter(id__in=placed_asset_ids)  # pyrefly: ignore[missing-attribute]
                .values_list('category', flat=True)
            )
            present_cats_lower = {c.lower() for c in present_cats if c}
            missing = required_cats - present_cats_lower
            if missing:
                missing_str = ", ".join(sorted(missing))
                fatal_issues.append(StructuredValidationIssue(
                    code='MISSING_REQUIRED_CATEGORY',
                    message=f"Candidate is missing required furniture categories: {missing_str}.",
                    severity='fatal',
                ))

        # Comprehensive full-scene physical constraint validation
        candidate_scene = sim_result['candidate_scene']
        cand_objects = candidate_scene.get('objects', [])
        cand_room = candidate_scene.get('room', {})
        cand_relationships = candidate_scene.get('relationships', [])

        # Build set of attached pairs (anchor, child) to exempt from inter-item OBB collisions
        attached_pairs = set()
        for rel in cand_relationships:
            a_id = rel.get('anchorObjectId')
            c_id = rel.get('childObjectId')
            if a_id and c_id:
                attached_pairs.add((a_id, c_id))
                attached_pairs.add((c_id, a_id))

        # 1. Full-scene OBB collision validation between unrelated objects
        for i in range(len(cand_objects)):
            for j in range(i + 1, len(cand_objects)):
                obj_a = cand_objects[i]
                obj_b = cand_objects[j]
                pair = (obj_a.get('id'), obj_b.get('id'))
                if pair in attached_pairs:
                    continue
                if check_obb_collisions_3d(obj_a, obj_b):
                    fatal_issues.append(StructuredValidationIssue(
                        code='OBB_COLLISION',
                        message=f"Item '{obj_a.get('name')}' physically collides with '{obj_b.get('name')}'.",
                        severity='fatal',
                        object_ids=[str(obj_a.get('id')), str(obj_b.get('id'))],
                    ))

        # 2. Doorway landing clearance for all placed items
        for obj in cand_objects:
            door_violations = check_doorway_landing_clearance(obj, cand_room)
            if door_violations:
                fatal_issues.append(StructuredValidationIssue(
                    code='DOOR_BLOCKED',
                    message=f"Item '{obj.get('name')}' blocks door circulation: " + "; ".join(door_violations),
                    severity='fatal',
                    object_ids=[str(obj.get('id'))],
                ))

        # 3. Room footprint / boundary containment for all placed items
        for obj in cand_objects:
            cont_violations = validate_room_footprint_containment(obj, cand_room)
            if cont_violations:
                fatal_issues.append(StructuredValidationIssue(
                    code='ROOM_BOUNDARY_BREACH',
                    message=f"Item '{obj.get('name')}' violates room boundary: " + "; ".join(cont_violations),
                    severity='fatal',
                    object_ids=[str(obj.get('id'))],
                ))

        # Deduplicate issues by (code, message)
        unique_fatal: List[StructuredValidationIssue] = []

        seen_fatal = set()
        for f in fatal_issues:
            key = (f.code, f.message)
            if key not in seen_fatal:
                seen_fatal.add(key)
                unique_fatal.append(f)

        unique_advisory: List[StructuredValidationIssue] = []
        seen_adv = set()
        for a in advisory_issues:
            key = (a.code, a.message)
            if key not in seen_adv:
                seen_adv.add(key)
                unique_advisory.append(a)

        has_collisions = any(i.code == 'OBB_COLLISION' for i in unique_fatal)
        has_boundary = any(i.code == 'ROOM_BOUNDARY_BREACH' for i in unique_fatal)
        is_budget_compliant = not any(i.code == 'BUDGET_EXCEEDED' for i in unique_fatal)
        is_room_passable = not any(i.code == 'DOOR_BLOCKED' for i in unique_fatal)

        is_valid = len(unique_fatal) == 0
        is_approval_eligible = is_valid

        feedback = CandidateValidationFeedback(
            is_valid=is_valid,
            is_approval_eligible=is_approval_eligible,
            has_collisions=has_collisions,
            has_boundary_breaches=has_boundary,
            is_budget_compliant=is_budget_compliant,
            is_room_passable=is_room_passable,
            fatal_errors=unique_fatal,
            advisory_warnings=unique_advisory,
        )

        return {
            'candidate_scene': sim_result['candidate_scene'],
            'is_valid': is_valid,
            'is_approval_eligible': is_approval_eligible,
            'validation_feedback': feedback,
            'budget_diff': sim_result.get('budget_diff', {}),
            'schema_valid': sim_result.get('schema_valid', True),
            'reference_valid': sim_result.get('reference_valid', True),
            'domain_valid': sim_result.get('domain_valid', True) and is_valid,
            'budget_valid': sim_result.get('budget_valid', True) and is_budget_compliant,
            'schema_errors': sim_result.get('schema_errors', []),
            'reference_errors': sim_result.get('reference_errors', []),
            'domain_errors': sim_result.get('domain_errors', []),
            'budget_errors': sim_result.get('budget_errors', []),
            'raw_errors': [i.message for i in unique_fatal],
            'raw_warnings': [i.message for i in unique_advisory],
        }

