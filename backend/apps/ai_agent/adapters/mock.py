import time
from typing import Any
from apps.ai_agent.adapters.base import BaseDesignLLMAdapter, DesignProposalResult


class MockDesignLLMAdapter(BaseDesignLLMAdapter):
    """
    Deterministic offline mock adapter for local development, CI/CD, and automated tests.
    Recognizes common architectural and interior design requests and produces structured,
    typed proposals without making external network calls or requiring API keys.
    """

    def generate_design_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
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

        # 1. Clear / Empty room
        if any(w in prompt_lower for w in ['clear', 'empty room', 'remove all', 'start over', 'clean slate']):
            text = (
                "I have prepared a proposal to clear the room so you can start with a fresh layout. "
                "Please review the proposal and approve when ready."
            )
            actions.append({
                'type': 'clear_room',
                'confirm': True,
            })

        # 2. Add Armchair / Chair
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

        # 3. Add Bed / Bedroom setup
        elif any(w in prompt_lower for w in ['bed', 'bedroom', 'sleeping', 'queen']):
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

        # 4. Add Coffee Table / Table
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

        # 5. Add Plant / Decor
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

        # 6. Add Desk / Study
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

        # 7. Add Bookshelf / Storage
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

        # 8. Color / Material Update
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

        # 9. Rearrange / Move
        elif any(w in prompt_lower for w in ['move', 'rearrange', 'shift', 'layout', 'reposition']):
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

        # 10. Default Scandinavian / Cozy recommendation
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
