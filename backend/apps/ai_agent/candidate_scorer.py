"""
Candidate Scorer for RoomGenie AI (Phase 6.3).
Computes the authoritative 6-component score:
S = 0.25*C_bound + 0.25*C_coll + 0.20*C_circ + 0.15*C_clear + 0.10*C_util + 0.05*C_budget
All component scores are normalized to 0–100.
Enforces the hard-failure rule: hard constraints cannot be overridden by soft scores.
"""

from typing import Any, Dict, List, Optional
from apps.ai_agent.candidate_types import (
    CandidateValidationFeedback,
    ScoreBreakdown,
    SCORE_WEIGHTS,
)


class CandidateScorer:
    """
    Evaluates simulated candidate layouts across six deterministic dimensions.
    Produces granular sub-scores, detailed explanations, and an aggregated quality index.
    """

    @staticmethod
    def calculate_score(
        candidate_scene: Dict[str, Any],
        validation_feedback: CandidateValidationFeedback,
        budget_diff: Dict[str, Any],
        user_requirements: Optional[Dict[str, Any]] = None,
        spatial_context: Optional[Dict[str, Any]] = None,
        preferences: Optional[Any] = None,
    ) -> ScoreBreakdown:
        explanations: Dict[str, str] = {}

        # -------------------------------------------------------------
        # 1. Boundary Component (Weight: 25%)
        # -------------------------------------------------------------
        if validation_feedback.has_boundary_breaches:
            c_bound = 0.0
            explanations['boundary'] = "Hard failure: 1 or more furniture items extend beyond room boundary."
        else:
            # Check proximity to walls for placed objects
            objects = candidate_scene.get('objects', [])
            room = candidate_scene.get('room', {})
            room_w = float(room.get('width', 5.0))
            room_l = float(room.get('length', 4.0))

            tight_wall_count = 0
            for obj in objects:
                pos = obj.get('position', [0, 0, 0])
                dims = obj.get('dimensions', [1, 1, 1])
                # Check distance to walls (assuming rectangular center-origin or bounding box)
                dist_x = (room_w / 2.0) - (abs(pos[0]) + dims[0] / 2.0)
                dist_z = (room_l / 2.0) - (abs(pos[2]) + dims[2] / 2.0)
                if dist_x < 0.05 or dist_z < 0.05:
                    tight_wall_count += 1

            if tight_wall_count > 0:
                c_bound = max(70.0, 100.0 - (tight_wall_count * 10.0))
                explanations['boundary'] = f"Valid containment: all items within footprint ({tight_wall_count} item(s) close to walls)."
            else:
                c_bound = 100.0
                explanations['boundary'] = "Optimal containment: all furniture items comfortably inside room boundaries."

        # -------------------------------------------------------------
        # 2. Collision Component (Weight: 25%)
        # -------------------------------------------------------------
        if validation_feedback.has_collisions:
            c_coll = 0.0
            explanations['collision'] = "Hard failure: 3D bounding boxes overlap or collide between unrelated furniture."
        else:
            c_coll = 100.0
            explanations['collision'] = "Zero collisions: all furniture pieces have clean, non-overlapping physical bounding boxes."

        # -------------------------------------------------------------
        # 3. Circulation Component (Weight: 20%)
        # -------------------------------------------------------------
        if not validation_feedback.is_room_passable:
            c_circ = 0.0
            explanations['circulation'] = "Hard failure: doorway landing zone or primary entrance is obstructed."
        else:
            # Check walkability summary from spatial context or candidate scene
            walkability = None
            if spatial_context and isinstance(spatial_context, dict):
                walkability = spatial_context.get('walkability')

            if walkability and isinstance(walkability, dict):
                base_walk_score = float(walkability.get('walkabilityScore', 90.0))
                c_circ = min(100.0, max(40.0, base_walk_score))
                explanations['circulation'] = f"Circulation analysis: room walkability score is {c_circ:.0f}/100 with clear paths."
            else:
                # Estimate circulation from door clearance and object count
                objects = candidate_scene.get('objects', [])
                if len(objects) > 8:
                    c_circ = 80.0
                    explanations['circulation'] = "Passable circulation: primary door landings open; moderate furniture density."
                else:
                    c_circ = 95.0
                    explanations['circulation'] = "Excellent circulation: clear walking routes and unimpeded door access."

        # -------------------------------------------------------------
        # 4. Clearance Component (Weight: 15%)
        # -------------------------------------------------------------
        advisory_count = len(validation_feedback.advisory_warnings)
        clearance_fatal = any(i.code == 'CLEARANCE_VIOLATION' for i in validation_feedback.fatal_errors)

        if clearance_fatal:
            c_clear = 0.0
            explanations['clearance'] = "Hard failure: mandatory functional clearance violation."
        elif advisory_count > 0:
            c_clear = max(30.0, 100.0 - (advisory_count * 15.0))
            explanations['clearance'] = f"Adequate clearance: {advisory_count} advisory spacing warning(s) noted."
        else:
            c_clear = 100.0
            explanations['clearance'] = "Optimal clearances: generous conversational, ergonomic, and walking margins."

        # -------------------------------------------------------------
        # 5. Space Utilization Component (Weight: 10%)
        # -------------------------------------------------------------
        room = candidate_scene.get('room', {})
        room_w = float(room.get('width', 5.0))
        room_l = float(room.get('length', 4.0))
        room_area = room_w * room_l

        objects = candidate_scene.get('objects', [])
        furniture_footprint = 0.0
        for obj in objects:
            dims = obj.get('dimensions', [1, 1, 1])
            scale = obj.get('scale', [1, 1, 1])
            furniture_footprint += (dims[0] * scale[0]) * (dims[2] * scale[2])

        coverage_ratio = (furniture_footprint / room_area) if room_area > 0 else 0.0

        if coverage_ratio == 0:
            c_util = 50.0
            explanations['utilization'] = "Empty room: 0% floor utilization."
        elif 0.12 <= coverage_ratio <= 0.38:
            # Ideal 12% to 38% residential floor coverage
            c_util = 100.0
            explanations['utilization'] = f"Ideal space balance: {coverage_ratio*100:.1f}% floor coverage maintains spaciousness."
        elif coverage_ratio < 0.12:
            c_util = max(60.0, 60.0 + (coverage_ratio / 0.12) * 40.0)
            explanations['utilization'] = f"Spacious/minimalist: {coverage_ratio*100:.1f}% floor coverage with ample open area."
        else:
            # > 38% coverage: slightly congested
            excess = coverage_ratio - 0.38
            c_util = max(30.0, 100.0 - (excess / 0.30) * 70.0)
            explanations['utilization'] = f"High density: {coverage_ratio*100:.1f}% floor coverage may feel somewhat compact."

        # -------------------------------------------------------------
        # 6. Budget Compliance Component (Weight: 5%)
        # -------------------------------------------------------------
        max_budget = budget_diff.get('max_budget_paise')
        if max_budget is None and user_requirements and 'budget_paise' in user_requirements:
            max_budget = user_requirements['budget_paise']

        budget_evaluated = max_budget is not None

        if not validation_feedback.is_budget_compliant:
            c_budget = 0.0
            explanations['budget'] = "Hard failure: candidate layout total exceeds user-specified budget limit."
        elif max_budget is not None and max_budget > 0:
            after_paise = budget_diff.get('after_total_paise', budget_diff.get('after_paise', 0))
            if after_paise <= max_budget:
                c_budget = 100.0
                ratio = (after_paise / max_budget) * 100
                explanations['budget'] = f"Within budget: ₹{after_paise/100:.2f} is {ratio:.1f}% of ₹{max_budget/100:.2f} cap."
            else:
                c_budget = 0.0
                explanations['budget'] = f"Over budget: ₹{after_paise/100:.2f} exceeds ₹{max_budget/100:.2f} cap."
        else:
            # Neutral treatment when no budget cap is specified
            c_budget = 100.0
            explanations['budget'] = "No budget cap specified; neutral score applied."

        # -------------------------------------------------------------
        # Aggregated Base Overall Score (Phase 6 Foundation)
        # S_base = 0.25*C_bound + 0.25*C_coll + 0.20*C_circ + 0.15*C_clear + 0.10*C_util + 0.05*C_budget
        # -------------------------------------------------------------
        s_base = (
            SCORE_WEIGHTS['boundary'] * c_bound
            + SCORE_WEIGHTS['collision'] * c_coll
            + SCORE_WEIGHTS['circulation'] * c_circ
            + SCORE_WEIGHTS['clearance'] * c_clear
            + SCORE_WEIGHTS['utilization'] * c_util
            + SCORE_WEIGHTS['budget'] * c_budget
        )

        # -------------------------------------------------------------
        # Phase 7.1 Preference-Aware Scoring Extension
        # -------------------------------------------------------------
        from apps.furniture.models import FurnitureAsset
        from apps.ai_agent.preference_engine import NormalizedDesignPreferences, normalize_preferences

        norm_prefs: Optional[NormalizedDesignPreferences] = None
        if isinstance(preferences, NormalizedDesignPreferences):
            norm_prefs = preferences
        elif isinstance(preferences, dict):
            norm_prefs = normalize_preferences(structured_preferences=preferences)

        pref_dims: Dict[str, float] = {}
        pref_expl: Dict[str, str] = {}
        unavail_attrs: List[str] = []
        conflicts: List[str] = list(norm_prefs.detected_conflicts) if norm_prefs else []

        if norm_prefs and norm_prefs.has_meaningful_preferences:
            objects = candidate_scene.get('objects', [])
            cand_asset_ids = [obj.get('assetId') for obj in objects if obj.get('assetId')]
            asset_map = {
                a.id: a for a in FurnitureAsset.objects.filter(id__in=cand_asset_ids)  # pyrefly: ignore[missing-attribute]
            }

            # 1. Style Match Dimension
            if norm_prefs.style_preferences:
                style_matches = 0
                style_total = 0
                for obj in objects:
                    aid = obj.get('assetId')
                    asset = asset_map.get(aid)
                    if asset:
                        style_total += 1
                        tags = [str(t).lower() for t in (asset.style_tags or [])]
                        desc = str(asset.description or '').lower()
                        name = str(asset.name or '').lower()
                        all_text = " ".join(tags) + " " + desc + " " + name
                        matched_style = False
                        for req in norm_prefs.style_preferences:
                            style_keys = [req]
                            if req == 'japandi':
                                style_keys.extend(['scandinavian', 'minimalist', 'wood'])
                            elif req == 'transitional':
                                style_keys.extend(['modern', 'classic'])
                            elif req == 'modern':
                                style_keys.extend(['contemporary', 'minimalist'])
                            if any(k in all_text for k in style_keys):
                                matched_style = True
                                break
                        if matched_style:
                            style_matches += 1
                    elif aid:
                        unavail_attrs.append(f"Asset '{aid}' metadata unavailable for style matching.")

                score_style = (style_matches / max(1, style_total)) * 100.0 if style_total > 0 else 50.0
                if 'minimalist' in norm_prefs.style_preferences and len(objects) > 4:
                    score_style = max(30.0, score_style - (len(objects) - 4) * 10.0)
                pref_dims['style'] = score_style
                pref_expl['style'] = f"Style match: {style_matches}/{style_total} items match {norm_prefs.style_preferences}."

            # 2. Colour Match Dimension
            if norm_prefs.colour_preferences:
                col_matches = 0
                col_total = 0
                for obj in objects:
                    col_total += 1
                    aid = obj.get('assetId')
                    asset = asset_map.get(aid)
                    mat_overrides = obj.get('materialOverrides') or {}
                    obj_color = str(obj.get('color') or mat_overrides.get('color') or '').lower()
                    desc = (str(asset.description or '') + " " + str(asset.name or '') + " " + obj_color).lower() if asset else obj_color
                    matched = False
                    for req_col in norm_prefs.colour_preferences:
                        if req_col == 'warm_neutrals':
                            if any(k in desc for k in ('warm', 'beige', 'oak', 'wood', 'cream', 'sand', 'pine', 'tan', 'fabric')) or any(k in obj_color for k in ('#d97706', '#b45309', '#f59e0b', '#78350f', '#fde68a', '#4f46e5')):
                                matched = True
                        elif req_col == 'cool_neutrals':
                            if any(k in desc for k in ('cool', 'grey', 'gray', 'slate', 'steel', 'black', 'white')) or any(k in obj_color for k in ('#64748b', '#475569', '#94a3b8', '#334155', '#1e293b', '#f1f5f9', '#ffffff', '#000000')):
                                matched = True
                        elif req_col in ('natural_wood', 'wood') and any(k in desc for k in ('wood', 'oak', 'walnut', 'timber', 'pine')):
                            matched = True
                        elif req_col == 'earth_tones' and any(k in desc for k in ('earth', 'terracotta', 'olive', 'brown', 'walnut')):
                            matched = True
                        elif req_col == 'monochrome' and any(k in desc for k in ('black', 'white', 'monochrome', 'matte white')):
                            matched = True
                    if matched:
                        col_matches += 1
                pref_dims['colour'] = (col_matches / max(1, col_total)) * 100.0 if col_total > 0 else 70.0
                pref_expl['colour'] = f"Colour match: {col_matches}/{col_total} items match {norm_prefs.colour_preferences}."

            # 3. Material Match Dimension
            if norm_prefs.material_preferences:
                mat_matches = 0
                mat_total = 0
                for obj in objects:
                    aid = obj.get('assetId')
                    asset = asset_map.get(aid)
                    if asset:
                        mat_total += 1
                        desc = (str(asset.description or '') + " " + str(asset.name or '')).lower()
                        matched_mat = False
                        for req in norm_prefs.material_preferences:
                            mat_keys = [req]
                            if req == 'wood':
                                mat_keys.extend(['oak', 'walnut', 'pine', 'timber'])
                            elif req == 'metal':
                                mat_keys.extend(['steel', 'iron', 'aluminum', 'chrome'])
                            elif req == 'fabric':
                                mat_keys.extend(['upholstered', 'linen', 'cushion', 'cloth', 'textured fabric'])
                            elif req == 'glass':
                                mat_keys.extend(['glazed', 'tempered'])
                            elif req == 'leather':
                                mat_keys.extend(['hide'])
                            if any(k in desc for k in mat_keys):
                                matched_mat = True
                                break
                        if matched_mat:
                            mat_matches += 1
                    elif aid:
                        unavail_attrs.append(f"Asset '{aid}' metadata unavailable for material matching.")
                pref_dims['material'] = (mat_matches / max(1, mat_total)) * 100.0 if mat_total > 0 else 50.0
                pref_expl['material'] = f"Material match: {mat_matches}/{mat_total} items match {norm_prefs.material_preferences}."

            # 4. Layout Match Dimension
            if norm_prefs.layout_preferences:
                l_scores = []
                for req_layout in norm_prefs.layout_preferences:
                    if req_layout in ('open_space', 'max_usable_floor'):
                        l_scores.append(max(20.0, min(100.0, 100.0 - (c_util - 50.0))))
                    elif req_layout == 'perimeter':
                        l_scores.append(c_bound)
                    elif req_layout == 'conversation':
                        has_rels = len(candidate_scene.get('relationships', [])) > 0
                        l_scores.append(100.0 if has_rels else 60.0)
                    elif req_layout == 'workspace':
                        has_desk = any(str(obj.get('category', '')).lower() in ('tables', 'workspace') for obj in objects)
                        l_scores.append(100.0 if has_desk else 50.0)
                    elif req_layout == 'symmetrical':
                        l_scores.append(85.0)
                    else:
                        l_scores.append(80.0)
                pref_dims['layout'] = sum(l_scores) / len(l_scores) if l_scores else 80.0
                pref_expl['layout'] = f"Layout match for {norm_prefs.layout_preferences}."

            # 5. Functional Priorities Dimension
            if norm_prefs.functional_priorities:
                fp_scores = []
                for p in norm_prefs.functional_priorities:
                    if p == 'circulation':
                        fp_scores.append(c_circ)
                    elif p in ('open_floor_area', 'natural_light'):
                        fp_scores.append(c_clear)
                    elif p == 'storage':
                        has_storage = any(str(obj.get('category', '')).lower() == 'storage' for obj in objects)
                        fp_scores.append(100.0 if has_storage else 50.0)
                    elif p == 'seating':
                        has_seating = any(str(obj.get('category', '')).lower() == 'seating' for obj in objects)
                        fp_scores.append(100.0 if has_seating else 50.0)
                    elif p == 'workspace':
                        has_work = any('desk' in str(obj.get('name', '')).lower() or 'desk' in str(obj.get('assetId', '')).lower() for obj in objects)
                        fp_scores.append(100.0 if has_work else 50.0)
                    else:
                        fp_scores.append(80.0)
                pref_dims['functional_priorities'] = sum(fp_scores) / len(fp_scores) if fp_scores else 80.0
                pref_expl['functional_priorities'] = f"Priority fulfillment for {norm_prefs.functional_priorities}."

            # 6. Preservation Match Dimension
            if norm_prefs.preserve_object_ids:
                cand_obj_ids = {obj.get('id') for obj in objects}
                preserved_count = sum(1 for pid in norm_prefs.preserve_object_ids if pid in cand_obj_ids)
                total_to_preserve = len(norm_prefs.preserve_object_ids)
                pref_dims['preservation'] = (preserved_count / total_to_preserve) * 100.0
                pref_expl['preservation'] = f"Preserved {preserved_count}/{total_to_preserve} designated objects."

            # Weighted Preference Score S_pref
            w_total = 0.0
            p_total = 0.0
            weights = norm_prefs.preference_weights
            for dim, val in pref_dims.items():
                w = weights.get(dim, 1.0)
                p_total += w * val
                w_total += w
            s_pref = p_total / w_total if w_total > 0 else 100.0

            # Lambda blending: default 0.20, bounded between [0.0, 0.30]
            lambda_weight = 0.20
            s_final = (1.0 - lambda_weight) * s_base + lambda_weight * s_pref
            overall_score = s_final
        else:
            s_pref = 100.0
            lambda_weight = 0.0
            s_final = s_base
            overall_score = s_base

        return ScoreBreakdown(
            boundary=c_bound,
            collision=c_coll,
            circulation=c_circ,
            clearance=c_clear,
            utilization=c_util,
            budget=c_budget,
            overall=overall_score,
            base_score=s_base,
            preference_score=s_pref,
            final_score=s_final,
            lambda_weight=lambda_weight,
            preference_dimensions=pref_dims,
            preference_explanations=pref_expl,
            preference_conflicts=conflicts,
            unavailable_attributes=unavail_attrs,
            weights=dict(SCORE_WEIGHTS),
            explanations=explanations,
            budget_evaluated=budget_evaluated,
        )
