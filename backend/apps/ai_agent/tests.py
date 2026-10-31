import threading
import unittest
import uuid
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.db import connection
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APITransactionTestCase, APIClient
from unittest.mock import patch, MagicMock
from apps.ai_agent.models import AgentSession, AgentRun
from apps.ai_agent.adapters import get_design_llm_adapter, MockDesignLLMAdapter
from apps.ai_agent.tools import validate_and_simulate_actions, ALLOWED_ACTION_TYPES
from apps.designs.models import Design
from apps.furniture.models import FurnitureAsset

User = get_user_model()


class AgentAdapterAndToolsTests(APITestCase):
    def setUp(self):
        self.asset_armchair = FurnitureAsset.objects.create(
            id='armchair-accent-nordic',
            name='Lounge Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.88'),
            depth=Decimal('0.85'),
            price_paise=1199900,
            currency='INR'
        )
        self.asset_sofa = FurnitureAsset.objects.create(
            id='sofa-3seat-modern',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR'
        )

    def test_mock_adapter_produces_typed_proposals(self):
        adapter = MockDesignLLMAdapter()
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }

        # 1. Armchair prompt
        res = adapter.generate_design_proposal("Please add an armchair in the corner", scene)
        self.assertEqual(res.provider, 'mock')
        self.assertGreaterEqual(len(res.proposed_actions), 1)
        self.assertEqual(res.proposed_actions[0]['type'], 'add_furniture')
        self.assertEqual(res.proposed_actions[0]['asset_id'], 'armchair-accent-nordic')

        # 2. Clear room prompt
        res_clear = adapter.generate_design_proposal("Clean slate, clear everything", scene)
        self.assertEqual(res_clear.proposed_actions[0]['type'], 'clear_room')

    def test_tools_reject_arbitrary_or_unlisted_actions(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        malicious_actions = [
            {'type': 'execute_arbitrary_shell_command', 'cmd': 'rm -rf /'},
            {'type': 'run_sql_query', 'query': 'DROP TABLE users;'},
            {'type': 'fetch_unrestricted_http', 'url': 'http://evil.com'},
        ]
        result = validate_and_simulate_actions(scene, malicious_actions)
        self.assertFalse(result['is_valid'])
        self.assertEqual(len(result['errors']), 3)
        for err in result['errors']:
            self.assertIn("not an allowlisted operation", err)

    def test_tools_unknown_non_allowlisted_action_tier2_invalid(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        actions = [
            {'type': 'unknown_unsupported_operation', 'data': 123}
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertFalse(result['schema_valid'])
        self.assertTrue(result['reference_valid'])
        self.assertTrue(result['domain_valid'])
        self.assertTrue(result['budget_valid'])
        self.assertTrue(result['budget_diff']['room_containment_valid'])
        self.assertEqual(len(result['budget_diff']['room_violations']), 0)
        self.assertGreaterEqual(len(result['schema_errors']), 1)
        self.assertEqual(len(result['reference_errors']), 0)
        self.assertEqual(len(result['domain_errors']), 0)
        self.assertEqual(len(result['budget_errors']), 0)
        self.assertTrue(any("not an allowlisted operation" in err for err in result['schema_errors']))

    def test_tools_malformed_vector_or_parameter_type_tier2_invalid(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        # Malformed position vector: string instead of 3-element list
        actions_string_pos = [
            {'type': 'add_furniture', 'asset_id': 'armchair-accent-nordic', 'position': 'invalid-vector'}
        ]
        res1 = validate_and_simulate_actions(scene, actions_string_pos)
        self.assertFalse(res1['is_valid'])
        self.assertFalse(res1['schema_valid'])
        self.assertTrue(res1['budget_diff']['room_containment_valid'])
        self.assertEqual(len(res1['budget_diff']['room_violations']), 0)
        self.assertTrue(any("Invalid position vector" in err for err in res1['schema_errors']))

        # Malformed position vector: non-numeric element
        actions_non_numeric = [
            {'type': 'add_furniture', 'asset_id': 'armchair-accent-nordic', 'position': [1.0, 'two', 3.0]}
        ]
        res2 = validate_and_simulate_actions(scene, actions_non_numeric)
        self.assertFalse(res2['is_valid'])
        self.assertFalse(res2['schema_valid'])
        self.assertTrue(res2['budget_diff']['room_containment_valid'])
        self.assertEqual(len(res2['budget_diff']['room_violations']), 0)

        # Malformed scale vector: out of allowed bounds [0.1, 5.0]
        actions_bad_scale = [
            {'type': 'add_furniture', 'asset_id': 'armchair-accent-nordic', 'scale': [10.0, 1.0, 1.0]}
        ]
        res3 = validate_and_simulate_actions(scene, actions_bad_scale)
        self.assertFalse(res3['is_valid'])
        self.assertFalse(res3['schema_valid'])
        self.assertTrue(res3['budget_diff']['room_containment_valid'])

    def test_tools_missing_catalogue_asset_reference_resolution_failure_tier2_valid(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        actions = [
            {
                'type': 'add_furniture',
                'asset_id': 'totally-fake-nonexistent-asset-id',
                'position': [0.0, 0.44, 0.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        # Unexecutable proposal must be rejected (is_valid = False)
        self.assertFalse(result['is_valid'])
        # Syntactic schema validity conforms strictly to contract (Tier 2 valid)
        self.assertTrue(result['schema_valid'])
        self.assertEqual(len(result['schema_errors']), 0)
        # Semantic reference resolution failed
        self.assertFalse(result['reference_valid'])
        self.assertGreaterEqual(len(result['reference_errors']), 1)
        self.assertIn("does not exist in catalogue or is inactive", result['reference_errors'][0])
        # Domain room containment is completely valid (no boundary attempt triggered)
        self.assertTrue(result['domain_valid'])
        self.assertTrue(result['budget_diff']['room_containment_valid'])
        self.assertEqual(len(result['budget_diff']['room_violations']), 0)
        self.assertEqual(len(result['domain_errors']), 0)
        self.assertEqual(len(result['budget_errors']), 0)

    def test_tools_nonexistent_scene_object_reference_resolution_failure_tier2_valid(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        actions = [
            {
                'type': 'move_object',
                'object_id': 'nonexistent-obj-123',
                'position': [1.0, 0.5, 1.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        # Unexecutable proposal rejected
        self.assertFalse(result['is_valid'])
        # Correctly typed parameters under tool contract (Tier 2 valid)
        self.assertTrue(result['schema_valid'])
        self.assertEqual(len(result['schema_errors']), 0)
        # Reference resolution failed
        self.assertFalse(result['reference_valid'])
        self.assertGreaterEqual(len(result['reference_errors']), 1)
        self.assertIn("not found in scene", result['reference_errors'][0])
        # Domain containment and boundary metrics must not be affected
        self.assertTrue(result['domain_valid'])
        self.assertTrue(result['budget_diff']['room_containment_valid'])
        self.assertEqual(len(result['budget_diff']['room_violations']), 0)
        self.assertEqual(len(result['domain_errors']), 0)
        self.assertEqual(len(result['budget_errors']), 0)

    def test_tools_valid_schema_with_room_containment_violation_tier2_valid_tier3_invalid(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        # Place armchair far outside room boundaries (e.g. X = 10.0m in a 5.0m wide room)
        actions = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [10.0, 0.44, 0.0],
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        # Tool call adhered to allowlisted schema/parameters (Tier 2 valid)
        self.assertTrue(result['schema_valid'])
        self.assertEqual(len(result['schema_errors']), 0)
        # Catalogue reference resolved
        self.assertTrue(result['reference_valid'])
        self.assertEqual(len(result['reference_errors']), 0)
        # But room containment was violated (Tier 3 invalid)
        self.assertFalse(result['domain_valid'])
        self.assertFalse(result['budget_diff']['room_containment_valid'])
        self.assertGreaterEqual(len(result['budget_diff']['room_violations']), 1)
        self.assertGreaterEqual(len(result['domain_errors']), 1)
        self.assertTrue(any("violates 3D room containment" in err for err in result['domain_errors']))

    def test_tools_valid_schema_and_containment_with_budget_only_failure(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        # Add armchair costing ₹11,999 (1,199,900 paise) with budget ceiling of ₹5,000 (500,000 paise)
        actions = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [0.0, 0.44, 0.0],
            }
        ]
        result = validate_and_simulate_actions(scene, actions, max_budget_paise=500000)
        # Budget violation marks proposal invalid
        self.assertFalse(result['is_valid'])
        # Tool call adhered to allowlisted schema/parameters (Tier 2 valid)
        self.assertTrue(result['schema_valid'])
        self.assertEqual(len(result['schema_errors']), 0)
        # Reference resolved
        self.assertTrue(result['reference_valid'])
        self.assertEqual(len(result['reference_errors']), 0)
        # Room containment is valid (Tier 3 valid)
        self.assertTrue(result['domain_valid'])
        self.assertTrue(result['budget_diff']['room_containment_valid'])
        self.assertEqual(len(result['budget_diff']['room_violations']), 0)
        # Budget is invalid
        self.assertFalse(result['budget_valid'])
        self.assertFalse(result['budget_diff']['is_budget_compliant'])
        self.assertGreaterEqual(len(result['budget_errors']), 1)
        self.assertTrue(any("exceeds budget limit" in err for err in result['budget_errors']))

    def test_tools_fully_valid_proposal_tier2_valid_tier3_valid(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        actions = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [0.0, 0.44, 0.0],
            }
        ]
        result = validate_and_simulate_actions(scene, actions, max_budget_paise=5000000)
        # Fully valid proposal
        self.assertTrue(result['is_valid'])
        self.assertTrue(result['schema_valid'])
        self.assertTrue(result['reference_valid'])
        self.assertTrue(result['domain_valid'])
        self.assertTrue(result['budget_valid'])
        self.assertTrue(result['budget_diff']['room_containment_valid'])
        self.assertEqual(len(result['errors']), 0)
        self.assertEqual(len(result['schema_errors']), 0)
        self.assertEqual(len(result['reference_errors']), 0)
        self.assertEqual(len(result['domain_errors']), 0)
        self.assertEqual(len(result['budget_errors']), 0)

    def test_tools_calculate_deterministic_integer_paise_budget_diff(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-3seat-modern',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.425, 0.0],
                }
            ],
        }
        # Add an armchair (₹11,999 / 1,199,900 paise)
        actions = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [-1.2, 0.44, 0.5],
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertTrue(result['is_valid'])
        diff = result['budget_diff']

        # Before: 2,999,900 paise (₹29,999.00)
        self.assertEqual(diff['before_total_paise'], 2999900)
        # After: 2,999,900 + 1,199,900 = 4,199,800 paise (₹41,998.00)
        self.assertEqual(diff['after_total_paise'], 4199800)
        self.assertEqual(diff['diff_paise'], 1199900)
        self.assertEqual(diff['diff_inr'], '+11999.00')
        self.assertEqual(diff['before_items_count'], 1)
        self.assertEqual(diff['after_items_count'], 2)
        self.assertTrue(diff['room_containment_valid'])


class AgentApiSecurityAndApprovalTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(
            email='alice@roomgenie.local',
            username='alice@roomgenie.local',
            password='Password123!'
        )
        self.user_b = User.objects.create_user(
            email='bob@roomgenie.local',
            username='bob@roomgenie.local',
            password='Password123!'
        )
        self.asset_armchair = FurnitureAsset.objects.create(
            id='armchair-accent-nordic',
            name='Lounge Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.88'),
            depth=Decimal('0.85'),
            price_paise=1199900,
            currency='INR'
        )
        self.asset_sofa = FurnitureAsset.objects.create(
            id='sofa-3seat-modern',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR'
        )
        self.design_a = Design.objects.create(
            owner=self.user_a,
            title='Alice Living Room',
            scene_json={
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [],
            }
        )
        self.session_a = AgentSession.objects.create(
            owner=self.user_a,
            design=self.design_a,
            title='Alice AI Chat'
        )

    def test_anonymous_user_cannot_access_agent_sessions_401(self):
        url = reverse('agent-session-list')
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_strict_ownership_isolation_on_agent_sessions(self):
        self.client.force_authenticate(user=self.user_b)
        url = reverse('agent-session-detail', kwargs={'pk': str(self.session_a.id)})
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_cross_user_cannot_attach_another_users_design_to_session(self):
        self.client.force_authenticate(user=self.user_b)
        url = reverse('agent-session-list')
        payload = {
            'title': 'Bob Malicious Session',
            'design': str(self.design_a.id),
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        # Verify no session was created for user_b with Alice's design
        self.assertFalse(
            AgentSession.objects.filter(owner=self.user_b, design=self.design_a).exists()
        )
        # Verify Alice's design remains unchanged
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)

    def test_prompt_endpoint_proposes_actions_without_mutating_design(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})

        res = self.client.post(prompt_url, {'prompt': 'Add an armchair for reading'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['requires_approval'])
        self.assertTrue(res.data['schema_valid'])
        self.assertTrue(res.data['run']['validation_results']['schema_valid'])

        run_id = res.data['run']['id']
        run = AgentRun.objects.get(id=run_id)
        self.assertEqual(run.status, AgentRun.STATUS_PROPOSED)
        self.assertGreaterEqual(len(run.proposed_actions), 1)

        # CRITICAL VERIFICATION: Design scene_json in database was NOT modified!
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)

    def test_user_can_approve_and_apply_proposed_run(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        prompt_res = self.client.post(prompt_url, {'prompt': 'Add an armchair'}, format='json')
        run_id = prompt_res.data['run']['id']

        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_200_OK)

        # Run status is approved
        run = AgentRun.objects.get(id=run_id)
        self.assertEqual(run.status, AgentRun.STATUS_APPROVED)

        # Design scene now contains the approved armchair!
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 1)
        self.assertEqual(self.design_a.scene_json['objects'][0]['assetId'], 'armchair-accent-nordic')

    def test_apply_ignores_client_scene_override_and_uses_saved_design(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        prompt_res = self.client.post(prompt_url, {'prompt': 'Add an armchair'}, format='json')
        self.assertEqual(prompt_res.status_code, status.HTTP_200_OK)
        run_id = prompt_res.data['run']['id']

        # User A calls apply but attempts to supply an untrusted client scene with an injected object
        injected_object = {
            'id': 'injected-hacked-item',
            'assetId': 'sofa-3seat-modern',
            'name': 'Injected Sofa',
            'dimensions': [2.1, 0.85, 0.9],
            'position': [0.0, 0.425, 0.0],
            'rotationEuler': [0.0, 0.0, 0.0],
            'scale': [1.0, 1.0, 1.0],
        }
        malicious_client_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [injected_object],
        }

        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {'scene_json': malicious_client_scene}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_200_OK)

        # Authoritative saved design was used: it contains only the approved armchair, NOT the injected sofa!
        self.design_a.refresh_from_db()
        objects = self.design_a.scene_json['objects']
        self.assertEqual(len(objects), 1)
        self.assertEqual(objects[0]['assetId'], 'armchair-accent-nordic')
        self.assertFalse(any(o.get('id') == 'injected-hacked-item' for o in objects))

    def test_apply_rejects_stale_proposal_when_design_was_modified(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        prompt_res = self.client.post(prompt_url, {'prompt': 'Add an armchair'}, format='json')
        self.assertEqual(prompt_res.status_code, status.HTTP_200_OK)
        run_id = prompt_res.data['run']['id']

        # Simulate a concurrent modification to Alice's design before approval
        self.design_a.scene_json['objects'].append({
            'id': 'concurrent-manual-item',
            'assetId': 'armchair-accent-nordic',
            'name': 'Manual Item',
            'dimensions': [0.85, 0.88, 0.85],
            'position': [0.0, 0.44, 0.0],
            'rotationEuler': [0.0, 0.0, 0.0],
            'scale': [1.0, 1.0, 1.0],
        })
        self.design_a.save(update_fields=['scene_json', 'updated_at'])

        # User A tries to apply the now-stale proposal
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(apply_res.data.get('code'), 'stale_proposal')
        self.assertTrue(apply_res.data.get('stale'))

        # Alice's concurrent design modification remains intact and was not overwritten
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 1)
        self.assertEqual(self.design_a.scene_json['objects'][0]['id'], 'concurrent-manual-item')

    def test_cross_user_cannot_apply_another_users_proposal(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        prompt_res = self.client.post(prompt_url, {'prompt': 'Add an armchair'}, format='json')
        run_id = prompt_res.data['run']['id']

        # User B attempts to approve User A's run
        self.client.force_authenticate(user=self.user_b)
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_404_NOT_FOUND)

        # Alice's design remains unchanged
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)

    def test_room_containment_violation_blocks_approval(self):
        self.client.force_authenticate(user=self.user_a)
        # Create an AgentRun whose proposed actions violate room boundaries
        out_of_bounds_action = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [12.0, 0.44, 12.0],  # Out of 5.0x4.0m room boundaries
            }
        ]
        run = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Place chair in the yard",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Placed chair",
            proposed_actions=out_of_bounds_action,
            validation_results={'is_valid': False, 'errors': ['Out of bounds']},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        apply_url = reverse('agent-run-apply', kwargs={'run_id': str(run.id)})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Cannot apply invalid actions.", apply_res.data['detail'])

        # Verify Alice's design scene was NOT modified
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)
        # Verify run was not marked approved
        run.refresh_from_db()
        self.assertEqual(run.status, AgentRun.STATUS_PROPOSED)

    def test_apply_rejects_candidate_violating_canonical_scene_validation(self):
        self.client.force_authenticate(user=self.user_a)
        # Action produces invalid scale below canonical minimum
        invalid_action = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'scale': [0.01, 0.01, 0.01],
            }
        ]
        run = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Make it microscopic",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Scaled down",
            proposed_actions=invalid_action,
            validation_results={'is_valid': False, 'errors': ['Scale too small']},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        apply_url = reverse('agent-run-apply', kwargs={'run_id': str(run.id)})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)

    def test_prompt_endpoint_persists_and_returns_structured_validity_categories(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        res = self.client.post(prompt_url, {'prompt': 'Add an armchair'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # Verify returned flags
        self.assertTrue(res.data['schema_valid'])
        self.assertTrue(res.data['reference_valid'])
        self.assertTrue(res.data['domain_valid'])
        self.assertTrue(res.data['budget_valid'])

        # Verify persisted fields in AgentRun.validation_results
        run_id = res.data['run']['id']
        run = AgentRun.objects.get(id=run_id)
        vr = run.validation_results
        self.assertIn('schema_valid', vr)
        self.assertIn('reference_valid', vr)
        self.assertIn('domain_valid', vr)
        self.assertIn('budget_valid', vr)
        self.assertIn('schema_errors', vr)
        self.assertIn('reference_errors', vr)
        self.assertIn('domain_errors', vr)
        self.assertIn('budget_errors', vr)
        self.assertTrue(vr['schema_valid'])
        self.assertTrue(vr['reference_valid'])
        self.assertTrue(vr['domain_valid'])
        self.assertTrue(vr['budget_valid'])

    def test_reference_resolution_failure_blocks_approval(self):
        self.client.force_authenticate(user=self.user_a)
        # Action references missing catalogue asset
        missing_asset_action = [
            {
                'type': 'add_furniture',
                'asset_id': 'totally-nonexistent-asset-uuid',
                'position': [0.0, 0.44, 0.0],
            }
        ]
        run = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Add missing furniture",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Adding missing furniture",
            proposed_actions=missing_asset_action,
            validation_results={'is_valid': False, 'errors': ['Asset not in catalogue']},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        apply_url = reverse('agent-run-apply', kwargs={'run_id': str(run.id)})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Cannot apply invalid actions.", apply_res.data['detail'])

        # Verify Alice's design scene was NOT modified
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)
        run.refresh_from_db()
        self.assertEqual(run.status, AgentRun.STATUS_PROPOSED)

    def test_budget_exceedance_blocks_approval(self):
        self.client.force_authenticate(user=self.user_a)
        # Set a strict budget of ₹50.00 (5000 paise) on Alice's design
        self.design_a.budget = 5000
        self.design_a.save(update_fields=['budget'])

        # Armchair costs ₹11,999 (1,199,900 paise)
        expensive_action = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-accent-nordic',
                'position': [0.0, 0.44, 0.0],
            }
        ]
        run = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Add expensive armchair",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Adding armchair",
            proposed_actions=expensive_action,
            validation_results={'is_valid': False, 'errors': ['Cost exceeds budget']},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        apply_url = reverse('agent-run-apply', kwargs={'run_id': str(run.id)})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Cannot apply invalid actions.", apply_res.data['detail'])

        # Verify Alice's design scene was NOT modified
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)

    def test_user_can_reject_proposed_run(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        prompt_res = self.client.post(prompt_url, {'prompt': 'Add an armchair'}, format='json')
        run_id = prompt_res.data['run']['id']

        reject_url = reverse('agent-run-reject', kwargs={'run_id': run_id})
        reject_res = self.client.post(reject_url, {}, format='json')
        self.assertEqual(reject_res.status_code, status.HTTP_200_OK)

        run = AgentRun.objects.get(id=run_id)
        self.assertEqual(run.status, AgentRun.STATUS_REJECTED)

        # Design remains unchanged
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 0)


@unittest.skipIf(connection.vendor != 'postgresql', "Concurrency testing requires PostgreSQL row-level locks")
class AgentConcurrencyAndAtomicApplyTests(APITransactionTestCase):
    """
    Concurrency and data-integrity tests verifying atomic row-level locking (select_for_update)
    and race condition prevention during apply operations.
    """
    def setUp(self):
        self.user_a = User.objects.create_user(
            email='alice_atomic@roomgenie.local',
            username='alice_atomic@roomgenie.local',
            password='Password123!'
        )
        self.asset_armchair = FurnitureAsset.objects.create(
            id='armchair-atomic-1',
            name='Atomic Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.88'),
            depth=Decimal('0.85'),
            price_paise=1199900,
            currency='INR'
        )
        self.asset_sofa = FurnitureAsset.objects.create(
            id='sofa-atomic-2',
            name='Atomic 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR'
        )
        self.initial_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        self.design_a = Design.objects.create(
            owner=self.user_a,
            title='Alice Concurrency Room',
            scene_json=self.initial_scene
        )
        self.session_a = AgentSession.objects.create(
            owner=self.user_a,
            design=self.design_a,
            title='Alice Concurrency AI Session'
        )

    def test_concurrent_competing_apply_requests_are_atomic(self):
        """
        Two simultaneous apply requests for the same proposed run cannot both succeed.
        select_for_update() row locking ensures one request acquires the lock,
        applies the changes, and transitions status to APPROVED. The competing request
        wakes up, detects status != PROPOSED, and is rejected with HTTP 400 Bad Request.
        """
        proposed_actions = [
            {
                'type': 'add_furniture',
                'asset_id': 'armchair-atomic-1',
                'position': [0.0, 0.44, 0.0],
            }
        ]
        run = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Add armchair",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Adding armchair",
            proposed_actions=proposed_actions,
            validation_results={'is_valid': True, 'errors': [], 'warnings': []},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        apply_url = reverse('agent-run-apply', kwargs={'run_id': str(run.id)})

        client1 = APIClient()
        client1.force_authenticate(user=self.user_a)

        client2 = APIClient()
        client2.force_authenticate(user=self.user_a)

        responses = []

        def worker(client):
            try:
                res = client.post(apply_url, {}, format='json')
                responses.append(res)
            finally:
                from django.db import connections
                connections.close_all()

        t1 = threading.Thread(target=worker, args=(client1,))
        t2 = threading.Thread(target=worker, args=(client2,))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(len(responses), 2)
        status_codes = sorted([r.status_code for r in responses])

        # Exactly one request succeeded (200), the competing request was rejected (400)
        self.assertEqual(status_codes, [status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST])

        # The run in DB is approved
        run.refresh_from_db()
        self.assertEqual(run.status, AgentRun.STATUS_APPROVED)

        # The design contains exactly 1 armchair (no double-application)
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 1)
        self.assertEqual(self.design_a.scene_json['objects'][0]['assetId'], 'armchair-atomic-1')

    def test_concurrent_competing_proposals_on_same_design_lock_and_detect_stale(self):
        """
        If two runs are proposed against the same initial design snapshot,
        applying run 1 updates the design scene. When run 2 acquires the lock on the Design row,
        it rechecks the base snapshot against the locked design and rejects with 409 Conflict.
        """
        run1 = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Add armchair",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Adding armchair",
            proposed_actions=[{
                'type': 'add_furniture',
                'asset_id': 'armchair-atomic-1',
                'position': [-1.0, 0.44, 0.0],
            }],
            validation_results={'is_valid': True, 'errors': [], 'warnings': []},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        run2 = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Add sofa",
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text="Adding sofa",
            proposed_actions=[{
                'type': 'add_furniture',
                'asset_id': 'sofa-atomic-2',
                'position': [1.0, 0.425, 0.0],
            }],
            validation_results={'is_valid': True, 'errors': [], 'warnings': []},
            provider_metadata={'provider': 'mock', 'model': 'mock'},
            base_scene_snapshot=self.design_a.scene_json,
        )

        client1 = APIClient()
        client1.force_authenticate(user=self.user_a)

        client2 = APIClient()
        client2.force_authenticate(user=self.user_a)

        apply_url_1 = reverse('agent-run-apply', kwargs={'run_id': str(run1.id)})
        apply_url_2 = reverse('agent-run-apply', kwargs={'run_id': str(run2.id)})

        responses = []

        def worker(client, url):
            try:
                res = client.post(url, {}, format='json')
                responses.append(res)
            finally:
                from django.db import connections
                connections.close_all()

        t1 = threading.Thread(target=worker, args=(client1, apply_url_1))
        t2 = threading.Thread(target=worker, args=(client2, apply_url_2))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(len(responses), 2)
        status_codes = sorted([r.status_code for r in responses])

        # Exactly one proposal succeeded (200), the competing stale proposal was rejected (409)
        self.assertEqual(status_codes, [status.HTTP_200_OK, status.HTTP_409_CONFLICT])

        # Design is valid and only has the winning proposal's item (not corrupted)
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json['objects']), 1)


class GeminiAdapterSecurityAndFallbackTests(unittest.TestCase):
    """
    Tests ensuring Gemini API integration enforces secure header authentication,
    candidate model fallback resiliency, and absolute redaction of credentials in logs and metadata.
    """

    def test_sanitize_sensitive_text(self):
        from apps.ai_agent.adapters.gemini import sanitize_sensitive_text

        secret = "AIzaSySecretApiKey12345"

        # 1. Direct secret in error
        err1 = f"Failed to connect using key {secret}: connection reset"
        clean1 = sanitize_sensitive_text(err1, secret)
        self.assertNotIn(secret, clean1)
        self.assertIn("[REDACTED]", clean1)

        # 2. Secret in URL query param
        err2 = f"GET https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={secret} HTTP/1.1"
        clean2 = sanitize_sensitive_text(err2, secret)
        self.assertNotIn(secret, clean2)
        self.assertIn("?key=[REDACTED]", clean2)

        # 3. Header string formatting
        err3 = f"Headers: {{'x-goog-api-key': '{secret}'}}"
        clean3 = sanitize_sensitive_text(err3, secret)
        self.assertNotIn(secret, clean3)
        self.assertIn("[REDACTED]", clean3)

    @patch('urllib.request.urlopen')
    def test_gemini_adapter_header_authentication_and_clean_endpoint(self, mock_urlopen):
        import json
        from apps.ai_agent.adapters.gemini import GeminiDesignLLMAdapter

        fake_api_key = "AIzaSyTestHeaderAuthKey999"
        adapter = GeminiDesignLLMAdapter()
        adapter.api_key = fake_api_key
        adapter.model_name = "gemini-3.8-flash"
        adapter.fallback_models = []

        fake_gemini_resp = {
            'candidates': [{
                'content': {
                    'parts': [{
                        'functionCall': {
                            'name': 'add_furniture',
                            'args': {
                                'asset_id': 'armchair-accent-nordic',
                                'position': [1.0, 0.44, -1.0],
                            }
                        }
                    }]
                }
            }]
        }

        mock_context = MagicMock()
        mock_context.__enter__.return_value.read.return_value = json.dumps(fake_gemini_resp).encode('utf-8')
        mock_urlopen.return_value = mock_context

        scene = {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []}
        result = adapter.generate_design_proposal("Add an armchair", scene)

        # Verify request url and headers
        self.assertEqual(mock_urlopen.call_count, 1)
        req = mock_urlopen.call_args[0][0]

        # URL MUST NOT contain '?key=' or any query parameter with the key
        self.assertNotIn("?key=", req.full_url)
        self.assertNotIn(fake_api_key, req.full_url)
        self.assertEqual(
            req.full_url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
        )

        # Header MUST contain x-goog-api-key
        header_val = req.get_header('X-goog-api-key')
        self.assertEqual(header_val, fake_api_key)

        # Result checks
        self.assertEqual(result.provider, 'gemini')
        self.assertEqual(result.model, 'gemini-3.8-flash')
        self.assertEqual(len(result.proposed_actions), 1)
        self.assertEqual(result.proposed_actions[0]['type'], 'add_furniture')

    @patch('urllib.request.urlopen')
    def test_gemini_adapter_model_fallback_on_503(self, mock_urlopen):
        import json
        import urllib.error
        from apps.ai_agent.adapters.gemini import GeminiDesignLLMAdapter

        adapter = GeminiDesignLLMAdapter()
        adapter.api_key = "AIzaSyFallbackKey777"
        adapter.model_name = "gemini-3.8-flash"
        adapter.fallback_models = ["gemini-3-flash-preview"]

        # Call 1: HTTP 503 on gemini-3.8-flash
        # Call 2: 200 OK on gemini-3-flash-preview
        fake_gemini_resp = {
            'candidates': [{
                'content': {
                    'parts': [{'text': 'Here is a recommended layout.'}]
                }
            }]
        }

        mock_context_success = MagicMock()
        mock_context_success.__enter__.return_value.read.return_value = json.dumps(fake_gemini_resp).encode('utf-8')

        http_503_error = urllib.error.HTTPError(
            url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
            code=503,
            msg="Service Unavailable",
            hdrs={},
            fp=None
        )

        mock_urlopen.side_effect = [http_503_error, mock_context_success]

        scene = {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []}
        result = adapter.generate_design_proposal("Suggest a layout", scene)

        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertEqual(result.provider, 'gemini')
        self.assertEqual(result.model, 'gemini-3-flash-preview')
        self.assertTrue(result.raw_metadata.get('fallback_triggered'))
        self.assertIn('previous_model_errors', result.raw_metadata)

    @patch('urllib.request.urlopen')
    def test_gemini_adapter_all_models_fail_redacts_credentials(self, mock_urlopen):
        import urllib.error
        from apps.ai_agent.adapters.gemini import GeminiDesignLLMAdapter

        fake_api_key = "AIzaSySecretLeakProofKey444"
        adapter = GeminiDesignLLMAdapter()
        adapter.api_key = fake_api_key
        adapter.model_name = "gemini-3.8-flash"
        adapter.fallback_models = ["gemini-3-flash-preview"]

        # Simulate exception containing the raw key
        leak_error = urllib.error.URLError(f"Connection failed for key={fake_api_key}")
        mock_urlopen.side_effect = [leak_error, leak_error]

        scene = {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []}
        result = adapter.generate_design_proposal("Furnish room", scene)

        # Fallback to mock adapter
        self.assertEqual(result.provider, 'mock')
        fallback_reason = result.raw_metadata.get('fallback_reason', '')
        self.assertNotIn(fake_api_key, fallback_reason)
        self.assertIn("[REDACTED]", fallback_reason)

    def test_gemini_adapter_no_key_delegates_to_mock(self):
        from apps.ai_agent.adapters.gemini import GeminiDesignLLMAdapter

        adapter = GeminiDesignLLMAdapter()
        adapter.api_key = ""
        scene = {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []}
        result = adapter.generate_design_proposal("Hello", scene)
        self.assertEqual(result.provider, 'mock')
        self.assertEqual(result.raw_metadata.get('fallback_reason'), 'no_gemini_api_key')
