"""
Natural-Language Refinement Interpreter for RoomGenie AI (Phase 7.3).
Translates unstructured user refinement instructions into typed, bounded
refinement requests with protected items, target objects, and ambiguity detection.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple
from apps.ai_agent.feedback.feedback_types import TypedRefinementRequest


class RefinementInterpreter:
    """
    Parses conversational user instructions into typed refinement requests,
    identifying target items, protected items, spatial directions, and ambiguous commands.
    """

    @classmethod
    def interpret_refinement(
        cls,
        user_prompt: str,
        current_scene: Dict[str, Any],
        selected_candidate_id: Optional[str] = None,
    ) -> TypedRefinementRequest:
        """
        Converts natural language refinement instructions into a validated TypedRefinementRequest.
        """
        prompt_lower = user_prompt.lower().strip()
        objects = current_scene.get('objects', [])

        # 1. Ambiguity check on empty or non-spatial input
        if not prompt_lower or len(prompt_lower) < 4:
            return TypedRefinementRequest(
                raw_prompt=user_prompt,
                intent_category='unknown',
                is_ambiguous=True,
                ambiguity_reason="Instruction is too short or empty. Please specify which furniture to adjust or what spatial property to improve.",
                confidence_score=0.1,
            )

        # Check for gibberish / nonsensical input
        non_spatial_tokens = {'asdf', 'qwerty', 'test', 'blah', 'foo', 'bar'}
        if prompt_lower in non_spatial_tokens:
            return TypedRefinementRequest(
                raw_prompt=user_prompt,
                intent_category='unknown',
                is_ambiguous=True,
                ambiguity_reason="Could not determine spatial intent. Please specify furniture items to reposition or spatial goals (e.g. 'move the coffee table forward' or 'improve circulation').",
                confidence_score=0.1,
            )

        # 2. Extract referenced objects in the room
        referenced_in_prompt = cls._find_matching_objects(prompt_lower, objects)

        # Check for references to nonexistent furniture
        nonexistent_keywords = ['piano', 'dining table', 'chandelier', 'aquarium', 'pool table', 'treadmill']
        for kw in nonexistent_keywords:
            if kw in prompt_lower and not any(kw in str(o.get('name', '')).lower() or kw in str(o.get('assetId', '')).lower() for o in objects):
                return TypedRefinementRequest(
                    raw_prompt=user_prompt,
                    intent_category='unsupported_furniture',
                    is_ambiguous=True,
                    ambiguity_reason=f"The requested item '{kw}' is not present in the current room layout.",
                    confidence_score=0.3,
                )

        # 3. Detect Protected Objects ("keep the sofa", "preserve the bed", "don't move the desk")
        protected_ids: Set[str] = set()
        keep_patterns = [
            r'(?:keep|preserve|don\'?t move|leave)\s+(?:the\s+)?([a-z\s\-]+?)(?:\s+(?:where|as)\s+it\s+is|\s+(?:attached|in place)|\s*[,;]|\s+but|\s*$)',
            r'without\s+moving\s+(?:the\s+)?([a-z\s\-]+)',
        ]
        for pat in keep_patterns:
            matches = re.findall(pat, prompt_lower)
            for m in matches:
                m_clean = m.strip()
                # Split conjunctions ("the sofa and coffee table" -> "sofa", "coffee table")
                parts = re.split(r'\s+and\s+|\s*,\s*|\s+with\s+', m_clean)
                for part in parts:
                    part_clean = part.strip()
                    if part_clean:
                        matched = cls._find_matching_objects(part_clean, objects)
                        protected_ids.update(matched)
                matched_full = cls._find_matching_objects(m_clean, objects)
                protected_ids.update(matched_full)

        # If user explicitly states "keep all current furniture" / "keep everything"
        if any(w in prompt_lower for w in ['keep all', 'keep everything', 'preserve all', 'rearrange the remaining']):
            # Protect all unless explicitly targeted for moving
            all_ids = {str(o.get('id')) for o in objects if 'id' in o}
            protected_ids.update(all_ids)

        # 4. Detect Target Objects ("move the coffee table", "shift the chair", "reposition desk")
        target_ids: Set[str] = set()
        move_patterns = [
            r'(?:move|shift|push|pull|reposition|nudge|adjust)\s+(?:the\s+)?([a-z\s\-]+?)(?:\s+slightly|\s+closer|\s+forward|\s+backward|\s+left|\s+right|\s+further|\s+(?:to\s+the\s+)?(?:left|right|front|back)|\s*[,;]|\s*$)',
        ]
        for pat in move_patterns:
            matches = re.findall(pat, prompt_lower)
            for m in matches:
                m_clean = m.strip()
                parts = re.split(r'\s+and\s+|\s*,\s*|\s+with\s+', m_clean)
                for part in parts:
                    part_clean = part.strip()
                    if part_clean:
                        matched = cls._find_matching_objects(part_clean, objects)
                        target_ids.update(matched)
                matched_full = cls._find_matching_objects(m_clean, objects)
                target_ids.update(matched_full)

        # If an item was explicitly targeted for moving, remove it from protected
        for tid in target_ids:
            if tid in protected_ids:
                protected_ids.remove(tid)

        # 5. Detect Directional Intent
        preferred_direction = None
        displacement = 0.30

        if any(w in prompt_lower for w in ['slightly forward', 'move forward', 'forward', 'pull forward', 'closer to front']):
            preferred_direction = 'forward'
            displacement = 0.25
        elif any(w in prompt_lower for w in ['backward', 'back', 'push back', 'further back']):
            preferred_direction = 'backward'
            displacement = 0.25
        elif any(w in prompt_lower for w in ['to the left', 'move left', 'leftwards', 'left']):
            preferred_direction = 'left'
            displacement = 0.30
        elif any(w in prompt_lower for w in ['to the right', 'move right', 'rightwards', 'right']):
            preferred_direction = 'right'
            displacement = 0.30
        elif any(w in prompt_lower for w in ['closer to wall', 'toward wall', 'against wall', 'perimeter']):
            preferred_direction = 'toward_wall'
            displacement = 0.35
        elif any(w in prompt_lower for w in ['away from door', 'clear entrance', 'away from entrance']):
            preferred_direction = 'away_from_door'
            displacement = 0.40
        elif any(w in prompt_lower for w in ['closer to window', 'natural light']):
            preferred_direction = 'toward_window'
            displacement = 0.35

        # 6. Detect Intent Category
        intent_category = 'general_refinement'
        desired_improvement = None

        if any(w in prompt_lower for w in ['more open', 'open space', 'open floor', 'feel more open', 'spacious']):
            intent_category = 'increase_open_space'
            desired_improvement = 'open_floor_area'
        elif any(w in prompt_lower for w in ['circulation', 'walking path', 'walking route', 'transit', 'walkway']):
            intent_category = 'improve_circulation'
            desired_improvement = 'circulation'
        elif any(w in prompt_lower for w in ['symmetrical', 'symmetry', 'balanced']):
            intent_category = 'symmetrical'
            desired_improvement = 'symmetrical_arrangement'
        elif any(w in prompt_lower for w in ['desk', 'workspace', 'study area']) and ('work' in prompt_lower or 'study' in prompt_lower):
            intent_category = 'reposition_workspace'
            desired_improvement = 'workspace_flow'
        elif target_ids:
            intent_category = 'move_object'
        elif any(w in prompt_lower for w in ['rearrange', 'improve arrangement', 'better arrangement']):
            intent_category = 'rearrange_preserving'

        # If no specific targets or intent could be extracted
        if not target_ids and intent_category == 'general_refinement' and not protected_ids:
            return TypedRefinementRequest(
                raw_prompt=user_prompt,
                intent_category='unknown',
                is_ambiguous=True,
                ambiguity_reason="Could not determine specific items or spatial properties to refine. Try instructions like 'Keep the sofa but move the coffee table forward' or 'Make the room feel more open'.",
                confidence_score=0.4,
            )

        return TypedRefinementRequest(
            raw_prompt=user_prompt,
            intent_category=intent_category,
            target_object_ids=sorted(list(target_ids)),
            protected_object_ids=sorted(list(protected_ids)),
            preferred_direction=preferred_direction,
            displacement_meters=displacement,
            desired_improvement=desired_improvement,
            allow_new_furniture=False,
            allow_remove_furniture=False,
            is_ambiguous=False,
            confidence_score=0.95,
        )

    @classmethod
    def _find_matching_objects(cls, query: str, objects: List[Dict[str, Any]]) -> Set[str]:
        """Matches query text against furniture object names, categories, and asset IDs."""
        matched_ids: Set[str] = set()
        q = query.lower().strip()

        # Category word patterns
        category_patterns = {
            'sofa': [r'\bsofa\b', r'\bcouch\b', r'\bsettee\b', r'\b3-seater\b', r'\b2-seater\b'],
            'coffee table': [r'\bcoffee\s*table\b', r'\bcenter\s*table\b', r'\bcoffee\b'],
            'table': [r'\btable\b'],
            'chair': [r'\bchair\b', r'\barmchair\b', r'\baccent chair\b', r'\blounge chair\b'],
            'bed': [r'\bbed\b', r'\bqueen bed\b', r'\bking bed\b', r'\bplatform bed\b'],
            'nightstand': [r'\bnightstand\b', r'\bbedside\b', r'\bside table\b'],
            'desk': [r'\bdesk\b', r'\bstudy desk\b', r'\bworkstation\b', r'\bworkspace\b'],
            'storage': [r'\bbookshelf\b', r'\bbookcase\b', r'\bstorage\b', r'\bwardrobe\b', r'\bcloset\b', r'\bcabinet\b'],
        }

        query_categories = set()
        for cat, pats in category_patterns.items():
            if any(re.search(pat, q) for pat in pats):
                query_categories.add(cat)

        for obj in objects:
            oid = str(obj.get('id', ''))
            name = str(obj.get('name', '')).lower()
            asset_id = str(obj.get('assetId', '')).lower()

            # Exact ID or full name match
            if oid.lower() == q or name == q or (name and name in q):
                matched_ids.add(oid)
                continue

            # Match via detected category
            for cat in query_categories:
                pats = category_patterns[cat]
                if any(re.search(pat, name) or re.search(pat, asset_id) or re.search(pat, oid.lower()) for pat in pats):
                    # Disambiguation: generic 'table' query shouldn't match 'coffee table' if user didn't mention coffee
                    if cat == 'table' and 'coffee' in name and 'coffee' not in query_categories:
                        continue
                    # 'chair' category shouldn't match 'sofa'
                    if cat == 'chair' and ('sofa' in name or 'couch' in name):
                        continue
                    matched_ids.add(oid)

        return matched_ids
