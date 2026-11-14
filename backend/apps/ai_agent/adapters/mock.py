import time
from typing import Any
from apps.ai_agent.adapters.base import BaseDesignLLMAdapter, DesignProposalResult


class MockDesignLLMAdapter(BaseDesignLLMAdapter):
    """
    Deterministic offline mock adapter for local development, CI/CD, and automated tests.
    Recognizes common architectural, interior design, semantic socket attachment,
    and functional zone requests to produce structured, typed proposals.
    """

    def generate_design_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
    ) -> DesignProposalResult:
        start_time = time.time()
        prompt_lower = user_prompt.lower()
        actions: list[dict[str, Any]] = []

        existing_objects = current_scene.get('objects', []) if isinstance(current_scene, dict) else []
        room = current_scene.get('room', {'width': 5.0, 'length': 4.0, 'height': 2.8}) if isinstance(current_scene, dict) else {'width': 5.0, 'length': 4.0, 'height': 2.8}

        from apps.furniture.models import FurnitureAsset

        def pick_asset_id(canonical_id: str, fallback_id: str) -> str:
            if FurnitureAsset.objects.filter(id=canonical_id).exists():  # pyrefly: ignore[missing-attribute]
                return canonical_id
            return fallback_id

        # 0. Dedicated Failure / Rejection Scenarios for automated validation tests
        if 'incompatible socket' in prompt_lower or 'attach bed to sofa' in prompt_lower:
            text = "Testing incompatible socket rejection scenario: attempting to attach a bed to a sofa front table socket."
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-sofa-test',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [0.0, 0.45, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-bed-incompat',
                'asset_id': pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood'),
                'position': [0.0, 0.475, 1.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'mock-sofa-test',
                'child_object_id': 'mock-bed-incompat',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            })

        elif 'occupied socket' in prompt_lower:
            text = "Testing occupied socket rejection scenario: attempting to attach two tables to the same front socket."
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-sofa-occ',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [0.0, 0.45, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-table-1',
                'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                'position': [0.0, 0.225, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'mock-sofa-occ',
                'child_object_id': 'mock-table-1',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-table-2',
                'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                'position': [0.0, 0.225, 1.5],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'mock-sofa-occ',
                'child_object_id': 'mock-table-2',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            })

        elif 'out of bounds' in prompt_lower or 'invalid attachment' in prompt_lower:
            text = "Testing physically invalid attachment scenario: anchor placed near room perimeter causing child to breach room wall."
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-sofa-edge',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [2.2, 0.45, 0.0],  # Against right boundary
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'mock-chair-edge',
                'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                'position': [0.0, 0.44, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'mock-sofa-edge',
                'child_object_id': 'mock-chair-edge',
                'socket_id': 'sofa-right-accent',
                'gap_meters': 0.80,  # Extending beyond wall
            })

        elif 'clear and preserve' in prompt_lower:
            text = "Testing preservation violation scenario: proposal contains clear_room while preserve_existing_furniture is True."
            actions.append({
                'type': 'propose_zone_arrangement',
                'zone_type': 'living',
                'intent': 'Attempt invalid clearance while preserving',
                'requirements': {'preserve_existing_furniture': True},
            })
            actions.append({
                'type': 'clear_room',
                'confirm': True,
            })

        # 1. Conversational Living Area Scenario
        elif any(w in prompt_lower for w in ['conversational', 'living area', 'conversation area', 'sofa and coffee table', 'sofa, coffee table']):
            text = (
                "I have arranged a cohesive conversational living area. The modern 3-seater sofa anchors "
                "the space, with an oak coffee table ergonomically attached to its front socket (45cm clearance) "
                "and two accent armchairs angled inward on the lateral sockets for balanced conversation."
            )
            sofa_asset = pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern')
            coffee_asset = pick_asset_id('table-oak-coffee', 'coffee-table-minimal')
            armchair_asset = pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic')

            actions.append({
                'type': 'propose_zone_arrangement',
                'zone_type': 'living',
                'intent': 'Create a conversational living area with sofa, coffee table, and accent chairs',
                'requirements': {
                    'required_categories': ['seating', 'tables'],
                    'preferred_categories': ['seating'],
                    'preserve_existing_furniture': True,
                },
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'sofa-conv-anchor',
                'asset_id': sofa_asset,
                'position': [0.0, 0.45, -0.6],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#4f46e5',
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'table-coffee-front',
                'asset_id': coffee_asset,
                'position': [0.0, 0.225, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'sofa-conv-anchor',
                'child_object_id': 'table-coffee-front',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'chair-accent-left',
                'asset_id': armchair_asset,
                'position': [-1.2, 0.44, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'sofa-conv-anchor',
                'child_object_id': 'chair-accent-left',
                'socket_id': 'sofa-left-accent',
                'gap_meters': 0.50,
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'chair-accent-right',
                'asset_id': armchair_asset,
                'position': [1.2, 0.44, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'sofa-conv-anchor',
                'child_object_id': 'chair-accent-right',
                'socket_id': 'sofa-right-accent',
                'gap_meters': 0.50,
            })

        # 2. Functional Sleeping Zone Scenario
        elif any(w in prompt_lower for w in ['sleeping zone', 'bed and nightstand', 'bed with nightstand', 'functional sleeping', 'bedroom zone', 'nightstands beside']):
            text = (
                "I have configured a functional sleeping zone featuring a Nordic Queen Platform Bed "
                "anchored against the rear wall, with dual bedside nightstands attached symmetrically "
                "to the left and right sockets with a neat 8cm gap, leaving generous clearance for circulation."
            )
            bed_asset = pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood')
            nightstand_asset = pick_asset_id('table-bedside-nightstand', 'table-bedside-nightstand')

            actions.append({
                'type': 'propose_zone_arrangement',
                'zone_type': 'sleeping',
                'intent': 'Arrange a functional sleeping zone with bed and twin bedside nightstands',
                'requirements': {
                    'required_categories': ['beds', 'tables'],
                    'preserve_existing_furniture': True,
                },
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'bed-sleep-anchor',
                'asset_id': bed_asset,
                'position': [0.0, 0.475, -0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#d97706',
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'nightstand-left',
                'asset_id': nightstand_asset,
                'position': [-1.2, 0.25, -0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'bed-sleep-anchor',
                'child_object_id': 'nightstand-left',
                'socket_id': 'bed-left-nightstand',
                'gap_meters': 0.08,
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'nightstand-right',
                'asset_id': nightstand_asset,
                'position': [1.2, 0.25, -0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'bed-sleep-anchor',
                'child_object_id': 'nightstand-right',
                'socket_id': 'bed-right-nightstand',
                'gap_meters': 0.08,
            })

        # 3. Workspace Arrangement Scenario
        elif any(w in prompt_lower for w in ['workspace', 'study area', 'desk, chair', 'desk and chair', 'desk with chair']):
            text = (
                "I have designed a compact, ergonomic study workspace. The study desk is placed along "
                "the wall, with a task armchair attached directly to the front knee-well socket (20cm pullout), "
                "and a vertical bookshelf positioned along the perimeter wall to guarantee an unobstructed circulation path."
            )
            desk_asset = pick_asset_id('desk-workspace-study', 'study-desk-ergo')
            chair_asset = pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic')
            shelf_asset = pick_asset_id('storage-bookshelf-tall', 'bookshelf-4tier-metal')

            actions.append({
                'type': 'propose_zone_arrangement',
                'zone_type': 'workspace',
                'intent': 'Create a compact study workspace with desk, attached chair, and storage',
                'requirements': {
                    'required_categories': ['tables', 'seating', 'storage'],
                    'preserve_existing_furniture': True,
                },
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'desk-work-anchor',
                'asset_id': desk_asset,
                'position': [-1.2, 0.375, -0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#475569',
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'chair-task-front',
                'asset_id': chair_asset,
                'position': [-1.2, 0.44, -0.2],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
            actions.append({
                'type': 'attach_to_socket',
                'anchor_object_id': 'desk-work-anchor',
                'child_object_id': 'chair-task-front',
                'socket_id': 'desk-knee-well-chair',
                'gap_meters': 0.20,
            })
            actions.append({
                'type': 'add_furniture',
                'object_id': 'shelf-storage-work',
                'asset_id': shelf_asset,
                'position': [1.8, 0.9, -0.8],
                'rotation_euler': [0.0, -1.5708, 0.0],
                'color': '#1e293b',
            })

        # 4. Clear / Empty room
        elif any(w in prompt_lower for w in ['clear', 'empty room', 'remove all', 'start over', 'clean slate']):
            text = (
                "I have prepared a proposal to clear the room so you can start with a fresh layout. "
                "Please review the proposal and approve when ready."
            )
            actions.append({
                'type': 'clear_room',
                'confirm': True,
            })

        # 5. Add Armchair / Chair
        elif any(w in prompt_lower for w in ['armchair', 'chair', 'accent chair', 'reading']):
            text = (
                "I recommend adding a Lounge Accent Armchair to establish a comfortable reading nook "
                "complementing the primary seating zone. Here is the proposed placement."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                'position': [-1.3, 0.44, 0.5],
                'rotation_euler': [0.0, 0.52, 0.0],  # ~30 degrees inward
                'color': '#4f46e5',
            })

        # 6. Add Bed / Bedroom setup
        elif any(w in prompt_lower for w in ['bed', 'bedroom', 'queen']):
            text = (
                "I have arranged a Nordic Queen Platform Bed anchored against the back wall, "
                "leaving generous clearance along both sides for ease of circulation."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood'),
                'position': [0.0, 0.475, -0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#d97706',
            })

        # 7. Add Coffee Table
        elif any(w in prompt_lower for w in ['coffee table', 'center table', 'tea table']):
            text = (
                "I suggest adding a Minimalist Coffee Table in front of your sofa "
                "to provide an anchor for the conversational area."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                'position': [0.0, 0.225, 0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#334155',
            })

        # 8. Add Plant / Decor
        elif any(w in prompt_lower for w in ['plant', 'planter', 'decor', 'greenery', 'foliage']):
            text = (
                "Adding a Botanical Ceramic Floor Planter near the corner will introduce organic textures "
                "and biophilic warmth into your interior."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': pick_asset_id('decor-plant-floor-vase', 'decor-plant-monstera-terracotta'),
                'position': [1.8, 0.55, -1.2],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#059669',
            })

        # 9. Add Desk / Study
        elif any(w in prompt_lower for w in ['desk', 'study', 'workstation', 'office']):
            text = (
                "I have planned an Ergonomic Study Desk along the perimeter wall "
                "to maximize natural room illumination without obstructing pathways."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': pick_asset_id('desk-workspace-study', 'study-desk-ergo'),
                'position': [-1.5, 0.375, -1.0],
                'rotation_euler': [0.0, 0.0, 0.0],
                'color': '#475569',
            })

        # 10. Add Bookshelf / Storage
        elif any(w in prompt_lower for w in ['bookshelf', 'shelf', 'storage', 'bookcase']):
            text = (
                "Placing a 4-Tier Bookshelf against the lateral wall provides ample vertical display "
                "and storage while conserving floor area."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': pick_asset_id('storage-bookshelf-tall', 'bookshelf-4tier-metal'),
                'position': [1.8, 0.9, 0.0],
                'rotation_euler': [0.0, -1.57, 0.0],  # facing inward
                'color': '#1e293b',
            })

        # 11. Color / Material Update
        elif any(w in prompt_lower for w in ['color', 'colour', 'emerald', 'amber', 'slate', 'cream', 'charcoal']):
            if existing_objects:
                target = existing_objects[0]
                target_id = target.get('id', 'item-0')
                target_name = target.get('name', 'furniture item')
                chosen_color = '#059669' if 'emerald' in prompt_lower else ('#d97706' if 'amber' in prompt_lower else '#334155')
                text = f"I propose updating the upholstery color of '{target_name}' to enhance the palette harmony."
                actions.append({
                    'type': 'set_material',
                    'object_id': target_id,
                    'color': chosen_color,
                    'roughness': 0.6,
                    'metalness': 0.1,
                })
            else:
                text = "The room is currently empty. Add furniture pieces first before applying custom material swatches."

        # 12. Rearrange / Move
        elif any(w in prompt_lower for w in ['move', 'rearrange', 'shift', 'reposition']):
            if existing_objects:
                target = existing_objects[0]
                target_id = target.get('id', 'item-0')
                target_name = target.get('name', 'furniture item')
                text = f"I have adjusted the position of '{target_name}' to optimize room flow and traffic lanes."
                actions.append({
                    'type': 'move_object',
                    'object_id': target_id,
                    'position': [0.0, target.get('position', [0, 0.4, 0])[1], -0.5],
                    'rotation_euler': [0.0, 0.0, 0.0],
                })
            else:
                text = "Add some furniture items to the room first so I can arrange an optimal layout for you."

        # 13. Default recommendation
        else:
            text = (
                f"Based on your room dimensions ({room.get('width', 5)}m × {room.get('length', 4)}m), "
                "I recommend creating a cohesive conversational layout. Here is a curated addition to balance the space."
            )
            actions.append({
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [-1.2, 0.44, 0.6],
                'rotation_euler': [0.0, 0.78, 0.0],
                'color': '#4f46e5',
            })

        latency = int((time.time() - start_time) * 1000)
        return DesignProposalResult(
            text_response=text,
            proposed_actions=actions,
            provider='mock',
            model='deterministic-mock-v1',
            latency_ms=max(1, latency),
            raw_metadata={'mock_rule_matched': True, 'action_count': len(actions)},
        )

    def generate_candidate_variants(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        candidate_count: int = 3,
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
        user_requirements: dict[str, Any] | None = None,
        preferences: Any = None,
    ) -> list[DesignProposalResult]:
        """
        Generates multiple distinct candidate layout proposals for Phase 6.3.
        Supports all 12 deterministic test and demonstration scenarios offline.
        """
        prompt_lower = user_prompt.lower()
        room = current_scene.get('room', {'width': 5.0, 'length': 4.0, 'height': 2.8}) if isinstance(current_scene, dict) else {'width': 5.0, 'length': 4.0, 'height': 2.8}
        room_w = float(room.get('width', 5.0))
        room_l = float(room.get('length', 4.0))
        existing_objects = current_scene.get('objects', []) if isinstance(current_scene, dict) else []

        from apps.furniture.models import FurnitureAsset

        def pick_asset_id(canonical_id: str, fallback_id: str, category: str = '') -> str:
            if FurnitureAsset.objects.filter(id=canonical_id).exists():  # pyrefly: ignore[missing-attribute]
                return canonical_id
            if FurnitureAsset.objects.filter(id=fallback_id).exists():  # pyrefly: ignore[missing-attribute]
                return fallback_id
            # Infer category from ID if not explicitly provided
            inferred_cat = category
            if not inferred_cat:
                cid_lower = (canonical_id + " " + fallback_id).lower()
                if 'chair' in cid_lower:
                    inferred_cat = 'seating'
                elif 'sofa' in cid_lower or 'couch' in cid_lower:
                    inferred_cat = 'seating'
                elif 'desk' in cid_lower or 'table' in cid_lower or 'nightstand' in cid_lower:
                    inferred_cat = 'tables'
                elif 'bed' in cid_lower:
                    inferred_cat = 'beds'
                elif 'storage' in cid_lower or 'shelf' in cid_lower or 'wardrobe' in cid_lower or 'book' in cid_lower:
                    inferred_cat = 'storage'
                elif 'plant' in cid_lower or 'decor' in cid_lower or 'vase' in cid_lower:
                    inferred_cat = 'decor'

            if inferred_cat:
                matched = FurnitureAsset.objects.filter(category=inferred_cat, is_active=True).first()  # pyrefly: ignore[missing-attribute]
                if matched:
                    return matched.id
            any_asset = FurnitureAsset.objects.filter(is_active=True).first()  # pyrefly: ignore[missing-attribute]
            if any_asset:
                return any_asset.id
            return fallback_id

        variants: list[DesignProposalResult] = []

        # -------------------------------------------------------------
        # Negative Gate / Incompatible Socket Attachment Test Case
        # -------------------------------------------------------------
        if 'incompatible socket' in prompt_lower or 'attach bed to sofa' in prompt_lower:
            sofa_id = pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern', category='seating')
            bed_id = pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood', category='beds')
            incompat_proposal = DesignProposalResult(
                text_response="Negative gate test: attempting incompatible socket attachment.",
                proposed_actions=[
                    {
                        'type': 'add_furniture',
                        'object_id': 'mock-sofa-test',
                        'asset_id': sofa_id,
                        'position': [0.0, 0.45, 0.0],
                        'rotation_euler': [0.0, 0.0, 0.0],
                    },
                    {
                        'type': 'add_furniture',
                        'object_id': 'mock-bed-incompat',
                        'asset_id': bed_id,
                        'position': [0.0, 0.475, 1.0],
                        'rotation_euler': [0.0, 0.0, 0.0],
                    },
                    {
                        'type': 'attach_to_socket',
                        'anchor_object_id': 'mock-sofa-test',
                        'child_object_id': 'mock-bed-incompat',
                        'socket_id': 'sofa-front-table',
                        'gap_meters': 0.45,
                    },
                ],
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Incompatible Socket Proposal",
                description="Attempting to attach a bed to a sofa front-table socket.",
                trade_offs=["Invalid semantic socket attachment"],
            )
            return [incompat_proposal] * candidate_count

        # -------------------------------------------------------------
        # Negative Gate: Ambiguous or Unsupported Furniture Request (SCN-90, SCN-91)
        # -------------------------------------------------------------
        if 'asdfghjk' in prompt_lower or 'piano' in prompt_lower or 'unsupported' in prompt_lower:
            invalid_proposal = DesignProposalResult(
                text_response="Negative gate test: ambiguous or unsupported furniture request cannot produce an eligible candidate.",
                proposed_actions=[
                    {
                        'type': 'add_furniture',
                        'object_id': 'mock-invalid-request',
                        'asset_id': 'unsupported-asset-nonexistent',
                        'position': [50.0, 0.0, 50.0],
                        'rotation_euler': [0.0, 0.0, 0.0],
                    }
                ],
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Infeasible / Ambiguous Proposal",
                description="Prompt contains unsupported furniture or ambiguous non-spatial content.",
                trade_offs=["Cannot fulfill request"],
            )
            return [invalid_proposal] * candidate_count

        # -------------------------------------------------------------
        # Single Armchair Request (e.g. "Add an armchair")
        # -------------------------------------------------------------
        if any(w in prompt_lower for w in ('armchair', 'reading', 'cozy chair')) and not any(w in prompt_lower for w in ('sofa', 'workspace', 'boundary', 'collision', 'clearance', 'budget')):
            armchair_id = pick_asset_id('armchair-accent-nordic', 'chair-accent-armchair', category='seating')
            cand_a = DesignProposalResult(
                text_response="Option A adds an armchair in a cozy reading corner with a 45° angle to the room.",
                proposed_actions=[{
                    'type': 'add_furniture',
                    'asset_id': armchair_id,
                    'position': [-1.2, 0.44, 0.6],
                    'rotation_euler': [0.0, 0.78, 0.0],
                    'color': '#4f46e5',
                }],
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Cozy Reading Corner",
                description="Angled armchair positioned in a quiet room quadrant.",
                trade_offs=["Corner placement", "Dedicated reading nook"],
            )
            cand_b = DesignProposalResult(
                text_response="Option B places the armchair along the side perimeter to maximize natural lighting.",
                proposed_actions=[{
                    'type': 'add_furniture',
                    'asset_id': armchair_id,
                    'position': [1.2, 0.44, -0.6],
                    'rotation_euler': [0.0, -0.78, 0.0],
                    'color': '#4f46e5',
                }],
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option B: Daylight Perimeter Seating",
                description="Armchair placed to capture natural side illumination.",
                trade_offs=["Perimeter placement", "Good lighting"],
            )
            cand_c = DesignProposalResult(
                text_response="Option C positions the armchair as a welcoming focal seat.",
                proposed_actions=[{
                    'type': 'add_furniture',
                    'asset_id': armchair_id,
                    'position': [0.0, 0.44, 0.8],
                    'rotation_euler': [0.0, 3.14159, 0.0],
                    'color': '#4f46e5',
                }],
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option C: Focal Accent Chair",
                description="Centered accent chair facing the room interior.",
                trade_offs=["Central visibility", "Direct room access"],
            )
            return [cand_a, cand_b, cand_c][:candidate_count]


        # -------------------------------------------------------------
        # Scenario 3: Boundary Violation Candidate
        # -------------------------------------------------------------
        if 'boundary violation' in prompt_lower or 'out of bounds candidate' in prompt_lower:
            actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-oob-sofa',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [room_w + 3.0, 0.45, room_l + 3.0],  # Way out of bounds
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return [DesignProposalResult(
                text_response="Placing sofa outside room boundary to test hard boundary constraint.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Out-of-Bounds Layout",
                description="Intentionally places furniture beyond the exterior walls.",
                trade_offs=["Violates room perimeter containment"],
            )]

        # -------------------------------------------------------------
        # Scenario 4: Collision Candidate
        # -------------------------------------------------------------
        if 'collision candidate' in prompt_lower or 'overlapping' in prompt_lower:
            actions = [
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-coll-sofa-1',
                    'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                    'position': [0.0, 0.45, 0.0],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-coll-sofa-2',
                    'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                    'position': [0.0, 0.45, 0.0],  # Overlaps completely
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
            ]
            return [DesignProposalResult(
                text_response="Placing overlapping furniture items to test hard OBB collision constraint.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Colliding Layout",
                description="Contains overlapping bounding boxes between items.",
                trade_offs=["Direct physical collision between furniture"],
            )]

        # -------------------------------------------------------------
        # Scenario 5: Hard Clearance / Doorway Landing Obstruction
        # -------------------------------------------------------------
        if 'clearance violation' in prompt_lower or 'door blocked' in prompt_lower:
            # Door landing is on south wall at [0.0, 0.0, length/2]
            actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-door-blocker',
                'asset_id': pick_asset_id('storage-bookshelf-tall', 'bookshelf-wood-tall'),
                'position': [0.0, 0.9, (room_l / 2.0) - 0.2],  # Directly in door swing landing
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return [DesignProposalResult(
                text_response="Placing bookshelf directly in door circulation landing zone.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Doorway Obstruction Layout",
                description="Blocks the primary doorway landing zone.",
                trade_offs=["Blocks room entry and exit"],
            )]

        # -------------------------------------------------------------
        # Scenario 6: Advisory-only Warnings
        # -------------------------------------------------------------
        if 'advisory' in prompt_lower or 'spacing warning' in prompt_lower:
            # Place armchair very close to wall (e.g. 2cm margin)
            actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-tight-chair',
                'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                'position': [(room_w / 2.0) - 0.45, 0.44, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return [DesignProposalResult(
                text_response="Placing armchair close to room perimeter to trigger advisory spacing note.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Perimeter Layout",
                description="Valid placement with advisory edge proximity.",
                trade_offs=["Tight perimeter clearance", "Compact footprint"],
            )]

        # -------------------------------------------------------------
        # Scenario 7: Budget-Cap Violation Candidate
        # -------------------------------------------------------------
        if 'budget violation' in prompt_lower or 'expensive candidate' in prompt_lower:
            actions = [
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-lux-sofa',
                    'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                    'position': [0.0, 0.45, -0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-lux-bed',
                    'asset_id': pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood'),
                    'position': [1.2, 0.475, 0.5],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-lux-desk',
                    'asset_id': pick_asset_id('desk-executive-wood', 'desk-modern-wood'),
                    'position': [-1.2, 0.375, 0.5],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
            ]
            return [DesignProposalResult(
                text_response="Adding multiple luxury items that exceed the user's allocated budget ceiling.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Premium Fixtures",
                description="Exceeds current budget ceiling with luxury items.",
                trade_offs=["Budget limit exceeded", "Premium furniture selection"],
            )]

        # -------------------------------------------------------------
        # Scenario 8: Candidate that Succeeds after One Refinement
        # -------------------------------------------------------------
        if 'succeed after refinement' in prompt_lower or 'refinement success' in prompt_lower:
            # Initially slightly out of bounds on X
            actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-refine-sofa',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [(room_w / 2.0) + 0.3, 0.45, 0.0],  # 0.3m out of bounds
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return [DesignProposalResult(
                text_response="Initially flawed placement: sofa placed slightly beyond wall boundary.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Seating (Needs Refinement)",
                description="Initially extends beyond boundary; refined on pass 1.",
                trade_offs=["Boundary breach before refinement"],
            )]

        # -------------------------------------------------------------
        # Scenario 9: Candidate that Remains Invalid after Two Refinements
        # -------------------------------------------------------------
        if 'remain invalid' in prompt_lower or 'refinement failure' in prompt_lower:
            actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-persist-fail-sofa',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [room_w + 5.0, 0.45, room_l + 5.0],  # Severely out of bounds
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return [DesignProposalResult(
                text_response="Severely invalid placement that cannot be reconciled in two refinements.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Unresolvable Placement",
                description="Permanently out of bounds across all refinement passes.",
                trade_offs=["Invalid placement"],
            )]

        # -------------------------------------------------------------
        # Scenario 11: Insufficient Room for All Requested Furniture
        # -------------------------------------------------------------
        if 'insufficient room' in prompt_lower or 'overcrowded' in prompt_lower:
            # Try to place sofa, bed, desk, and table in a tiny room
            actions = [
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-tiny-sofa',
                    'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                    'position': [0.0, 0.45, -0.5],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-tiny-bed',
                    'asset_id': pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood'),
                    'position': [0.0, 0.475, 0.5],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-tiny-table',
                    'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                    'position': [0.0, 0.225, 0.0],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
            ]
            return [DesignProposalResult(
                text_response="Room dimensions cannot accommodate all requested furniture without severe collisions.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Overcrowded Layout",
                description="Too many large pieces for the available square footage.",
                trade_offs=["Severe crowding and collisions"],
            )]

        # -------------------------------------------------------------
        # Scenario 12: Constrained Room - Cannot Produce 3 Distinct Alternatives
        # -------------------------------------------------------------
        if 'constrained room' in prompt_lower or 'single alternative' in prompt_lower or 'narrow room' in prompt_lower:
            # Return only 1 valid alternative with explanation
            actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-narrow-desk',
                'asset_id': pick_asset_id('desk-executive-wood', 'desk-modern-wood'),
                'position': [0.0, 0.375, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return [DesignProposalResult(
                text_response="Due to narrow room width, only one viable furniture orientation is geometrically possible.",
                proposed_actions=actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Sole Viable Orientation",
                description="Aligns along the long axis; secondary alternatives are constrained by narrow clearance.",
                trade_offs=["Single linear layout", "Constrained circulation"],
            )]

        # -------------------------------------------------------------
        # Scenario: Three Valid Bedroom / Sleeping Zone Alternatives
        # -------------------------------------------------------------
        if any(w in prompt_lower for w in ('bedroom', 'sleeping', 'bed', 'nightstand')) and not any(w in prompt_lower for w in ('boundary violation', 'collision', 'clearance', 'incompatible')):
            bed_asset = pick_asset_id('bed-queen-platform', 'bed-queen-nordic-wood', category='beds')
            nightstand_asset = pick_asset_id('table-bedside-nightstand', 'table-bedside-nightstand', category='tables')
            wardrobe_asset = pick_asset_id('storage-wardrobe-compact', 'wardrobe-2door-compact', category='storage')

            pref_colors = preferences.get('colours', []) if isinstance(preferences, dict) else getattr(preferences, 'colour_preferences', [])
            is_cool = any(w in prompt_lower for w in ('cool', 'grey', 'gray', 'slate', 'steel', 'monochrome')) or 'cool_neutrals' in pref_colors
            cand_color = '#64748b' if is_cool else '#d97706'

            # Detect existing bed in scene to attach nightstands without adding a colliding duplicate bed
            existing_bed = next(
                (o for o in existing_objects if 'bed' in str(o.get('assetId', '')).lower() or 'bed' in str(o.get('name', '')).lower()),
                None
            )
            bed_anchor_id_a = existing_bed['id'] if existing_bed else 'mock-bed-a'
            bed_anchor_id_b = existing_bed['id'] if existing_bed else 'mock-bed-b'
            bed_anchor_id_c = existing_bed['id'] if existing_bed else 'mock-bed-c'

            # Candidate A: Functional Sleeping Zone with Symmetrical Dual Nightstands
            actions_a = []
            if not existing_bed:
                actions_a.append({
                    'type': 'add_furniture',
                    'object_id': 'mock-bed-a',
                    'asset_id': bed_asset,
                    'position': [0.0, 0.475, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                    'color': cand_color,
                })
            actions_a.extend([
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-nightstand-left-a',
                    'asset_id': nightstand_asset,
                    'position': [-1.1, 0.25, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                    'color': cand_color,
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': bed_anchor_id_a,
                    'child_object_id': 'mock-nightstand-left-a',
                    'socket_id': 'bed-left-nightstand',
                    'gap_meters': 0.08,
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-nightstand-right-a',
                    'asset_id': nightstand_asset,
                    'position': [1.1, 0.25, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                    'color': cand_color,
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': bed_anchor_id_a,
                    'child_object_id': 'mock-nightstand-right-a',
                    'socket_id': 'bed-right-nightstand',
                    'gap_meters': 0.08,
                },
                {
                    'type': 'propose_zone_arrangement',
                    'zone_type': 'sleeping',
                    'intent': 'Symmetrical sleeping zone with bed and dual attached nightstands',
                    'requirements': {'required_categories': ['beds', 'tables'], 'preserve_existing_furniture': True},
                },
            ])
            cand_a = DesignProposalResult(
                text_response="Option A anchors a queen bed with dual nightstands attached symmetrically via sockets, preserving open circulation.",
                proposed_actions=actions_a,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Symmetrical Sleeping Suite",
                description="Queen bed centered along back wall with twin attached bedside nightstands.",
                trade_offs=["Balanced symmetrical aesthetics", "Direct side bedside access"],
            )

            # Candidate B: Bedroom with Bed, Single Nightstand & Compact Wardrobe
            actions_b = []
            if not existing_bed:
                actions_b.append({
                    'type': 'add_furniture',
                    'object_id': 'mock-bed-b',
                    'asset_id': bed_asset,
                    'position': [-0.5, 0.475, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                })
            actions_b.extend([
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-nightstand-b',
                    'asset_id': nightstand_asset,
                    'position': [-1.6, 0.25, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': bed_anchor_id_b,
                    'child_object_id': 'mock-nightstand-b',
                    'socket_id': 'bed-left-nightstand',
                    'gap_meters': 0.08,
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-wardrobe-b',
                    'asset_id': wardrobe_asset,
                    'position': [1.3, 0.9, 0.4],
                    'rotation_euler': [0.0, -1.5708, 0.0],
                },
                {
                    'type': 'propose_zone_arrangement',
                    'zone_type': 'sleeping',
                    'intent': 'Sleeping zone with bedside storage and wardrobe',
                    'requirements': {'required_categories': ['beds', 'storage'], 'preserve_existing_furniture': True},
                },
            ])
            cand_b = DesignProposalResult(
                text_response="Option B pairs the bed and nightstand with a dedicated modular wardrobe for apparel storage.",
                proposed_actions=actions_b,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option B: Storage-Integrated Sleeping Zone",
                description="Bed arrangement combined with perimeter wardrobe storage.",
                trade_offs=["High storage capacity", "Asymmetric floor layout"],
            )

            # Candidate C: Minimalist Open Sleeping Zone
            actions_c = []
            if not existing_bed:
                actions_c.append({
                    'type': 'add_furniture',
                    'object_id': 'mock-bed-c',
                    'asset_id': bed_asset,
                    'position': [0.0, 0.475, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                })
            actions_c.extend([
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-nightstand-right-c',
                    'asset_id': nightstand_asset,
                    'position': [1.1, 0.25, -0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': bed_anchor_id_c,
                    'child_object_id': 'mock-nightstand-right-c',
                    'socket_id': 'bed-right-nightstand',
                    'gap_meters': 0.08,
                },
                {
                    'type': 'propose_zone_arrangement',
                    'zone_type': 'sleeping',
                    'intent': 'Minimalist open sleeping zone maximizing floor space',
                    'requirements': {'required_categories': ['beds', 'tables'], 'preserve_existing_furniture': True},
                },
            ])
            cand_c = DesignProposalResult(
                text_response="Option C maximizes open floor clearance with a streamlined bed and single nightstand layout.",
                proposed_actions=actions_c,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option C: Streamlined Minimalist Bed",
                description="Minimal footprint bed configuration maximizing usable walking space.",
                trade_offs=["Maximum open floor area", "Single bedside surface"],
            )

            all_bed = [cand_a, cand_b, cand_c]
            return all_bed[:candidate_count]

        # -------------------------------------------------------------
        # Scenario 2: Three Valid Workspace Alternatives
        # -------------------------------------------------------------
        if any(w in prompt_lower for w in ('workspace', 'desk', 'office', 'study')):
            # Candidate A: Daylight-focused (desk near perimeter wall/window)
            actions_a = [
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-desk-a',
                    'asset_id': pick_asset_id('desk-workspace-study', 'desk-executive-wood'),
                    'position': [-1.2, 0.375, -0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-a',
                    'asset_id': pick_asset_id('chair-ergonomic-office', 'office-chair-mesh'),
                    'position': [-1.2, 0.45, -0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': 'mock-desk-a',
                    'child_object_id': 'mock-chair-a',
                    'socket_id': 'desk-knee-well-chair',
                    'gap_meters': 0.15,
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-book-a',
                    'asset_id': pick_asset_id('storage-bookshelf-tall', 'bookshelf-wood-tall'),
                    'position': [-1.2, 0.9, 0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'propose_zone_arrangement',
                    'zone_type': 'workspace',
                    'intent': 'Daylight-oriented productive home office',
                    'requirements': {'preserve_existing_furniture': True},
                },
            ]
            cand_a = DesignProposalResult(
                text_response="Option A positions the desk along the side wall to capture natural daylight with attached ergonomic chair and reference storage.",
                proposed_actions=actions_a,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Daylight-Focused Workspace",
                description="Desk positioned to capture natural window illumination with adjacent storage.",
                trade_offs=["Optimal ambient lighting", "Slightly further from primary entrance"],
            )

            # Candidate B: Open-circulation workspace (desk against back wall)
            actions_b = [
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-desk-b',
                    'asset_id': pick_asset_id('desk-workspace-study', 'desk-executive-wood'),
                    'position': [0.0, 0.375, -1.2],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-b',
                    'asset_id': pick_asset_id('chair-ergonomic-office', 'office-chair-mesh'),
                    'position': [0.0, 0.45, -1.2],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': 'mock-desk-b',
                    'child_object_id': 'mock-chair-b',
                    'socket_id': 'desk-knee-well-chair',
                    'gap_meters': 0.15,
                },
                {
                    'type': 'propose_zone_arrangement',
                    'zone_type': 'workspace',
                    'intent': 'Circulation-optimized executive workspace',
                    'requirements': {'preserve_existing_furniture': True},
                },
            ]
            cand_b = DesignProposalResult(
                text_response="Option B centers the desk along the back wall to maximize open walking paths and room circulation.",
                proposed_actions=actions_b,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option B: Circulation-Optimized Workspace",
                description="Maximizes central room passage and walking clearance with back-wall desk placement.",
                trade_offs=["Clear direct walking routes", "Reduced secondary storage footprint"],
            )

            # Candidate C: Storage-prioritized workspace (desk with dual bookshelves)
            actions_c = [
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-desk-c',
                    'asset_id': pick_asset_id('desk-workspace-study', 'desk-executive-wood'),
                    'position': [0.8, 0.375, -0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },

                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-c',
                    'asset_id': pick_asset_id('chair-ergonomic-office', 'office-chair-mesh'),
                    'position': [0.8, 0.45, -0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': 'mock-desk-c',
                    'child_object_id': 'mock-chair-c',
                    'socket_id': 'desk-knee-well-chair',
                    'gap_meters': 0.15,
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-book-c1',
                    'asset_id': pick_asset_id('storage-bookshelf-tall', 'bookshelf-wood-tall'),
                    'position': [-1.2, 0.9, -0.8],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-book-c2',
                    'asset_id': pick_asset_id('storage-bookshelf-tall', 'bookshelf-wood-tall'),
                    'position': [-1.2, 0.9, 0.6],
                    'rotation_euler': [0.0, 0.0, 0.0],
                },
                {
                    'type': 'propose_zone_arrangement',
                    'zone_type': 'workspace',
                    'intent': 'Storage-prioritized study and research workspace',
                    'requirements': {'preserve_existing_furniture': True},
                },
            ]
            cand_c = DesignProposalResult(
                text_response="Option C incorporates dual storage towers for intensive document, book, and equipment organization.",
                proposed_actions=actions_c,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option C: Storage-Prioritized Setup",
                description="Includes dual storage units for books, documents, and reference materials.",
                trade_offs=["Maximum organization and storage", "Higher floor utilization"],
            )

            all_ws = [cand_a, cand_b, cand_c]
            return all_ws[:candidate_count]

        # -------------------------------------------------------------
        # Scenario 1: Three Valid Living Room Alternatives (Default)
        # -------------------------------------------------------------
        existing_sofa = next(
            (o for o in existing_objects if 'sofa' in str(o.get('assetId', '')).lower() or 'sofa' in str(o.get('name', '')).lower() or 'couch' in str(o.get('name', '')).lower()),
            None
        )
        sofa_anchor_id_a = existing_sofa['id'] if existing_sofa else 'mock-sofa-a'
        sofa_anchor_id_b = existing_sofa['id'] if existing_sofa else 'mock-sofa-b'
        sofa_anchor_id_c = existing_sofa['id'] if existing_sofa else 'mock-sofa-c'
        sofa_pos = existing_sofa.get('position', [0.0, 0.45, -0.8]) if existing_sofa else [0.0, 0.45, -0.8]

        # Candidate A: Conversational Seating Arrangement
        actions_a = []
        if not existing_sofa:
            actions_a.append({
                'type': 'add_furniture',
                'object_id': 'mock-sofa-a',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [0.0, 0.45, -0.8],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
        actions_a.extend([
            {
                'type': 'add_furniture',
                'object_id': 'mock-table-a',
                'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                'position': [sofa_pos[0], 0.225, sofa_pos[2] + 0.9],
                'rotation_euler': [0.0, 0.0, 0.0],
            },
            {
                'type': 'attach_to_socket',
                'anchor_object_id': sofa_anchor_id_a,
                'child_object_id': 'mock-table-a',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.40,
            },
        ])
        if room_w >= 5.2:
            actions_a.extend([
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-left-a',
                    'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                    'position': [-1.6, 0.44, -0.4],
                    'rotation_euler': [0.0, 0.7854, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': sofa_anchor_id_a,
                    'child_object_id': 'mock-chair-left-a',
                    'socket_id': 'sofa-left-accent',
                    'gap_meters': 0.35,
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-right-a',
                    'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                    'position': [1.6, 0.44, -0.4],
                    'rotation_euler': [0.0, -0.7854, 0.0],
                },
                {
                    'type': 'attach_to_socket',
                    'anchor_object_id': sofa_anchor_id_a,
                    'child_object_id': 'mock-chair-right-a',
                    'socket_id': 'sofa-right-accent',
                    'gap_meters': 0.35,
                },
            ])
        else:
            actions_a.extend([
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-left-a',
                    'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                    'position': [-1.15, 0.44, 0.15],
                    'rotation_euler': [0.0, 0.6, 0.0],
                },
                {
                    'type': 'add_furniture',
                    'object_id': 'mock-chair-right-a',
                    'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                    'position': [1.15, 0.44, 0.15],
                    'rotation_euler': [0.0, -0.6, 0.0],
                },
            ])
        actions_a.append({
            'type': 'propose_zone_arrangement',
            'zone_type': 'living',
            'intent': 'Conversational seating arrangement with sofa, coffee table, and angled armchairs',
            'requirements': {'preserve_existing_furniture': True},
        })
        cand_a = DesignProposalResult(
            text_response="Option A creates a social conversational circle around a central coffee table with angled armchairs.",
            proposed_actions=actions_a,
            provider='mock',
            model='deterministic-mock-v1',
            candidate_label="Option A: Conversational Seating Arrangement",
            description="A focused conversational arrangement with sofa, coffee table, and angled armchairs.",
            trade_offs=["Prioritizes social interaction", "Requires central floor area"],
        )

        # Candidate B: Open-Circulation Arrangement
        actions_b = []
        if not existing_sofa:
            actions_b.append({
                'type': 'add_furniture',
                'object_id': 'mock-sofa-b',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [0.0, 0.45, -1.3],
                'rotation_euler': [0.0, 0.0, 0.0],
            })
        actions_b.extend([
            {
                'type': 'add_furniture',
                'object_id': 'mock-table-b',
                'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                'position': [sofa_pos[0], 0.225, sofa_pos[2] + 0.9],
                'rotation_euler': [0.0, 0.0, 0.0],
            },
            {
                'type': 'attach_to_socket',
                'anchor_object_id': sofa_anchor_id_b,
                'child_object_id': 'mock-table-b',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            },
            {
                'type': 'add_furniture',
                'object_id': 'mock-chair-b',
                'asset_id': pick_asset_id('chair-accent-armchair', 'armchair-accent-nordic'),
                'position': [-1.4, 0.44, -0.4],
                'rotation_euler': [0.0, 0.5, 0.0],
            },
            {
                'type': 'propose_zone_arrangement',
                'zone_type': 'living',
                'intent': 'Open circulation living area maximizing floor space',
                'requirements': {'preserve_existing_furniture': True},
            },
        ])
        cand_b = DesignProposalResult(
            text_response="Option B shifts the seating against the perimeter wall to open wide, unhindered pathways across the room.",
            proposed_actions=actions_b,
            provider='mock',
            model='deterministic-mock-v1',
            candidate_label="Option B: Open-Circulation Layout",
            description="Positions seating along perimeter walls to maximize open walking paths.",
            trade_offs=["Maximizes open walking routes", "Less intimate conversational distance"],
        )

        # Candidate C: Media & Entertainment Arrangement
        actions_c = []
        if not existing_sofa:
            actions_c.append({
                'type': 'add_furniture',
                'object_id': 'mock-sofa-c',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [0.0, 0.45, 0.2],
                'rotation_euler': [0.0, 3.14159, 0.0],  # Facing north wall
            })
            c_table_pos = [0.0, 0.225, -0.6]
        else:
            c_table_pos = [sofa_pos[0], 0.225, sofa_pos[2] + 0.9]
        actions_c.extend([
            {
                'type': 'add_furniture',
                'object_id': 'mock-table-c',
                'asset_id': pick_asset_id('table-oak-coffee', 'coffee-table-minimal'),
                'position': c_table_pos,
                'rotation_euler': [0.0, 0.0, 0.0],
            },
            {
                'type': 'attach_to_socket',
                'anchor_object_id': sofa_anchor_id_c,
                'child_object_id': 'mock-table-c',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            },
            {
                'type': 'propose_zone_arrangement',
                'zone_type': 'living',
                'intent': 'Media entertainment living space oriented toward focal wall',
                'requirements': {'preserve_existing_furniture': True},
            },
        ])
        cand_c = DesignProposalResult(
            text_response="Option C centers the sofa facing the focal wall with clear sightlines for home entertainment.",
            proposed_actions=actions_c,
            provider='mock',
            model='deterministic-mock-v1',
            candidate_label="Option C: Media & Entertainment Setup",
            description="Oriented toward a focal media wall with unobstructed sightlines.",
            trade_offs=["Optimized for media viewing", "Asymmetric seating layout"],
        )

        all_living = [cand_a, cand_b, cand_c]
        return all_living[:candidate_count]

    def refine_candidate_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        failed_proposal: DesignProposalResult,
        validation_feedback: dict[str, Any],
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
        attempt: int = 1,
    ) -> DesignProposalResult:
        """
        Attempts to correct a candidate proposal that failed deterministic spatial validation.
        Simulates refinement deterministically offline.
        """
        prompt_lower = user_prompt.lower()
        room = current_scene.get('room', {'width': 5.0, 'length': 4.0, 'height': 2.8}) if isinstance(current_scene, dict) else {'width': 5.0, 'length': 4.0, 'height': 2.8}

        # Scenario 8: succeeds on attempt 1
        if 'succeed after refinement' in prompt_lower or 'refinement success' in prompt_lower:
            from apps.furniture.models import FurnitureAsset
            def pick_asset_id(canonical_id: str, fallback_id: str) -> str:
                if FurnitureAsset.objects.filter(id=canonical_id).exists():  # pyrefly: ignore[missing-attribute]
                    return canonical_id
                return fallback_id

            # Correct position from out-of-bounds to safe center-right coordinate
            corrected_actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-refine-sofa',
                'asset_id': pick_asset_id('sofa-modern-3seater', 'sofa-3seat-modern'),
                'position': [1.0, 0.45, 0.0],  # Valid coordinate inside 5x4m room
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return DesignProposalResult(
                text_response="Refined sofa placement by pulling it inward 1.8m away from room perimeter to ensure full room containment.",
                proposed_actions=corrected_actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Seating (Refined)",
                description="Position corrected to satisfy room containment.",
                trade_offs=["Inward offset for safety"],
            )

        # Scenario 9: remains invalid across all refinement attempts
        if 'remain invalid' in prompt_lower or 'refinement failure' in prompt_lower or 'boundary violation' in prompt_lower:
            # Shift slightly but stay out of bounds
            bad_actions = [{
                'type': 'add_furniture',
                'object_id': 'mock-persist-fail-sofa',
                'asset_id': 'sofa-modern-3seater',
                'position': [float(room.get('width', 5.0)) + 4.0, 0.45, float(room.get('length', 4.0)) + 4.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            }]
            return DesignProposalResult(
                text_response=f"Refinement attempt {attempt} failed: cannot fit item inside room boundary.",
                proposed_actions=bad_actions,
                provider='mock',
                model='deterministic-mock-v1',
                candidate_label="Option A: Unresolvable Placement",
                description=f"Attempt {attempt} remains out of bounds.",
                trade_offs=["Persistent boundary violation"],
            )

        # Generic safe refinement fallback:
        # If any action had an out-of-bounds position, clamp it towards room center
        refined_actions = []
        for act in failed_proposal.proposed_actions:
            cloned = dict(act)
            if cloned.get('type') == 'add_furniture' and 'position' in cloned:
                pos = list(cloned['position'])
                half_w = float(room.get('width', 5.0)) / 2.0 - 0.5
                half_l = float(room.get('length', 4.0)) / 2.0 - 0.5
                pos[0] = max(-half_w, min(half_w, pos[0]))
                pos[2] = max(-half_l, min(half_l, pos[2]))
                cloned['position'] = pos
            refined_actions.append(cloned)

        return DesignProposalResult(
            text_response=f"Adjusted furniture placement on refinement attempt {attempt} based on spatial feedback.",
            proposed_actions=refined_actions,
            provider='mock',
            model='deterministic-mock-v1',
            candidate_label=failed_proposal.candidate_label,
            description=failed_proposal.description,
            trade_offs=failed_proposal.trade_offs,
        )

