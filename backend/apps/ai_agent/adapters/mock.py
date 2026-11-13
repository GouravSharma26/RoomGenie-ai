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
