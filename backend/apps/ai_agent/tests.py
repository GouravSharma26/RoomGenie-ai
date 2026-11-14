import copy
import math
import random
import threading
import unittest
import uuid
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
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

    def test_spatial_context_parsing_and_prompt_formatting(self):
        from apps.ai_agent.spatial_context import parse_spatial_context, format_spatial_context_for_prompt

        raw_context = {
            'schemaVersion': 1,
            'room': {
                'dimensions': [6.0, 2.8, 5.0],
                'areaSqm': 30.0,
                'footprint': [[-3.0, 2.5], [3.0, 2.5], [3.0, -2.5], [-3.0, -2.5]],
                'isParametric': True,
                'walls': [
                    {'id': 'wall-south', 'cardinalOrientation': 'south', 'lengthMeters': 6.0},
                    {'id': 'wall-north', 'cardinalOrientation': 'north', 'lengthMeters': 6.0},
                ],
                'openings': [
                    {
                        'id': 'door-main',
                        'type': 'door',
                        'center': [0.0, 2.5],
                        'widthMeters': 0.9,
                        'isPedestrianPortal': True,
                    }
                ]
            },
            'placedObjects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-3seat-modern',
                    'name': 'Modern 3-Seater Sofa',
                    'category': 'seating',
                    'position': [0.0, 0.425, 0.5],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [2.1, 0.85, 0.9],
                    'isAnchor': True,
                }
            ],
            'availableSockets': [
                {
                    'anchorObjectId': 'sofa-1',
                    'anchorName': 'Modern 3-Seater Sofa',
                    'socketId': 'sofa-front-table',
                    'socketType': 'coffee-table',
                    'worldPosition': [0.0, 0.0, 1.2],
                    'allowedCategories': ['tables'],
                }
            ],
            'walkability': {
                'walkabilityScore': 85,
                'isRoomPassable': True,
                'unblockedEntranceCount': 1,
                'blockedDoorIds': [],
            },
            'usableSpace': {
                'freeAreaRatio': 0.88,
            }
        }

        parsed = parse_spatial_context(raw_context)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed['schema_version'], 1)
        self.assertEqual(parsed['room']['area_sqm'], 30.0)
        self.assertEqual(len(parsed['available_sockets']), 1)

        formatted_prompt = format_spatial_context_for_prompt(parsed)
        self.assertIn("Authoritative Spatial Context (v1)", formatted_prompt)
        self.assertIn("6.0m (X width) × 2.8m (Y height) × 5.0m (Z length)", formatted_prompt)
        self.assertIn("door 'door-main' at [0.0, 2.5] width 0.9m [PEDESTRIAN ENTRANCE]", formatted_prompt)
        self.assertIn("Modern 3-Seater Sofa", formatted_prompt)
        self.assertIn("Socket 'sofa-front-table' on 'Modern 3-Seater Sofa'", formatted_prompt)
        self.assertIn("Walkability Analysis: Score 85/100", formatted_prompt)
        self.assertIn("Remaining Free Floor Space: 88% available", formatted_prompt)


class Phase62SocketAndZoneTests(APITestCase):
    """
    Automated test suite for Phase 6.2: Semantic Socket Attachment & Functional Zone Arrangements.
    Tests authoritative socket registry, relative transform calculation, physical validation
    (OBB SAT collisions, polygon room boundaries, doorway landing protection), cycle detection,
    zone arrangement preservation, and mock adapter scenarios.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='phase62user', password='Password123!')
        self.client.force_authenticate(user=self.user)

        self.sofa = FurnitureAsset.objects.create(
            id='sofa-modern-3seater',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            style_tags=['modern', 'minimalist', 'living-room'],
            currency='INR'
        )
        self.coffee_table = FurnitureAsset.objects.create(
            id='table-oak-coffee',
            name='Minimalist Coffee Table',
            category='tables',
            width=Decimal('1.10'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=1499900,
            style_tags=['scandinavian', 'wood', 'living-room'],
            currency='INR'
        )
        self.armchair = FurnitureAsset.objects.create(
            id='chair-accent-armchair',
            name='Lounge Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.88'),
            depth=Decimal('0.85'),
            price_paise=1199900,
            style_tags=['accent', 'living-room', 'reading'],
            currency='INR'
        )
        self.bed = FurnitureAsset.objects.create(
            id='bed-queen-platform',
            name='Nordic Queen Platform Bed',
            category='beds',
            width=Decimal('1.60'),
            height=Decimal('0.95'),
            depth=Decimal('2.10'),
            price_paise=3499900,
            style_tags=['scandinavian', 'minimalist', 'bedroom'],
            currency='INR'
        )
        self.nightstand = FurnitureAsset.objects.create(
            id='table-bedside-nightstand',
            name='Bedside Nightstand',
            category='tables',
            width=Decimal('0.50'),
            height=Decimal('0.50'),
            depth=Decimal('0.40'),
            price_paise=699900,
            style_tags=['scandinavian', 'minimalist', 'bedroom'],
            currency='INR'
        )
        self.desk = FurnitureAsset.objects.create(
            id='desk-workspace-study',
            name='Ergonomic Study Desk',
            category='tables',
            width=Decimal('1.40'),
            height=Decimal('0.75'),
            depth=Decimal('0.70'),
            price_paise=1899900,
            style_tags=['industrial', 'workspace', 'home-office'],
            currency='INR'
        )
        self.bookshelf = FurnitureAsset.objects.create(
            id='storage-bookshelf-tall',
            name='4-Tier Bookshelf',
            category='storage',
            width=Decimal('0.90'),
            height=Decimal('1.80'),
            depth=Decimal('0.35'),
            price_paise=1599900,
            style_tags=['modern', 'walnut', 'storage'],
            currency='INR'
        )

    def test_canonical_socket_definitions_registered(self):
        from apps.ai_agent.sockets import CANONICAL_SOCKET_DEFINITIONS, get_socket_definition
        self.assertEqual(len(CANONICAL_SOCKET_DEFINITIONS), 6)
        sofa_front = get_socket_definition('sofa-modern-3seater', 'sofa-front-table')
        self.assertIsNotNone(sofa_front)
        self.assertEqual(sofa_front['surface_normal'], [0.0, 0.0, 1.0])
        self.assertEqual(sofa_front['recommended_gap'], 0.45)
        self.assertEqual(sofa_front['min_gap'], 0.30)
        self.assertEqual(sofa_front['max_gap'], 0.70)

        bed_left = get_socket_definition('bed-queen-platform', 'bed-left-nightstand')
        self.assertIsNotNone(bed_left)
        self.assertEqual(bed_left['surface_normal'], [-1.0, 0.0, 0.0])
        self.assertEqual(bed_left['recommended_gap'], 0.08)

    def test_socket_compatibility_validation(self):
        from apps.ai_agent.sockets import get_socket_definition, is_compatible_with_socket
        socket_def = get_socket_definition('sofa-modern-3seater', 'sofa-front-table')
        self.assertIsNotNone(socket_def)

        # Compatible table
        is_ok, reason = is_compatible_with_socket(socket_def, 'tables', ['living-room'])
        self.assertTrue(is_ok)
        self.assertEqual(reason, "")

        # Incompatible category: bed on table socket
        is_ok_bed, reason_bed = is_compatible_with_socket(socket_def, 'beds', ['bedroom'])
        self.assertFalse(is_ok_bed)
        self.assertIn("Category 'beds' is not allowed", reason_bed)

    def test_compute_child_transform_relative_accuracy(self):
        from apps.ai_agent.sockets import get_socket_definition, compute_child_transform_from_socket
        socket_def = get_socket_definition('sofa-modern-3seater', 'sofa-front-table')
        self.assertIsNotNone(socket_def)

        anchor_pos = [0.0, 0.425, 0.0]
        anchor_yaw = 0.0
        anchor_dims = [2.10, 0.85, 0.90]
        anchor_scale = [1.0, 1.0, 1.0]

        child_dims = [1.10, 0.45, 0.60]
        child_scale = [1.0, 1.0, 1.0]

        # Gap = 0.45m
        transform = compute_child_transform_from_socket(
            anchor_pos, anchor_yaw, anchor_dims, anchor_scale,
            child_dims, child_scale, socket_def, desired_gap=0.45
        )

        # Anchor front is +Z. Half depth of anchor = 0.45m.
        # Gap = 0.45m.
        # Half depth of child = 0.30m.
        # Expected child Z = 0.0 + 0.45 + 0.45 + 0.30 = 1.20m.
        self.assertAlmostEqual(transform['position'][0], 0.0, places=3)
        self.assertAlmostEqual(transform['position'][1], 0.225, places=3)  # grounded height 0.45 / 2
        self.assertAlmostEqual(transform['position'][2], 1.20, places=2)
        self.assertEqual(transform['gap'], 0.45)

    def test_attach_to_socket_successful_simulation(self):
        scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.425, -0.5],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                },
                {
                    'id': 'table-1',
                    'assetId': 'table-oak-coffee',
                    'name': 'Minimalist Coffee Table',
                    'dimensions': [1.1, 0.45, 0.6],
                    'position': [0.0, 0.225, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                }
            ],
            'relationships': [],
        }

        actions = [
            {
                'type': 'attach_to_socket',
                'anchor_object_id': 'sofa-1',
                'child_object_id': 'table-1',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            }
        ]

        result = validate_and_simulate_actions(scene, actions)
        self.assertTrue(result['is_valid'])
        self.assertTrue(result['domain_valid'])
        self.assertEqual(len(result['errors']), 0)

        rels = result['candidate_scene']['relationships']
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]['anchorObjectId'], 'sofa-1')
        self.assertEqual(rels[0]['childObjectId'], 'table-1')
        self.assertEqual(rels[0]['socketId'], 'sofa-front-table')
        self.assertEqual(rels[0]['gap'], 0.45)

        # Check updated child position
        updated_child = next(o for o in result['candidate_scene']['objects'] if o['id'] == 'table-1')
        self.assertAlmostEqual(updated_child['position'][2], -0.5 + 0.45 + 0.45 + 0.30, places=2)

    def test_attach_to_socket_incompatible_category_rejected(self):
        scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.425, 0.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'bed-1',
                    'assetId': 'bed-queen-platform',
                    'name': 'Queen Bed',
                    'dimensions': [1.6, 0.95, 2.1],
                    'position': [0.0, 0.475, 1.5],
                    'rotationEuler': [0.0, 0.0, 0.0],
                }
            ]
        }
        actions = [
            {
                'type': 'attach_to_socket',
                'anchor_object_id': 'sofa-1',
                'child_object_id': 'bed-1',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertFalse(result['domain_valid'])
        self.assertTrue(any("not allowed" in err for err in result['domain_errors']))

    def test_attach_to_socket_occupied_rejected(self):
        scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {'id': 'sofa-1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0, 0.425, 0], 'rotationEuler': [0, 0, 0]},
                {'id': 'table-1', 'assetId': 'table-oak-coffee', 'name': 'Table 1', 'dimensions': [1.1, 0.45, 0.6], 'position': [0, 0.225, 1], 'rotationEuler': [0, 0, 0]},
                {'id': 'table-2', 'assetId': 'table-oak-coffee', 'name': 'Table 2', 'dimensions': [1.1, 0.45, 0.6], 'position': [0, 0.225, 2], 'rotationEuler': [0, 0, 0]},
            ],
            'relationships': [
                {
                    'id': 'rel-1',
                    'anchorObjectId': 'sofa-1',
                    'childObjectId': 'table-1',
                    'socketId': 'sofa-front-table',
                    'gap': 0.45,
                    'relativeYaw': 0.0
                }
            ]
        }
        # Attempt to attach table-2 to already occupied front table socket
        actions = [
            {
                'type': 'attach_to_socket',
                'anchor_object_id': 'sofa-1',
                'child_object_id': 'table-2',
                'socket_id': 'sofa-front-table',
                'gap_meters': 0.45,
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertTrue(any("already occupied" in err for err in result['domain_errors']))

    def test_attach_to_socket_cycle_detection(self):
        scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {'id': 'obj-a', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0, 0.425, 0], 'rotationEuler': [0, 0, 0]},
                {'id': 'obj-b', 'assetId': 'table-oak-coffee', 'name': 'Table', 'dimensions': [1.1, 0.45, 0.6], 'position': [0, 0.225, 1], 'rotationEuler': [0, 0, 0]},
            ],
            'relationships': [
                {'id': 'rel-1', 'anchorObjectId': 'obj-a', 'childObjectId': 'obj-b', 'socketId': 'sofa-front-table', 'gap': 0.45}
            ]
        }
        # Attempt to make obj-a a child of obj-b (cycle)
        actions = [
            {
                'type': 'attach_to_socket',
                'anchor_object_id': 'obj-b',
                'child_object_id': 'obj-a',
                'socket_id': 'sofa-front-table',
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertTrue(any("Cycle detected" in err or "not registered" in err for err in result['domain_errors']))

    def test_attach_to_socket_gap_limits(self):
        scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {'id': 'sofa-1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0, 0.425, 0], 'rotationEuler': [0, 0, 0]},
                {'id': 'table-1', 'assetId': 'table-oak-coffee', 'name': 'Table', 'dimensions': [1.1, 0.45, 0.6], 'position': [0, 0.225, 1], 'rotationEuler': [0, 0, 0]},
            ]
        }
        # Below min_gap (0.30m)
        actions_low = [
            {'type': 'attach_to_socket', 'anchor_object_id': 'sofa-1', 'child_object_id': 'table-1', 'socket_id': 'sofa-front-table', 'gap_meters': 0.15}
        ]
        res_low = validate_and_simulate_actions(scene, actions_low)
        self.assertFalse(res_low['is_valid'])
        self.assertTrue(any("outside permitted range" in err for err in res_low['domain_errors']))

        # Above max_gap (0.70m)
        actions_high = [
            {'type': 'attach_to_socket', 'anchor_object_id': 'sofa-1', 'child_object_id': 'table-1', 'socket_id': 'sofa-front-table', 'gap_meters': 0.95}
        ]
        res_high = validate_and_simulate_actions(scene, actions_high)
        self.assertFalse(res_high['is_valid'])
        self.assertTrue(any("outside permitted range" in err for err in res_high['domain_errors']))

    def test_attach_to_socket_room_boundary_breach(self):
        # Small room 3.0m x 3.0m
        scene = {
            'room': {'width': 3.0, 'length': 3.0, 'height': 2.8},
            'objects': [
                # Sofa placed near +Z boundary (Z = 1.0). Half length = 1.5m limit.
                {'id': 'sofa-1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0.0, 0.425, 1.0], 'rotationEuler': [0, 0, 0]},
                {'id': 'table-1', 'assetId': 'table-oak-coffee', 'name': 'Table', 'dimensions': [1.1, 0.45, 0.6], 'position': [0, 0.225, 0], 'rotationEuler': [0, 0, 0]},
            ]
        }
        # Attaching coffee table to front (+Z) pushes table to Z = 1.0 + 0.45 + 0.45 + 0.30 = 2.20m > 1.5m limit!
        actions = [
            {'type': 'attach_to_socket', 'anchor_object_id': 'sofa-1', 'child_object_id': 'table-1', 'socket_id': 'sofa-front-table', 'gap_meters': 0.45}
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertFalse(result['domain_valid'])
        self.assertTrue(any("violates room boundary" in err for err in result['domain_errors']))

    def test_attach_to_socket_obb_collision_with_other_furniture(self):
        scene = {
            'room': {'width': 6.0, 'length': 6.0, 'height': 2.8},
            'objects': [
                {'id': 'sofa-1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0.0, 0.425, 0.0], 'rotationEuler': [0, 0, 0]},
                {'id': 'table-1', 'assetId': 'table-oak-coffee', 'name': 'Table', 'dimensions': [1.1, 0.45, 0.6], 'position': [0.0, 0.225, 0.0], 'rotationEuler': [0, 0, 0]},
                # Pre-existing bookshelf directly in front where coffee table will attach (Z = 1.20)
                {'id': 'shelf-blocking', 'assetId': 'storage-bookshelf-tall', 'name': 'Bookshelf', 'dimensions': [0.9, 1.8, 0.35], 'position': [0.0, 0.9, 1.20], 'rotationEuler': [0, 0, 0]},
            ]
        }
        actions = [
            {'type': 'attach_to_socket', 'anchor_object_id': 'sofa-1', 'child_object_id': 'table-1', 'socket_id': 'sofa-front-table', 'gap_meters': 0.45}
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertFalse(result['domain_valid'])
        self.assertTrue(any("physically collides" in err for err in result['domain_errors']))

    def test_attach_to_socket_doorway_landing_obstruction(self):
        scene = {
            'room': {
                'width': 6.0,
                'length': 6.0,
                'height': 2.8,
                'walls': [
                    {'id': 'wall-front', 'startPoint': [-3.0, 3.0], 'endPoint': [3.0, 3.0]},
                ],
                'openings': [
                    {'id': 'door-main', 'wallId': 'wall-front', 'type': 'door', 'distanceAlongWall': 2.55, 'width': 0.9, 'height': 2.1}
                ]
            },
            'objects': [
                # Sofa positioned facing door landing
                {'id': 'sofa-1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0.0, 0.425, 1.3], 'rotationEuler': [0, 0, 0]},
                {'id': 'table-1', 'assetId': 'table-oak-coffee', 'name': 'Table', 'dimensions': [1.1, 0.45, 0.6], 'position': [0.0, 0.225, 0.0], 'rotationEuler': [0, 0, 0]},
            ]
        }
        actions = [
            {'type': 'attach_to_socket', 'anchor_object_id': 'sofa-1', 'child_object_id': 'table-1', 'socket_id': 'sofa-front-table', 'gap_meters': 0.45}
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertFalse(result['domain_valid'])
        self.assertTrue(any("blocks door circulation" in err for err in result['domain_errors']))

    def test_propose_zone_arrangement_preservation_violation(self):
        scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {'id': 'sofa-1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0, 0.425, 0], 'rotationEuler': [0, 0, 0]}
            ]
        }
        # Propose zone with preserve_existing_furniture: True, but also including clear_room
        actions = [
            {
                'type': 'propose_zone_arrangement',
                'zone_type': 'living',
                'intent': 'Rearrange living area',
                'requirements': {'preserve_existing_furniture': True}
            },
            {
                'type': 'clear_room',
                'confirm': True
            }
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertFalse(result['domain_valid'])
        self.assertTrue(any("Preservation violation" in err for err in result['domain_errors']))

    def test_mock_adapter_conversational_living_scenario(self):
        adapter = MockDesignLLMAdapter()
        scene = {'room': {'width': 6.0, 'length': 5.0, 'height': 2.8}, 'objects': []}

        proposal = adapter.generate_design_proposal("Create a conversational living area with a sofa, coffee table, and two accent chairs", scene)
        self.assertEqual(proposal.provider, 'mock')
        self.assertGreaterEqual(len(proposal.proposed_actions), 7)

        # Validate that the mock proposal passes the deterministic spatial validator cleanly
        sim_res = validate_and_simulate_actions(scene, proposal.proposed_actions)
        self.assertTrue(sim_res['is_valid'])
        self.assertTrue(sim_res['schema_valid'])
        self.assertTrue(sim_res['reference_valid'])
        self.assertTrue(sim_res['domain_valid'])
        self.assertEqual(len(sim_res['errors']), 0)

        # 3 relationships established (front coffee table + left accent armchair + right accent armchair)
        rels = sim_res['candidate_scene'].get('relationships', [])
        self.assertEqual(len(rels), 3)

        # Functional living zone established
        zones = sim_res['candidate_scene'].get('zones', [])
        self.assertEqual(len(zones), 1)
        self.assertEqual(zones[0]['type'], 'living')

    def test_mock_adapter_functional_sleeping_scenario(self):
        adapter = MockDesignLLMAdapter()
        scene = {'room': {'width': 6.0, 'length': 5.0, 'height': 2.8}, 'objects': []}

        proposal = adapter.generate_design_proposal("Arrange a functional sleeping zone with bed and nightstands", scene)
        self.assertEqual(proposal.provider, 'mock')

        sim_res = validate_and_simulate_actions(scene, proposal.proposed_actions)
        self.assertTrue(sim_res['is_valid'])
        self.assertTrue(sim_res['domain_valid'])

        rels = sim_res['candidate_scene'].get('relationships', [])
        self.assertEqual(len(rels), 2)  # left nightstand + right nightstand

        zones = sim_res['candidate_scene'].get('zones', [])
        self.assertEqual(len(zones), 1)
        self.assertEqual(zones[0]['type'], 'sleeping')

    def test_mock_adapter_workspace_arrangement_scenario(self):
        adapter = MockDesignLLMAdapter()
        scene = {'room': {'width': 6.0, 'length': 5.0, 'height': 2.8}, 'objects': []}

        proposal = adapter.generate_design_proposal("Design an ergonomic workspace arrangement with desk, chair, and storage", scene)
        self.assertEqual(proposal.provider, 'mock')

        sim_res = validate_and_simulate_actions(scene, proposal.proposed_actions)
        self.assertTrue(sim_res['is_valid'])
        self.assertTrue(sim_res['domain_valid'])

        rels = sim_res['candidate_scene'].get('relationships', [])
        self.assertEqual(len(rels), 1)  # study chair attached to desk knee well
        self.assertEqual(rels[0]['socketId'], 'desk-knee-well-chair')

        zones = sim_res['candidate_scene'].get('zones', [])
        self.assertEqual(len(zones), 1)
        self.assertEqual(zones[0]['type'], 'workspace')

    def test_gemini_tool_definitions_expose_socket_and_zone_actions(self):
        from apps.ai_agent.tools import get_available_tool_definitions
        tools = get_available_tool_definitions()
        tool_names = [t['name'] for t in tools]
        self.assertIn('attach_to_socket', tool_names)
        self.assertIn('propose_zone_arrangement', tool_names)

        # Check attach_to_socket parameters
        attach_tool = next(t for t in tools if t['name'] == 'attach_to_socket')
        props = attach_tool['parameters']['properties']
        self.assertIn('child_object_id', props)
        self.assertIn('anchor_object_id', props)
        self.assertIn('socket_id', props)
        self.assertIn('gap_meters', props)
        self.assertIn('relative_yaw', props)
        self.assertEqual(attach_tool['parameters']['required'], ['child_object_id', 'anchor_object_id', 'socket_id'])

        # Check propose_zone_arrangement parameters
        zone_tool = next(t for t in tools if t['name'] == 'propose_zone_arrangement')
        zone_props = zone_tool['parameters']['properties']
        self.assertIn('zone_type', zone_props)
        self.assertIn('intent', zone_props)
        self.assertIn('requirements', zone_props)
        self.assertEqual(zone_tool['parameters']['required'], ['zone_type', 'intent'])


class Phase63MultiCandidateAndScoringTests(APITestCase):

    """
    Phase 6.3 Test Suite: Multi-Candidate Layout Generation & Deterministic Scoring.
    Validates:
    1. Candidate count limits (default 3, max 5, min 1).
    2. Meaningful layout differentiation (living and workspace).
    3. Independent simulation & scene snapshot immutability.
    4. Canonical scene non-mutation before explicit approval.
    5. Action ordering and socket object ID chaining.
    6. Hard constraint failures: boundary, OBB collision, doorway obstruction.
    7. Budget cap violation.
    8. Advisory warnings: validity preserved, soft score penalized.
    9. 6-component score formula, normalization, and weights.
    10. Missing budget neutral scoring.
    11. Deterministic scoring and tie-breaking.
    12. Bounded refinement (success on 1, stop after 2 on permanent failure).
    13. SHA-256 scene hash determinism and 409 stale proposal rejection.
    14. Candidate selection in apply endpoint.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            email='designer@roomgenie.local',
            username='designer@roomgenie.local',
            password='Password123!'
        )
        # Create standard catalogue assets
        self.sofa = FurnitureAsset.objects.create(
            id='sofa-modern-3seater',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR',
            is_active=True,
        )
        self.table = FurnitureAsset.objects.create(
            id='table-oak-coffee',
            name='Oak Coffee Table',
            category='tables',
            width=Decimal('1.10'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=899900,
            currency='INR',
            is_active=True,
        )
        self.armchair = FurnitureAsset.objects.create(
            id='chair-accent-armchair',
            name='Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.85'),
            depth=Decimal('0.85'),
            price_paise=1299900,
            currency='INR',
            is_active=True,
        )
        self.desk = FurnitureAsset.objects.create(
            id='desk-workspace-study',
            name='Executive Wood Desk',
            category='tables',
            width=Decimal('1.50'),
            height=Decimal('0.75'),
            depth=Decimal('0.80'),
            price_paise=2499900,
            currency='INR',
            is_active=True,
        )

        self.chair = FurnitureAsset.objects.create(
            id='chair-ergonomic-office',
            name='Ergonomic Office Chair',
            category='seating',
            width=Decimal('0.65'),
            height=Decimal('0.95'),
            depth=Decimal('0.65'),
            price_paise=1499900,
            currency='INR',
            is_active=True,
        )
        self.bookshelf = FurnitureAsset.objects.create(
            id='storage-bookshelf-tall',
            name='Tall Bookshelf',
            category='storage',
            width=Decimal('0.80'),
            height=Decimal('1.80'),
            depth=Decimal('0.35'),
            price_paise=999900,
            currency='INR',
            is_active=True,
        )
        self.bed = FurnitureAsset.objects.create(
            id='bed-queen-platform',
            name='Platform Queen Bed',
            category='beds',
            width=Decimal('1.65'),
            height=Decimal('0.95'),
            depth=Decimal('2.15'),
            price_paise=3999900,
            currency='INR',
            is_active=True,
        )

        self.initial_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
            'relationships': [],
            'zones': [],
        }
        self.design = Design.objects.create(
            owner=self.user,
            title='Test Design Project',
            scene_json=copy.deepcopy(self.initial_scene),
            budget=10000000,  # ₹100,000 budget
        )
        self.session = AgentSession.objects.create(
            owner=self.user,
            design=self.design,
            title='Multi-Candidate Design Session'
        )

    def test_candidate_generator_count_and_maximum_limit(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        # Default count: 3
        candidates = generator.generate_candidates(
            user_prompt="Arrange a living room layout",
            current_scene=self.initial_scene,
            candidate_count=3,
        )
        self.assertEqual(len(candidates), 3)

        # Clamped to maximum 5 when requesting 10
        candidates_max = generator.generate_candidates(
            user_prompt="Arrange a living room layout",
            current_scene=self.initial_scene,
            candidate_count=10,
        )
        self.assertLessEqual(len(candidates_max), 5)

        # Clamped to minimum 1 when requesting 0
        candidates_min = generator.generate_candidates(
            user_prompt="Arrange a living room layout",
            current_scene=self.initial_scene,
            candidate_count=0,
        )
        self.assertEqual(len(candidates_min), 1)

    def test_meaningful_candidate_differentiation_living_and_workspace(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        # Living room candidates
        living_cands = generator.generate_candidates(
            user_prompt="Design a living room area",
            current_scene=self.initial_scene,
            candidate_count=3,
        )
        self.assertEqual(len(living_cands), 3)
        labels = [c.label for c in living_cands]
        self.assertTrue(any('Conversational' in l for l in labels))
        self.assertTrue(any('Circulation' in l for l in labels))
        self.assertTrue(any('Media' in l for l in labels))
        # Ensure actions are genuinely different
        self.assertNotEqual(living_cands[0].proposed_actions, living_cands[1].proposed_actions)

        # Workspace candidates
        ws_cands = generator.generate_candidates(
            user_prompt="Set up a workspace and office desk",
            current_scene=self.initial_scene,
            candidate_count=3,
        )
        self.assertEqual(len(ws_cands), 3)
        ws_labels = [c.label for c in ws_cands]
        self.assertTrue(any('Daylight' in l for l in ws_labels))
        self.assertTrue(any('Circulation' in l for l in ws_labels))
        self.assertTrue(any('Storage' in l for l in ws_labels))

    def test_independent_simulation_from_same_immutable_starting_scene(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        from apps.ai_agent.candidate_types import compute_canonical_scene_hash
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        scene_copy = copy.deepcopy(self.initial_scene)
        starting_hash = compute_canonical_scene_hash(scene_copy)

        candidates = generator.generate_candidates(
            user_prompt="Arrange a living room",
            current_scene=scene_copy,
            candidate_count=3,
        )
        # Verify initial starting scene was NOT modified
        self.assertEqual(compute_canonical_scene_hash(scene_copy), starting_hash)
        self.assertEqual(len(scene_copy['objects']), 0)

        # Each candidate has its own independent simulation
        for c in candidates:
            self.assertEqual(c.source_scene_hash, starting_hash)
            self.assertGreaterEqual(len(c.candidate_scene['objects']), 1)

    def test_no_mutation_of_canonical_scene_during_generation(self):
        self.client.force_authenticate(user=self.user)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session.id)})

        res = self.client.post(prompt_url, {'prompt': 'Suggest living room layouts', 'candidate_count': 3}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Verify design in DB was untouched
        self.design.refresh_from_db()
        self.assertEqual(len(self.design.scene_json['objects']), 0)


        # Verify returned data contains candidates
        self.assertIn('candidates', res.data)
        self.assertEqual(len(res.data['candidates']), 3)

    def test_action_ordering_and_socket_object_id_chaining(self):
        from apps.ai_agent.candidate_simulator import CandidateSimulator
        actions = [
            {
                'type': 'add_furniture',
                'object_id': 'my-custom-desk-001',
                'asset_id': 'desk-workspace-study',
                'position': [0.0, 0.375, -1.0],
                'rotation_euler': [0.0, 0.0, 0.0],

            },
            {
                'type': 'add_furniture',
                'object_id': 'my-custom-chair-002',
                'asset_id': 'chair-ergonomic-office',
                'position': [0.0, 0.45, -1.0],
                'rotation_euler': [0.0, 0.0, 0.0],
            },
            {
                'type': 'attach_to_socket',
                'anchor_object_id': 'my-custom-desk-001',
                'child_object_id': 'my-custom-chair-002',
                'socket_id': 'desk-knee-well-chair',
                'gap_meters': 0.15,
            },
        ]
        simulator = CandidateSimulator(self.initial_scene)
        sim_res = simulator.simulate(actions)
        self.assertTrue(sim_res['is_valid'])
        rels = sim_res['candidate_scene'].get('relationships', [])
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]['anchorObjectId'], 'my-custom-desk-001')
        self.assertEqual(rels[0]['childObjectId'], 'my-custom-chair-002')

    def test_hard_boundary_failure_handling(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        candidates = generator.generate_candidates(
            user_prompt="Testing boundary violation candidate",
            current_scene=self.initial_scene,
            candidate_count=1,
        )
        cand = candidates[0]
        self.assertFalse(cand.is_valid)
        self.assertFalse(cand.is_approval_eligible)
        self.assertEqual(cand.score.boundary, 0.0)
        fatal_codes = [i.code for i in cand.validation_feedback.fatal_errors]
        self.assertIn('ROOM_BOUNDARY_BREACH', fatal_codes)

    def test_obb_collision_failure_handling(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        candidates = generator.generate_candidates(
            user_prompt="Testing collision candidate overlapping",
            current_scene=self.initial_scene,
            candidate_count=1,
        )
        cand = candidates[0]
        self.assertFalse(cand.is_valid)
        self.assertFalse(cand.is_approval_eligible)
        self.assertEqual(cand.score.collision, 0.0)
        fatal_codes = [i.code for i in cand.validation_feedback.fatal_errors]
        self.assertIn('OBB_COLLISION', fatal_codes)

    def test_hard_clearance_doorway_landing_obstruction(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        candidates = generator.generate_candidates(
            user_prompt="Testing clearance violation door blocked",
            current_scene=self.initial_scene,
            candidate_count=1,
        )
        cand = candidates[0]
        self.assertFalse(cand.is_valid)
        self.assertFalse(cand.is_approval_eligible)
        self.assertEqual(cand.score.circulation, 0.0)
        fatal_codes = [i.code for i in cand.validation_feedback.fatal_errors]
        self.assertIn('DOOR_BLOCKED', fatal_codes)

    def test_budget_cap_violation(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        # Set strict low budget: ₹20,000 (2,000,000 paise)
        candidates = generator.generate_candidates(
            user_prompt="Testing budget violation expensive candidate",
            current_scene=self.initial_scene,
            candidate_count=1,
            max_budget_paise=2000000,
        )
        cand = candidates[0]
        self.assertFalse(cand.is_valid)
        self.assertFalse(cand.is_approval_eligible)
        self.assertEqual(cand.score.budget, 0.0)
        fatal_codes = [i.code for i in cand.validation_feedback.fatal_errors]
        self.assertIn('BUDGET_EXCEEDED', fatal_codes)

    def test_advisory_warnings_preserve_validity_and_lower_soft_score(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        candidates = generator.generate_candidates(
            user_prompt="Testing advisory spacing warning",
            current_scene=self.initial_scene,
            candidate_count=1,
        )
        cand = candidates[0]
        # Must remain valid despite advisory warning!
        self.assertTrue(cand.is_valid)
        self.assertTrue(cand.is_approval_eligible)
        # Soft clearance score reflects the advisory
        self.assertLessEqual(cand.score.boundary, 100.0)

    def test_score_formula_and_weights_normalization(self):
        from apps.ai_agent.candidate_scorer import CandidateScorer
        from apps.ai_agent.candidate_types import CandidateValidationFeedback

        feedback = CandidateValidationFeedback(is_valid=True)
        budget_diff = {'after_total_paise': 2000000, 'max_budget_paise': 5000000}
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [{
                'id': 'item-1',
                'dimensions': [1.0, 1.0, 1.0],
                'scale': [1.0, 1.0, 1.0],
                'position': [0.0, 0.5, 0.0],
            }],
        }
        score = CandidateScorer.calculate_score(scene, feedback, budget_diff)

        # Check normalization
        self.assertGreaterEqual(score.boundary, 0.0)
        self.assertLessEqual(score.boundary, 100.0)
        self.assertGreaterEqual(score.collision, 0.0)
        self.assertLessEqual(score.collision, 100.0)
        self.assertGreaterEqual(score.circulation, 0.0)
        self.assertLessEqual(score.circulation, 100.0)
        self.assertGreaterEqual(score.clearance, 0.0)
        self.assertLessEqual(score.clearance, 100.0)
        self.assertGreaterEqual(score.utilization, 0.0)
        self.assertLessEqual(score.utilization, 100.0)
        self.assertGreaterEqual(score.budget, 0.0)
        self.assertLessEqual(score.budget, 100.0)

        # Exact formula verification:
        expected = (
            0.25 * score.boundary
            + 0.25 * score.collision
            + 0.20 * score.circulation
            + 0.15 * score.clearance
            + 0.10 * score.utilization
            + 0.05 * score.budget
        )
        self.assertAlmostEqual(score.overall, expected, places=1)

    def test_missing_budget_neutral_treatment(self):
        from apps.ai_agent.candidate_scorer import CandidateScorer
        from apps.ai_agent.candidate_types import CandidateValidationFeedback

        feedback = CandidateValidationFeedback(is_valid=True)
        # No max budget defined
        budget_diff = {'after_total_paise': 3000000}
        scene = {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []}

        score = CandidateScorer.calculate_score(scene, feedback, budget_diff)
        self.assertFalse(score.budget_evaluated)
        self.assertEqual(score.budget, 100.0)
        self.assertIn("neutral", score.explanations['budget'].lower())

    def test_deterministic_scoring_for_identical_inputs(self):
        from apps.ai_agent.candidate_scorer import CandidateScorer
        from apps.ai_agent.candidate_types import CandidateValidationFeedback

        feedback = CandidateValidationFeedback(is_valid=True)
        budget_diff = {'after_total_paise': 2000000, 'max_budget_paise': 5000000}
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [{
                'id': 'item-1',
                'dimensions': [1.0, 1.0, 1.0],
                'scale': [1.0, 1.0, 1.0],
                'position': [0.0, 0.5, 0.0],
            }],
        }
        score1 = CandidateScorer.calculate_score(scene, feedback, budget_diff)
        score2 = CandidateScorer.calculate_score(scene, feedback, budget_diff)
        self.assertEqual(score1.overall, score2.overall)
        self.assertEqual(score1.to_dict(), score2.to_dict())

    def test_deterministic_ranking_and_tie_breaking(self):
        from apps.ai_agent.candidate_ranker import CandidateRanker
        from apps.ai_agent.candidate_types import LayoutCandidate, ScoreBreakdown

        cand_invalid = LayoutCandidate(
            id='cand-inv',
            label='Invalid Option',
            description='',
            reasoning_summary='',
            proposed_actions=[],
            candidate_scene={},
            source_scene_hash='abc',
            is_valid=False,
            score=ScoreBreakdown(overall=99.0),
        )
        cand_valid_low = LayoutCandidate(
            id='cand-val-low',
            label='Valid Low Option',
            description='',
            reasoning_summary='',
            proposed_actions=[],
            candidate_scene={},
            source_scene_hash='abc',
            is_valid=True,
            score=ScoreBreakdown(overall=75.0),
        )
        cand_valid_high = LayoutCandidate(
            id='cand-val-high',
            label='Valid High Option',
            description='',
            reasoning_summary='',
            proposed_actions=[],
            candidate_scene={},
            source_scene_hash='abc',
            is_valid=True,
            score=ScoreBreakdown(overall=92.0),
        )

        ranked = CandidateRanker.rank_candidates([cand_invalid, cand_valid_low, cand_valid_high])
        # Valid high ranks first, then valid low, then invalid
        self.assertEqual(ranked[0].id, 'cand-val-high')
        self.assertEqual(ranked[1].id, 'cand-val-low')
        self.assertEqual(ranked[2].id, 'cand-inv')

    def test_bounded_refinement_success_after_one_attempt(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        candidates = generator.generate_candidates(
            user_prompt="Testing succeed after refinement scenario",
            current_scene=self.initial_scene,
            candidate_count=1,
        )
        self.assertEqual(len(candidates), 1)
        cand = candidates[0]
        # Successfully recovered on attempt 1!
        self.assertEqual(cand.refinement_attempts, 1)
        self.assertTrue(cand.is_valid)
        self.assertTrue(cand.is_approval_eligible)

    def test_bounded_refinement_failure_after_two_attempts(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        generator = CandidateGenerator(adapter=MockDesignLLMAdapter())

        candidates = generator.generate_candidates(
            user_prompt="Testing remain invalid after refinement",
            current_scene=self.initial_scene,
            candidate_count=1,
        )
        self.assertEqual(len(candidates), 1)
        cand = candidates[0]
        # Stopped at max 2 refinement attempts and remained invalid
        self.assertEqual(cand.refinement_attempts, 2)
        self.assertFalse(cand.is_valid)
        self.assertFalse(cand.is_approval_eligible)

    def test_stale_proposal_409_rejection(self):
        self.client.force_authenticate(user=self.user)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session.id)})

        prompt_res = self.client.post(prompt_url, {'prompt': 'Suggest living room layouts', 'candidate_count': 3}, format='json')
        self.assertEqual(prompt_res.status_code, status.HTTP_200_OK)
        run_id = prompt_res.data['run']['id']

        # Concurrently modify the saved design
        self.design.scene_json['objects'].append({
            'id': 'concurrent-item-1',
            'assetId': 'table-oak-coffee',
            'name': 'Concurrent Table',
            'position': [0.0, 0.225, 0.0],
            'rotationEuler': [0.0, 0.0, 0.0],
            'scale': [1.0, 1.0, 1.0],
            'dimensions': [1.1, 0.45, 0.6],
        })
        self.design.save(update_fields=['scene_json'])

        # Attempt to apply the now-stale proposal
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(apply_res.data.get('code'), 'stale_proposal')
        self.assertTrue(apply_res.data.get('stale'))

    def test_scene_hash_determinism(self):
        from apps.ai_agent.candidate_types import compute_canonical_scene_hash
        scene_a = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {'id': 'item-1', 'assetId': 'a1', 'name': 'Item 1', 'position': [1.0, 0.5, 0.0]},
                {'id': 'item-2', 'assetId': 'a2', 'name': 'Item 2', 'position': [-1.0, 0.5, 0.0]},
            ],
        }
        # Inverted object array order and extra transient UI properties
        scene_b = {
            'unit': 'm',
            'schemaVersion': 1,
            'transient_ui_selected': 'item-1',
            'room': {'length': 4.0, 'height': 2.8, 'width': 5.0},
            'objects': [
                {'name': 'Item 2', 'id': 'item-2', 'position': [-1.0, 0.5, 0.0], 'assetId': 'a2'},
                {'id': 'item-1', 'position': [1.0, 0.5, 0.0], 'assetId': 'a1', 'name': 'Item 1'},
            ],
        }
        # Both canonical representations should produce the EXACT same SHA-256 hash
        self.assertEqual(compute_canonical_scene_hash(scene_a), compute_canonical_scene_hash(scene_b))

        # Modifying coordinates must produce a different hash
        scene_c = copy.deepcopy(scene_a)
        scene_c['objects'][0]['position'][0] = 1.05
        self.assertNotEqual(compute_canonical_scene_hash(scene_a), compute_canonical_scene_hash(scene_c))

    def test_apply_specific_candidate_by_id(self):
        self.client.force_authenticate(user=self.user)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session.id)})

        prompt_res = self.client.post(prompt_url, {'prompt': 'Design workspace office desk', 'candidate_count': 3}, format='json')
        self.assertEqual(prompt_res.status_code, status.HTTP_200_OK)
        run_id = prompt_res.data['run']['id']
        candidates = prompt_res.data['candidates']
        self.assertGreaterEqual(len(candidates), 2)

        # Apply candidate 2 (Option B) specifically
        cand_2 = candidates[1]
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {'candidate_id': cand_2['id']}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_200_OK)

        self.design.refresh_from_db()
        # Design should now have candidate 2 applied
        self.assertGreater(len(self.design.scene_json['objects']), 0)


class Phase64PreviewAndReversibleApplyBackendTests(APITestCase):
    """
    Automated Backend Tests for Phase 6.4: Interactive 3D Preview & Reversible Apply.
    Verifies:
    1. Candidate-specific atomic apply with row locks.
    2. Rejection of duplicate apply calls (run status != proposed).
    3. Rejection of unknown candidate ID.
    4. Rejection of ineligible or invalid candidate.
    5. Rejection on cross-user or unowned design access.
    6. Stale proposal protection when authoritative database scene has changed.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='preview_tester',
            email='preview@example.com',
            password='Password123!'
        )
        self.other_user = User.objects.create_user(
            username='other_tester',
            email='other@example.com',
            password='Password123!'
        )
        self.client.force_authenticate(user=self.user)

        # Standard catalogue assets
        FurnitureAsset.objects.create(
            id='sofa-modern-3seater',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='table-oak-coffee',
            name='Oak Coffee Table',
            category='tables',
            width=Decimal('1.10'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=899900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='chair-accent-armchair',
            name='Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.85'),
            depth=Decimal('0.85'),
            price_paise=1299900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='desk-workspace-study',
            name='Executive Wood Desk',
            category='tables',
            width=Decimal('1.50'),
            height=Decimal('0.75'),
            depth=Decimal('0.80'),
            price_paise=2499900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='chair-ergonomic-office',
            name='Ergonomic Office Chair',
            category='seating',
            width=Decimal('0.65'),
            height=Decimal('0.95'),
            depth=Decimal('0.65'),
            price_paise=1499900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='sofa-3seat-modern',
            name='Modern 3-Seat Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=3500000,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='coffee-table-minimal',
            name='Minimal Coffee Table',
            category='tables',
            width=Decimal('1.10'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=1200000,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='armchair-accent-nordic',
            name='Nordic Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.85'),
            depth=Decimal('0.85'),
            price_paise=1500000,
            currency='INR',
            is_active=True,
        )

        self.scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
            'relationships': [],
        }

        self.design = Design.objects.create(
            owner=self.user,
            title='Preview Test Room',
            scene_json=copy.deepcopy(self.scene),
        )

        self.session = AgentSession.objects.create(
            owner=self.user,
            design=self.design,
            title='Preview AI Session',
        )

    def test_apply_rejects_duplicate_call_when_already_approved(self):
        # 1. Generate prompt proposal
        url = reverse('agent-prompt', kwargs={'session_id': self.session.id})
        res = self.client.post(url, {'prompt': 'Living room alternatives', 'candidate_count': 3}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        run_id = res.data['run']['id']
        cand_id = res.data['candidates'][0]['id']

        # 2. First apply succeeds
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res_1 = self.client.post(apply_url, {'candidate_id': cand_id}, format='json')
        self.assertEqual(apply_res_1.status_code, status.HTTP_200_OK, apply_res_1.data)

        # 3. Duplicate apply attempt on now-approved run returns HTTP 400
        apply_res_2 = self.client.post(apply_url, {'candidate_id': cand_id}, format='json')
        self.assertEqual(apply_res_2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot be applied", apply_res_2.data['detail'])

    def test_apply_rejects_nonexistent_candidate_id(self):
        url = reverse('agent-prompt', kwargs={'session_id': self.session.id})
        res = self.client.post(url, {'prompt': 'Living room alternatives', 'candidate_count': 2}, format='json')
        run_id = res.data['run']['id']

        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {'candidate_id': 'nonexistent-uuid-999'}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not found", apply_res.data['detail'])

    def test_apply_rejects_ineligible_candidate(self):
        url = reverse('agent-prompt', kwargs={'session_id': self.session.id})
        res = self.client.post(url, {'prompt': 'Living room alternatives', 'candidate_count': 3}, format='json')
        run_id = res.data['run']['id']

        # Find or construct candidate marked ineligible
        run = AgentRun.objects.get(id=run_id)
        val_results = run.validation_results
        val_results['candidates'][0]['is_approval_eligible'] = False
        val_results['candidates'][0]['is_valid'] = False
        run.validation_results = val_results
        run.save(update_fields=['validation_results'])

        cand_id = val_results['candidates'][0]['id']
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {'candidate_id': cand_id}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("ineligible", apply_res.data['detail'].lower())

    def test_apply_rejects_unowned_design_access(self):
        # Create session with other user
        other_session = AgentSession.objects.create(
            owner=self.other_user,
            design=self.design,
            title='Other AI Session',
        )
        url = reverse('agent-prompt', kwargs={'session_id': other_session.id})
        # Authenticate other user to generate proposal
        self.client.force_authenticate(user=self.other_user)
        res = self.client.post(url, {'prompt': 'Living room', 'candidate_count': 2}, format='json')
        run_id = res.data['run']['id']

        # Switch back to first user and attempt to apply other user's run -> 404
        self.client.force_authenticate(user=self.user)
        apply_url = reverse('agent-run-apply', kwargs={'run_id': run_id})
        apply_res = self.client.post(apply_url, {}, format='json')
        self.assertEqual(apply_res.status_code, status.HTTP_404_NOT_FOUND)


# =====================================================================
# Phase 6.5 Tests: Canonical Hashing, Persistent Undo/Redo & Telemetry
# =====================================================================

from apps.ai_agent.candidate_types import compute_canonical_scene_hash

class Phase65CanonicalSceneHashingTests(unittest.TestCase):
    """
    Mandatory Investigation B Verification:
    Tests canonical scene hash computation, cyclic starting-point normalization,
    edge topology preservation, and transient UI field stripping.
    """

    def setUp(self):
        self.base_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {
                'width': 5.0,
                'length': 4.0,
                'height': 2.8,
                'footprint': [[0.0, 0.0], [5.0, 0.0], [5.0, 4.0], [0.0, 4.0]],
                'walls': [
                    {'id': 'w-1', 'start': [0.0, 0.0], 'end': [5.0, 0.0], 'thickness': 0.15},
                    {'id': 'w-2', 'start': [5.0, 0.0], 'end': [5.0, 4.0], 'thickness': 0.15},
                ],
                'openings': [
                    {'id': 'op-1', 'wallId': 'w-1', 'type': 'door', 'distanceAlongWall': 1.5, 'width': 0.9, 'height': 2.1},
                ],
            },
            'objects': [
                {
                    'id': 'obj-sofa',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern Sofa',
                    'position': [2.5, 0.45, 2.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [2.1, 0.85, 0.9],
                }
            ],
            'relationships': [
                {
                    'id': 'rel-1',
                    'anchorObjectId': 'obj-sofa',
                    'childObjectId': 'obj-table',
                    'socketId': 'sofa-front-table',
                    'gap': 0.45,
                    'relativeYaw': 0.0,
                }
            ],
            'zones': [
                {'id': 'zone-living', 'type': 'living', 'memberObjectIds': ['obj-sofa', 'obj-table']}
            ]
        }

    def test_cyclic_starting_point_normalization_produces_identical_hash(self):
        """
        Shifting the polygon starting vertex cyclically along the contour must produce
        the exact same hash.
        """
        import copy
        h_base = compute_canonical_scene_hash(self.base_scene)

        # Shift cyclic starting points
        shift1 = copy.deepcopy(self.base_scene)
        shift1['room']['footprint'] = [[5.0, 0.0], [5.0, 4.0], [0.0, 4.0], [0.0, 0.0]]
        self.assertEqual(compute_canonical_scene_hash(shift1), h_base)

        shift2 = copy.deepcopy(self.base_scene)
        shift2['room']['footprint'] = [[5.0, 4.0], [0.0, 4.0], [0.0, 0.0], [5.0, 0.0]]
        self.assertEqual(compute_canonical_scene_hash(shift2), h_base)

        shift3 = copy.deepcopy(self.base_scene)
        shift3['room']['footprint'] = [[0.0, 4.0], [0.0, 0.0], [5.0, 0.0], [5.0, 4.0]]
        self.assertEqual(compute_canonical_scene_hash(shift3), h_base)

    def test_different_polygon_geometry_produces_different_hash(self):
        """Topological differences in room geometry must produce distinct hashes."""
        import copy
        h_base = compute_canonical_scene_hash(self.base_scene)

        # Modified vertex
        diff_geom = copy.deepcopy(self.base_scene)
        diff_geom['room']['footprint'] = [[0.0, 0.0], [5.5, 0.0], [5.5, 4.0], [0.0, 4.0]]
        self.assertNotEqual(compute_canonical_scene_hash(diff_geom), h_base)

        # Reversed winding order
        rev_geom = copy.deepcopy(self.base_scene)
        rev_geom['room']['footprint'] = [[0.0, 4.0], [5.0, 4.0], [5.0, 0.0], [0.0, 0.0]]
        self.assertNotEqual(compute_canonical_scene_hash(rev_geom), h_base)

    def test_transient_ui_fields_are_stripped(self):
        """Transient editor UI states must not change the canonical scene hash."""
        import copy
        h_base = compute_canonical_scene_hash(self.base_scene)

        ui_scene = copy.deepcopy(self.base_scene)
        ui_scene['selectedId'] = 'obj-sofa'
        ui_scene['hoveredId'] = 'obj-table'
        ui_scene['activeSnapGuides'] = [{'type': 'center', 'position': 2.5}]
        ui_scene['cameraResetNonce'] = 42
        ui_scene['viewMode'] = 'orthographic'
        ui_scene['objects'][0]['isSelected'] = True
        ui_scene['objects'][0]['isHovered'] = False
        ui_scene['objects'][0]['previewColor'] = '#ff0000'

        h_ui = compute_canonical_scene_hash(ui_scene)
        self.assertEqual(h_ui, h_base)

    def test_object_transforms_produce_different_hash(self):
        """Meaningful spatial transforms on furniture must alter the hash."""
        import copy
        h_base = compute_canonical_scene_hash(self.base_scene)

        moved = copy.deepcopy(self.base_scene)
        moved['objects'][0]['position'] = [2.5, 0.45, 2.1]
        self.assertNotEqual(compute_canonical_scene_hash(moved), h_base)

        rotated = copy.deepcopy(self.base_scene)
        rotated['objects'][0]['rotationEuler'] = [0.0, 1.57, 0.0]
        self.assertNotEqual(compute_canonical_scene_hash(rotated), h_base)


class Phase65PersistentUndoRedoTests(APITestCase):
    """
    Mandatory Investigation A Verification:
    Tests that applying a proposal updates the authoritative DB design,
    subsequent client undo/redo calls sync the DB state via existing design API,
    and optimistic concurrency rejects stale concurrent modifications with HTTP 409.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='test_undo_user', password='password123')
        self.client.force_authenticate(user=self.user)
        self.initial_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'initial-sofa',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Initial Sofa',
                    'position': [0.0, 0.45, 0.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [2.1, 0.85, 0.9],
                }
            ],
            'relationships': [],
        }
        self.design = Design.objects.create(
            owner=self.user,
            title='Undo Redo Design',
            scene_json=self.initial_scene,
        )

    def test_persistent_undo_redo_and_optimistic_concurrency_workflow(self):
        """
        Verifies the full reversible apply lifecycle:
        1. Design starts with initial scene (1 sofa).
        2. Client syncs proposed candidate scene (sofa + coffee table).
        3. DB reflects new scene.
        4. Client performs undo (restores initial scene).
        5. Client sends PATCH with expected_updated_at.
        6. DB reflects restored initial scene.
        7. Stale update with old expected_updated_at returns HTTP 409 Conflict.
        """
        # Step 1: Initial state
        self.design.refresh_from_db()
        self.assertEqual(len(self.design.scene_json['objects']), 1)
        original_updated_at = self.design.updated_at.isoformat()

        # Step 2: Apply proposed scene with 2 objects
        new_scene = copy.deepcopy(self.initial_scene)
        new_scene['objects'].append({
            'id': 'cand-table',
            'assetId': 'table-coffee-wood',
            'name': 'Coffee Table',
            'position': [0.0, 0.225, 1.2],
            'rotationEuler': [0.0, 0.0, 0.0],
            'dimensions': [1.1, 0.45, 0.6],
        })

        patch_url = reverse('designs:design-detail', kwargs={'pk': self.design.pk})
        res = self.client.patch(patch_url, {
            'scene_json': new_scene,
            'expected_updated_at': original_updated_at,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Step 3: DB now has 2 objects
        self.design.refresh_from_db()
        self.assertEqual(len(self.design.scene_json['objects']), 2)
        applied_updated_at = self.design.updated_at.isoformat()

        # Step 4 & 5: Client Undoes -> syncs original scene back to DB
        undo_res = self.client.patch(patch_url, {
            'scene_json': self.initial_scene,
            'expected_updated_at': applied_updated_at,
        }, format='json')
        self.assertEqual(undo_res.status_code, status.HTTP_200_OK)

        # Step 6: DB reflects restored initial scene
        self.design.refresh_from_db()
        self.assertEqual(len(self.design.scene_json['objects']), 1)
        self.assertEqual(self.design.scene_json['objects'][0]['id'], 'initial-sofa')

        # Step 7: Optimistic Concurrency Conflict (stale expected_updated_at)
        stale_res = self.client.patch(patch_url, {
            'scene_json': new_scene,
            'expected_updated_at': original_updated_at,  # Stale timestamp!
        }, format='json')
        self.assertEqual(stale_res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(stale_res.data.get('code'), 'stale_concurrency')


class Phase65SpatialEvaluationFrameworkTests(APITestCase):
    """
    Tests for the deterministic spatial evaluation framework (scenarios, runner, metrics, reports).
    """

    def test_evaluation_dataset_structure_and_completeness(self):
        """Dataset must contain at least 30 scenarios covering all 14 categories."""
        from apps.ai_agent.evaluation.evaluation_scenarios import EVALUATION_DATASET
        self.assertGreaterEqual(len(EVALUATION_DATASET), 30)

        categories = {case.category for case in EVALUATION_DATASET}
        expected_cats = {
            'living_room', 'bedroom', 'workspace', 'dining', 'polygon',
            'concave', 'constrained', 'multi_door', 'windows', 'preservation',
            'socket_attachment', 'budget_capped', 'negative_constrained',
        }
        for cat in expected_cats:
            self.assertIn(cat, categories, f"Missing scenario category: {cat}")

    def test_evaluation_runner_executes_offline_and_passes_gates(self):
        """Runner must execute offline with mock adapter and pass 100% of spatial gates."""
        from apps.ai_agent.evaluation.evaluation_runner import run_spatial_evaluation
        output = run_spatial_evaluation()
        self.assertGreaterEqual(output.summary_metrics.total_cases, 30)
        self.assertEqual(output.summary_metrics.gate_pass_rate_pct, 100.0)

    def test_report_generation_markdown_and_json(self):
        """Report generator must output valid JSON and formatted markdown with math equations."""
        from apps.ai_agent.evaluation.evaluation_runner import run_spatial_evaluation
        from apps.ai_agent.evaluation.evaluation_report import generate_json_report, generate_markdown_report
        output = run_spatial_evaluation()
        
        json_str = generate_json_report(output)
        self.assertIn('"gate_pass_rate_pct": 100.0', json_str)

        md_str = generate_markdown_report(output)
        self.assertIn('# RoomGenie AI — Spatial AI Evaluation Report', md_str)
        self.assertIn('✅ **ALL GATES PASSED**', md_str)
        self.assertIn('0.25 C_{\\text{bound}}', md_str)


class Phase65TelemetryPrivacyTests(unittest.TestCase):
    """
    Tests for privacy-conscious structured spatial telemetry.
    Ensures data minimization, prompt sanitization, coarse room summaries,
    error masking, and safe non-blocking exception handling.
    """

    def setUp(self):
        from apps.ai_agent.telemetry import clear_telemetry_events
        clear_telemetry_events()

    def test_prompt_sanitization_removes_cleartext(self):
        from apps.ai_agent.telemetry import sanitize_prompt
        raw_prompt = "Put a luxury velvet sofa next to the bay window under 50000 rupees"
        sanitized = sanitize_prompt(raw_prompt)
        self.assertNotIn("luxury", sanitized)
        self.assertNotIn("velvet", sanitized)
        self.assertEqual(sanitized['length'], len(raw_prompt))
        self.assertEqual(sanitized['category'], 'living')
        self.assertIn('hash', sanitized)
        self.assertEqual(len(sanitized['hash']), 8)

    def test_coarse_room_summary_omits_geometry(self):
        from apps.ai_agent.telemetry import summarize_scene_coarse
        scene = {
            'room': {
                'width': 6.0,
                'length': 4.5,
                'footprint': [[0, 0], [6, 0], [6, 4.5], [0, 4.5]],
            },
            'objects': [{'id': 'sofa-1'}, {'id': 'table-1'}],
        }
        summary = summarize_scene_coarse(scene)
        self.assertEqual(summary['object_count'], 2)
        self.assertEqual(summary['approx_area_sqm'], 27.0)
        self.assertTrue(summary['is_polygon'])
        self.assertNotIn('footprint', summary)

    def test_telemetry_event_data_minimization(self):
        from apps.ai_agent.telemetry import record_spatial_event, get_recent_telemetry_events
        record_spatial_event(
            event_name="candidate_generation_completed",
            payload={
                "user_prompt": "Arrange a desk and chair",
                "api_key": "secret-gemini-key-12345",
                "auth_token": "bearer-token-abcde",
                "candidate_count": 3,
            },
            session_id="anon-session-123",
        )
        events = get_recent_telemetry_events()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event['event_name'], "candidate_generation_completed")
        self.assertEqual(event['session_id'], "anon-session-123")
        # Ensure secret keys were stripped
        self.assertNotIn("api_key", event['data'])
        self.assertNotIn("auth_token", event['data'])
        self.assertNotIn("Arrange a desk and chair", str(event))
        self.assertIn("prompt_summary", event['data'])
        self.assertEqual(event['data']['prompt_summary']['category'], 'workspace')


# =============================================================================
# PHASE 7.1: PREFERENCE-AWARE DESIGN INTELLIGENCE TESTS
# =============================================================================

class Phase71PreferenceModelAndSerializerTests(TestCase):
    """
    Tests data modeling, taxonomic constraints, weight validation,
    and user ownership isolation for UserDesignPreference.
    """

    def setUp(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.user_a = User.objects.create_user(username="pref_user_a", password="password123")
        self.user_b = User.objects.create_user(username="pref_user_b", password="password123")

    def test_create_user_design_preference_defaults(self):
        from apps.ai_agent.models import UserDesignPreference
        pref = UserDesignPreference.objects.create(owner=self.user_a)
        self.assertEqual(pref.style_preferences, [])
        self.assertEqual(pref.colour_preferences, [])
        self.assertEqual(pref.material_preferences, [])
        self.assertEqual(pref.layout_preferences, [])
        self.assertEqual(pref.functional_priorities, [])
        self.assertEqual(pref.preservation_preferences, {})
        self.assertEqual(pref.budget_preferences, {})
        self.assertEqual(pref.schema_version, 1)

    def test_serializer_validates_valid_taxonomies(self):
        from apps.ai_agent.serializers import UserDesignPreferenceSerializer
        data = {
            "style_preferences": ["minimalist", "scandinavian", "japandi"],
            "colour_preferences": ["warm_neutrals", "natural_wood"],
            "material_preferences": ["wood", "fabric"],
            "layout_preferences": ["open_space", "conversation"],
            "functional_priorities": ["circulation", "natural_light"],
            "preserve_object_ids": ["sofa-001"],
            "budget_ceiling_paise": 15000000,
            "preference_weights": {
                "style": 2.0,
                "colour": 1.5,
                "material": 1.0,
            },
        }
        serializer = UserDesignPreferenceSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["budget_ceiling_paise"], 15000000)

    def test_serializer_rejects_unsupported_taxonomies(self):
        from apps.ai_agent.serializers import UserDesignPreferenceSerializer
        invalid_data = {
            "style_preferences": ["cyberpunk_neon"],  # Invalid style
            "colour_preferences": ["hot_pink"],       # Invalid colour
            "material_preferences": ["plastic"],      # Invalid material
            "layout_preferences": ["chaotic"],        # Invalid layout
            "functional_priorities": ["partying"],     # Invalid priority
        }
        serializer = UserDesignPreferenceSerializer(data=invalid_data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("style_preferences", serializer.errors)
        self.assertIn("colour_preferences", serializer.errors)
        self.assertIn("material_preferences", serializer.errors)
        self.assertIn("layout_preferences", serializer.errors)
        self.assertIn("functional_priorities", serializer.errors)

    def test_serializer_rejects_out_of_bounds_weights(self):
        from apps.ai_agent.serializers import UserDesignPreferenceSerializer
        invalid_weights = {
            "preference_weights": {
                "style": 6.5,  # Exceeds max 5.0
                "colour": -1.0,  # Below min 0.0
            }
        }
        serializer = UserDesignPreferenceSerializer(data=invalid_weights)
        self.assertFalse(serializer.is_valid())
        self.assertIn("preference_weights", serializer.errors)

    def test_user_uniqueness_constraint(self):
        from apps.ai_agent.models import UserDesignPreference
        from django.db import IntegrityError
        UserDesignPreference.objects.create(owner=self.user_a)
        with self.assertRaises(IntegrityError):
            UserDesignPreference.objects.create(owner=self.user_a)


class Phase71PreferenceInterpretationTests(TestCase):
    """
    Tests deterministic preference signal extraction, structured override precedence,
    and automatic contradiction detection in PreferenceEngine.
    """

    def test_extract_signals_from_user_prompt(self):
        from apps.ai_agent.preference_engine import parse_prompt_for_preferences
        prompt = "Create a minimalist scandinavian bedroom with warm neutral wooden furniture and high circulation priority"
        signals = parse_prompt_for_preferences(prompt)

        self.assertIn("minimalist", signals["styles"])
        self.assertIn("scandinavian", signals["styles"])
        self.assertIn("warm_neutrals", signals["colours"])
        self.assertIn("wood", signals["materials"])
        self.assertIn("circulation", signals["priorities"])

    def test_structured_preferences_take_precedence_over_prompt(self):
        from apps.ai_agent.preference_engine import normalize_preferences
        prompt = "Design a bohemian room with dark moody colours"
        structured = {
            "styles": ["minimalist"],
            "colours": ["warm_neutrals"],
        }
        norm = normalize_preferences(prompt_instruction=prompt, structured_preferences=structured)
        # Structured preferences override conflicting prompt signals
        self.assertEqual(norm.style_preferences, ["minimalist"])
        self.assertEqual(norm.colour_preferences, ["warm_neutrals"])

    def test_contradiction_detection_open_space_vs_storage(self):
        from apps.ai_agent.preference_engine import normalize_preferences
        structured = {
            "layout_preferences": ["open_space"],
            "functional_priorities": ["storage"],
        }
        norm = normalize_preferences(structured_preferences=structured)
        self.assertTrue(any("open_space" in c.lower() and "storage" in c.lower() for c in norm.detected_conflicts))

    def test_contradiction_detection_preserve_vs_remove(self):
        from apps.ai_agent.preference_engine import normalize_preferences
        prompt = "Please remove item sofa-123 and clear the area"
        structured = {
            "preserve_object_ids": ["sofa-123"],
        }
        norm = normalize_preferences(prompt_instruction=prompt, structured_preferences=structured)
        self.assertTrue(any("sofa-123" in c and "removal" in c.lower() for c in norm.detected_conflicts))


class Phase71PreferenceScoringTests(TestCase):
    """
    Tests preference scoring dimensions, formula verification,
    empty preference backwards-compatibility, and physical validity supremacy.
    """

    def setUp(self):
        from apps.furniture.models import FurnitureAsset
        self.asset_sofa = FurnitureAsset.objects.create(
            id="sofa-test-pref",
            name="Modern Wood Trim Sofa",
            category="seating",
            width=2.0,
            height=0.85,
            depth=0.9,
            price_paise=4000000,
            style_tags=["modern", "minimalist"],
            description="Contemporary wooden base sofa with textured fabric.",
            is_active=True,
        )
        self.asset_table = FurnitureAsset.objects.create(
            id="table-test-pref",
            name="Oak Coffee Table",
            category="tables",
            width=1.0,
            height=0.45,
            depth=0.6,
            price_paise=1500000,
            style_tags=["scandinavian", "wood"],
            description="Natural solid oak timber coffee table in warm sand tone.",
            is_active=True,
        )

    def test_score_formula_when_preferences_empty_has_lambda_zero(self):
        from apps.ai_agent.candidate_scorer import CandidateScorer
        from apps.ai_agent.candidate_types import CandidateValidationFeedback

        cand_scene = {
            "room": {"width": 5.0, "length": 4.0, "height": 2.8},
            "objects": [
                {"id": "s1", "assetId": self.asset_sofa.id, "position": [0, 0.425, 0], "dimensions": [2, 0.85, 0.9]}
            ],
            "relationships": [],
        }
        feedback = CandidateValidationFeedback(
            is_valid=True,
            is_approval_eligible=True,
            has_boundary_breaches=False,
            has_collisions=False,
            is_room_passable=True,
        )
        score = CandidateScorer.calculate_score(
            candidate_scene=cand_scene,
            validation_feedback=feedback,
            budget_diff={"after_total_paise": 4000000},
            preferences={},
        )
        # With empty preferences: lambda is 0.0, final score equals base score exactly
        self.assertEqual(score.lambda_weight, 0.0)
        self.assertEqual(score.final_score, score.base_score)
        self.assertEqual(score.overall, score.base_score)

    def test_score_formula_blends_base_and_preference_score(self):
        from apps.ai_agent.candidate_scorer import CandidateScorer
        from apps.ai_agent.candidate_types import CandidateValidationFeedback
        from apps.ai_agent.preference_engine import normalize_preferences

        cand_scene = {
            "room": {"width": 5.0, "length": 4.0, "height": 2.8},
            "objects": [
                {"id": "t1", "assetId": self.asset_table.id, "position": [0, 0.225, 0], "dimensions": [1, 0.45, 0.6]}
            ],
            "relationships": [],
        }
        feedback = CandidateValidationFeedback(
            is_valid=True,
            is_approval_eligible=True,
            has_boundary_breaches=False,
            has_collisions=False,
            is_room_passable=True,
        )
        norm_prefs = normalize_preferences(structured_preferences={
            "materials": ["wood"],
            "colours": ["warm_neutrals"],
        })
        score = CandidateScorer.calculate_score(
            candidate_scene=cand_scene,
            validation_feedback=feedback,
            budget_diff={"after_total_paise": 1500000},
            preferences=norm_prefs,
        )
        self.assertEqual(score.lambda_weight, 0.20)
        expected_final = 0.80 * score.base_score + 0.20 * score.preference_score
        self.assertAlmostEqual(score.final_score, expected_final, places=4)
        self.assertAlmostEqual(score.overall, expected_final, places=4)

    def test_hard_physical_violation_never_approval_eligible_despite_high_pref_score(self):
        from apps.ai_agent.candidate_scorer import CandidateScorer
        from apps.ai_agent.candidate_types import CandidateValidationFeedback, StructuredValidationIssue
        from apps.ai_agent.candidate_ranker import CandidateRanker
        from apps.ai_agent.candidate_types import LayoutCandidate
        from apps.ai_agent.preference_engine import normalize_preferences

        cand_scene = {
            "room": {"width": 5.0, "length": 4.0, "height": 2.8},
            "objects": [
                {"id": "t1", "assetId": self.asset_table.id, "position": [10.0, 0.225, 0], "dimensions": [1, 0.45, 0.6]}
            ],
            "relationships": [],
        }
        # Hard failure: boundary breach
        feedback = CandidateValidationFeedback(
            is_valid=False,
            is_approval_eligible=False,
            has_boundary_breaches=True,
            has_collisions=False,
            is_room_passable=True,
            fatal_errors=[StructuredValidationIssue(code="BOUNDARY_VIOLATION", message="Out of bounds", severity="fatal")],
        )
        norm_prefs = normalize_preferences(structured_preferences={"materials": ["wood"]})
        score = CandidateScorer.calculate_score(
            candidate_scene=cand_scene,
            validation_feedback=feedback,
            budget_diff={},
            preferences=norm_prefs,
        )
        # Even with high preference score (table has wood)
        self.assertEqual(score.preference_score, 100.0)

        cand_invalid = LayoutCandidate(
            id="cand-invalid-out-of-bounds",
            label="Option A",
            description="Out of bounds layout",
            reasoning_summary="Bad layout",
            proposed_actions=[],
            candidate_scene=cand_scene,
            source_scene_hash="hash-1",
            is_valid=False,
            is_approval_eligible=False,
            score=score,
            validation_feedback=feedback,
        )
        # Invariant check
        self.assertFalse(cand_invalid.is_valid)
        self.assertFalse(cand_invalid.is_approval_eligible)

        ranked = CandidateRanker.rank_candidates([cand_invalid])
        self.assertFalse(ranked[0].is_approval_eligible)


class Phase71PreferenceApiIntegrationTests(APITestCase):
    """
    Tests REST API endpoints for user design preferences and prompt integration.
    """

    def setUp(self):
        from django.contrib.auth import get_user_model
        from apps.designs.models import Design
        from apps.ai_agent.models import AgentSession
        User = get_user_model()
        self.user_a = User.objects.create_user(username="api_user_a", password="password123")
        self.user_b = User.objects.create_user(username="api_user_b", password="password123")
        self.design_a = Design.objects.create(
            owner=self.user_a,
            title="User A Living Room",
            scene_json={"room": {"width": 5.0, "length": 4.0, "height": 2.8}, "objects": []},
        )
        self.session_a = AgentSession.objects.create(
            design=self.design_a,
            owner=self.user_a,
        )

    def test_preferences_endpoint_requires_authentication(self):
        url = reverse('agent-preferences')
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_preferences_returns_default_when_none_saved(self):
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-preferences')
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['style_preferences'], [])

    def test_post_preferences_creates_profile(self):
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-preferences')
        payload = {
            "style_preferences": ["minimalist", "scandinavian"],
            "colour_preferences": ["warm_neutrals"],
            "material_preferences": ["wood"],
            "layout_preferences": ["open_space"],
            "functional_priorities": ["circulation"],
            "budget_ceiling_paise": 20000000,
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['style_preferences'], ["minimalist", "scandinavian"])
        self.assertEqual(res.data['budget_ceiling_paise'], 20000000)

    def test_user_ownership_isolation(self):
        # Create for user A
        from apps.ai_agent.models import UserDesignPreference
        UserDesignPreference.objects.create(
            owner=self.user_a,
            style_preferences=["japandi"],
        )
        # Authenticate as user B and query
        self.client.force_authenticate(user=self.user_b)
        url = reverse('agent-preferences')
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # User B should see empty/default, NOT user A's "japandi"
        self.assertEqual(res.data['style_preferences'], [])

    def test_delete_preferences_resets_profile(self):
        from apps.ai_agent.models import UserDesignPreference
        UserDesignPreference.objects.create(
            owner=self.user_a,
            style_preferences=["industrial"],
        )
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-preferences')
        res = self.client.delete(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(UserDesignPreference.objects.filter(owner=self.user_a).exists())

    def test_prompt_endpoint_accepts_preferences_and_returns_feedback(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})
        payload = {
            "prompt": "Arrange a warm living room with sofa and coffee table",
            "candidate_count": 3,
            "preferences": {
                "styles": ["minimalist"],
                "materials": ["wood"],
                "colours": ["warm_neutrals"],
            },
        }
        res = self.client.post(prompt_url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("candidates", res.data)
        self.assertIn("preferences_feedback", res.data)
        feedback = res.data["preferences_feedback"]
        self.assertIn("minimalist", feedback["applied_preferences"]["styles"])
        # Candidates include preference scores
        cands = res.data["candidates"]
        self.assertGreaterEqual(len(cands), 1)
        top_cand = cands[0]
        self.assertIn("preference_score", top_cand["score"])
        self.assertIn("base_score", top_cand["score"])
        self.assertIn("final_score", top_cand["score"])


# =============================================================================
# PHASE 7.2: ADVANCED CONSTRAINT-AWARE SPATIAL OPTIMIZATION TESTS
# =============================================================================

class Phase72OptimizationOperatorsTests(TestCase):
    """
    Tests the 10 deterministic spatial mutation and repair operators.
    """

    def setUp(self):
        self.rng = random.Random(42)
        self.base_scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'position': [0.0, 0.45, -0.8],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [2.2, 0.9, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                },
                {
                    'id': 'table-1',
                    'assetId': 'table-oak-coffee',
                    'name': 'Minimalist Coffee Table',
                    'position': [0.0, 0.225, 0.2],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [1.1, 0.45, 0.6],
                    'scale': [1.0, 1.0, 1.0],
                },
            ],
            'relationships': [
                {
                    'id': 'rel-1',
                    'anchorObjectId': 'sofa-1',
                    'childObjectId': 'table-1',
                    'socketId': 'sofa-front-table',
                    'gapMeters': 0.40,
                }
            ],
        }

    def test_op_repair_boundary_pulls_penetrated_object_inside(self):
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState
        from apps.ai_agent.optimization.optimization_operators import OptimizationOperators
        from apps.ai_agent.optimization.optimization_constraints import ConstraintEvaluator

        # Place item penetrating boundary (X = 1.8m with 2.2m width breaches 2.5m wall)
        scene = copy.deepcopy(self.base_scene)
        scene['objects'][0]['position'] = [1.8, 0.45, 0.0]
        state = CandidateSceneState(scene)

        initial_eval = ConstraintEvaluator.evaluate_state(state)
        self.assertFalse(initial_eval['is_valid'])

        changed, msg = OptimizationOperators.op_repair_boundary(state, self.rng)
        self.assertTrue(changed)

        pos = state.get_object_position('sofa-1')
        self.assertIsNotNone(pos)
        self.assertLessEqual(pos[0], 2.5)

    def test_op_repair_collision_separates_intersecting_items(self):
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState
        from apps.ai_agent.optimization.optimization_operators import OptimizationOperators
        from apps.ai_agent.optimization.optimization_constraints import ConstraintEvaluator

        scene = copy.deepcopy(self.base_scene)
        # Place both items at the exact same location
        scene['objects'][0]['position'] = [0.0, 0.45, 0.0]
        scene['objects'][1]['position'] = [0.0, 0.45, 0.0]
        scene['relationships'] = []  # unattached to trigger collision check

        state = CandidateSceneState(scene)
        eval_before = ConstraintEvaluator.evaluate_state(state)
        self.assertGreaterEqual(len(eval_before['collisions']), 1)

        changed, msg = OptimizationOperators.op_repair_collision(state, self.rng)
        self.assertTrue(changed)

        pos_a = state.get_object_position('sofa-1')
        pos_b = state.get_object_position('table-1')
        self.assertIsNotNone(pos_a)
        self.assertIsNotNone(pos_b)
        dist = math.hypot(pos_a[0] - pos_b[0], pos_a[2] - pos_b[2])
        self.assertGreater(dist, 0.05)

    def test_op_wall_alignment_snaps_yaw_to_wall(self):
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState
        from apps.ai_agent.optimization.optimization_operators import OptimizationOperators

        state = CandidateSceneState(self.base_scene)
        state.set_object_yaw('sofa-1', 0.35)  # non-cardinal angle

        changed, msg = OptimizationOperators.op_wall_alignment(state, self.rng)
        self.assertTrue(changed)

        new_yaw = state.get_object_yaw('sofa-1')
        # Should snap to cardinal orientation (0, pi/2, pi, -pi/2)
        cardinal_yaws = [0.0, math.pi / 2.0, math.pi, -math.pi / 2.0]
        self.assertTrue(any(abs((new_yaw - cy + math.pi) % (2 * math.pi) - math.pi) < 0.05 for cy in cardinal_yaws))

    def test_op_group_translation_moves_cluster_cohesively(self):
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState
        from apps.ai_agent.optimization.optimization_operators import OptimizationOperators

        state = CandidateSceneState(self.base_scene)
        pos_sofa_before = state.get_object_position('sofa-1')
        pos_table_before = state.get_object_position('table-1')

        changed, msg = OptimizationOperators.op_group_translation(state, self.rng)
        self.assertTrue(changed)

        pos_sofa_after = state.get_object_position('sofa-1')
        pos_table_after = state.get_object_position('table-1')

        dx_sofa = pos_sofa_after[0] - pos_sofa_before[0]
        dx_table = pos_table_after[0] - pos_table_before[0]
        dz_sofa = pos_sofa_after[2] - pos_sofa_before[2]
        dz_table = pos_table_after[2] - pos_table_before[2]

        self.assertAlmostEqual(dx_sofa, dx_table, places=3)
        self.assertAlmostEqual(dz_sofa, dz_table, places=3)

    def test_op_socket_reassignment_updates_gap_within_bounds(self):
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState
        from apps.ai_agent.optimization.optimization_operators import OptimizationOperators
        from apps.ai_agent.sockets import CANONICAL_SOCKET_DEFINITIONS

        state = CandidateSceneState(self.base_scene)
        sdef = next(s for s in CANONICAL_SOCKET_DEFINITIONS if s['id'] == 'sofa-front-table')

        changed, msg = OptimizationOperators.op_socket_reassignment(state, self.rng)
        self.assertTrue(changed)

        updated_rel = state.relationships[0]
        new_gap = float(updated_rel['gapMeters'])
        self.assertGreaterEqual(new_gap, sdef['min_gap'] - 0.01)
        self.assertLessEqual(new_gap, sdef['max_gap'] + 0.01)

    def test_op_open_space_recovery_pushes_central_items_outward(self):
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState
        from apps.ai_agent.optimization.optimization_operators import OptimizationOperators

        scene = copy.deepcopy(self.base_scene)
        # Place item near center of room (0.2, 0.2)
        scene['objects'][0]['position'] = [0.2, 0.45, 0.2]
        state = CandidateSceneState(scene)

        dist_before = math.hypot(0.2, 0.2)
        changed, msg = OptimizationOperators.op_open_space_recovery(state, self.rng)
        self.assertTrue(changed)

        pos_after = state.get_object_position('sofa-1')
        dist_after = math.hypot(pos_after[0], pos_after[2])
        self.assertGreater(dist_after, dist_before)


class Phase72ConstraintSearchAndRepairTests(TestCase):
    """
    Tests two-phase search and repair behavior, reproducibility, and scene isolation.
    """

    def setUp(self):
        self.initial_scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'mock-sofa-test',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'position': [0.0, 0.45, -0.8],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [2.2, 0.9, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                },
                {
                    'id': 'mock-chair-breach',
                    'assetId': 'chair-accent-armchair',
                    'name': 'Lounge Accent Armchair',
                    'position': [2.8, 0.44, 0.0],  # Breaches 2.5m wall limit
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': [0.85, 0.88, 0.85],
                    'scale': [1.0, 1.0, 1.0],
                },
            ],
            'relationships': [],
        }

    def test_repair_and_optimize_repairs_out_of_bounds_violation(self):
        from apps.ai_agent.optimization.optimization_search import SpatialOptimizerSearch

        search = SpatialOptimizerSearch()
        opt_state, metrics = search.repair_and_optimize(
            initial_scene=self.initial_scene,
            initial_actions=[],
            variant_seed_offset=1,
        )

        self.assertFalse(metrics.initial_valid)
        self.assertTrue(opt_state.is_valid)
        self.assertTrue(metrics.final_valid)
        self.assertGreaterEqual(metrics.repaired_boundary_violations, 1)

    def test_search_is_strictly_deterministic_under_fixed_seed(self):
        from apps.ai_agent.optimization.optimization_search import SpatialOptimizerSearch

        search1 = SpatialOptimizerSearch()
        search2 = SpatialOptimizerSearch()

        opt1, m1 = search1.repair_and_optimize(
            initial_scene=self.initial_scene,
            initial_actions=[],
            variant_seed_offset=42,
        )
        opt2, m2 = search2.repair_and_optimize(
            initial_scene=self.initial_scene,
            initial_actions=[],
            variant_seed_offset=42,
        )

        pos1 = opt1.scene['objects'][1]['position']
        pos2 = opt2.scene['objects'][1]['position']
        self.assertEqual(pos1, pos2)
        self.assertEqual(opt1.objectives.aggregate_score(), opt2.objectives.aggregate_score())

    def test_search_never_mutates_original_input_scene(self):
        from apps.ai_agent.optimization.optimization_search import SpatialOptimizerSearch

        scene_snapshot = copy.deepcopy(self.initial_scene)
        search = SpatialOptimizerSearch()
        opt_state, metrics = search.repair_and_optimize(
            initial_scene=self.initial_scene,
            initial_actions=[],
        )

        self.assertEqual(self.initial_scene, scene_snapshot)


class Phase72ParetoAndDiversityTests(TestCase):
    """
    Tests Pareto dominance, front sorting, crowding distance, and diversity metrics.
    """

    def test_objective_vector_dominance(self):
        from apps.ai_agent.optimization.optimization_types import ObjectiveVector

        vec_a = ObjectiveVector(containment=100, collision=100, circulation=90, clearance=90)
        vec_b = ObjectiveVector(containment=100, collision=100, circulation=80, clearance=80)
        vec_c = ObjectiveVector(containment=100, collision=100, circulation=95, clearance=70)

        self.assertTrue(vec_a.dominates(vec_b))
        self.assertFalse(vec_b.dominates(vec_a))
        # Non-dominance (trade-off)
        self.assertFalse(vec_a.dominates(vec_c))
        self.assertFalse(vec_c.dominates(vec_a))

    def test_pareto_selector_non_dominated_sorting(self):
        from apps.ai_agent.optimization.optimization_selection import ParetoSelector
        from apps.ai_agent.optimization.optimization_types import ObjectiveVector, OptimizationCandidateState

        c1 = OptimizationCandidateState(
            state_id='c1', scene={}, proposed_actions=[],
            objectives=ObjectiveVector(circulation=95, utilization=90)
        )
        c2 = OptimizationCandidateState(
            state_id='c2', scene={}, proposed_actions=[],
            objectives=ObjectiveVector(circulation=80, utilization=75)  # Dominated by c1
        )
        c3 = OptimizationCandidateState(
            state_id='c3', scene={}, proposed_actions=[],
            objectives=ObjectiveVector(circulation=90, utilization=95)  # Trade-off with c1
        )

        fronts = ParetoSelector.non_dominated_sort([c1, c2, c3])
        self.assertEqual(len(fronts), 2)
        front0_ids = {c.state_id for c in fronts[0]}
        self.assertEqual(front0_ids, {'c1', 'c3'})
        self.assertEqual(fronts[1][0].state_id, 'c2')

    def test_diversity_engine_measures_spatial_and_rotational_difference(self):
        from apps.ai_agent.optimization.optimization_diversity import DiversityEngine
        from apps.ai_agent.optimization.optimization_state import CandidateSceneState

        scene1 = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [{'id': 'o1', 'position': [-1.0, 0.45, 0.0], 'rotationEuler': [0.0, 0.0, 0.0]}],
            'relationships': [],
        }
        scene2 = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [{'id': 'o1', 'position': [1.0, 0.45, 0.0], 'rotationEuler': [0.0, math.pi, 0.0]}],
            'relationships': [],
        }

        s1 = CandidateSceneState(scene1)
        s2 = CandidateSceneState(scene2)

        dist = DiversityEngine.calculate_state_distance(s1, s2)
        self.assertGreater(dist, 40.0)

    def test_badge_assignment(self):
        from apps.ai_agent.optimization.optimization_selection import ParetoSelector
        from apps.ai_agent.optimization.optimization_types import ObjectiveVector, OptimizationCandidateState

        c_overall = OptimizationCandidateState(
            state_id='c1', scene={}, proposed_actions=[],
            objectives=ObjectiveVector(containment=100, collision=100, circulation=92, utilization=90, preferences=95)
        )
        c_circ = OptimizationCandidateState(
            state_id='c2', scene={}, proposed_actions=[],
            objectives=ObjectiveVector(containment=100, collision=100, circulation=99, utilization=75, preferences=80)
        )
        c_space = OptimizationCandidateState(
            state_id='c3', scene={}, proposed_actions=[],
            objectives=ObjectiveVector(containment=100, collision=100, circulation=85, utilization=98, preferences=80)
        )

        ParetoSelector.assign_badges([c_overall, c_circ, c_space])
        self.assertEqual(c_overall.best_badge, "Best Overall")
        self.assertEqual(c_circ.best_badge, "Best Circulation")
        self.assertEqual(c_space.best_badge, "Best Open Space")


class Phase72OptimizationIntegrationTests(APITestCase):
    """
    End-to-end integration tests for multi-candidate generation with active optimization.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='opt_user', password='password123')
        self.design = Design.objects.create(title='Optimization Design', owner=self.user, scene_json={'objects': []})
        self.session = AgentSession.objects.create(design=self.design, owner=self.user, title='Opt Session')

        from apps.furniture.models import FurnitureAsset
        FurnitureAsset.objects.create(
            id='sofa-modern-3seater',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='table-oak-coffee',
            name='Oak Coffee Table',
            category='tables',
            width=Decimal('1.10'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=899900,
            currency='INR',
            is_active=True,
        )
        FurnitureAsset.objects.create(
            id='chair-accent-armchair',
            name='Accent Armchair',
            category='seating',
            width=Decimal('0.85'),
            height=Decimal('0.85'),
            depth=Decimal('0.85'),
            price_paise=1299900,
            currency='INR',
            is_active=True,
        )

    def test_candidate_generator_attaches_optimization_metadata(self):
        from apps.ai_agent.candidate_generator import CandidateGenerator
        from apps.ai_agent.adapters.mock import MockDesignLLMAdapter

        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
            'relationships': [],
        }
        gen = CandidateGenerator(adapter=MockDesignLLMAdapter())
        candidates = gen.generate_candidates(
            user_prompt="Arrange a conversational living area with sofa, coffee table, and accent chairs",
            current_scene=scene,
            candidate_count=3,
        )

        self.assertEqual(len(candidates), 3)
        for cand in candidates:
            self.assertIsNotNone(cand.optimization_metadata)
            meta = cand.optimization_metadata
            self.assertEqual(meta['version'], '7.2')
            self.assertIn('iterations', meta)
            self.assertIn('durationMs', meta)
            self.assertIn('finalValid', meta)
            self.assertIn('objectives', meta)
            self.assertTrue(cand.is_valid)
            self.assertTrue(cand.is_approval_eligible)

    def test_evaluation_runner_74_scenarios_pass_all_gates(self):
        from apps.ai_agent.evaluation import run_spatial_evaluation

        result = run_spatial_evaluation()
        sm = result.summary_metrics

        self.assertEqual(sm.total_cases, 104)
        self.assertEqual(sm.total_candidates, 312)
        self.assertEqual(sm.gate_pass_rate_pct, 100.0)
        self.assertEqual(sm.failed_gates_count, 0)
        self.assertGreaterEqual(sm.hard_validity_rate_pct, 80.0)
        self.assertGreaterEqual(sm.mean_candidate_diversity_score, 80.0)
        self.assertGreaterEqual(sm.mean_preference_score, 90.0)


# =============================================================================
# Phase 7.3: Explainable, Feedback-Driven Spatial Design Refinement Tests
# =============================================================================

from apps.ai_agent.feedback import (
    FeedbackRepository,
    PreferenceLearningEngine,
    ExplanationEngine,
    CandidateComparisonService,
    RefinementInterpreter,
    RefinementPlanner,
    RefinementRunner,
    FeedbackService,
    FeedbackType,
    ComparisonOutcome,
    UserCandidateFeedback,
    UserPairwiseComparison,
    LearnedPreferenceAdjustment,
)


class Phase73FeedbackPersistenceAndOwnershipTests(APITestCase):
    """
    Tests feedback recording, pairwise comparison, cross-user ownership isolation,
    and learned preferences persistence and reset.
    """

    def setUp(self):
        self.user_a = User.objects.create_user(username='phase73_user_a', password='password123')
        self.user_b = User.objects.create_user(username='phase73_user_b', password='password123')

        self.design_a = Design.objects.create(
            owner=self.user_a,
            title="Design A",
            scene_json={'schemaVersion': 1, 'unit': 'm', 'room': {'width': 6.0, 'length': 5.0, 'height': 2.8}, 'objects': []}
        )
        self.session_a = AgentSession.objects.create(owner=self.user_a, design=self.design_a, title="Session A")
        self.run_a = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Arrange living room",
            status=AgentRun.STATUS_PROPOSED,
            validation_results={
                'candidates': [
                    {'id': 'cand-1', 'label': 'Option A', 'score': {'overall': 92.0, 'circulation': 90.0, 'boundary': 100.0, 'collision': 100.0, 'clearance': 100.0, 'utilization': 90.0, 'budget': 100.0}, 'candidate_scene': {'room': {'width': 6.0, 'length': 5.0, 'height': 2.8}, 'objects': []}},
                    {'id': 'cand-2', 'label': 'Option B', 'score': {'overall': 88.0, 'circulation': 80.0, 'boundary': 100.0, 'collision': 100.0, 'clearance': 100.0, 'utilization': 85.0, 'budget': 100.0}, 'candidate_scene': {'room': {'width': 6.0, 'length': 5.0, 'height': 2.8}, 'objects': []}},
                ]
            }
        )

    def test_record_candidate_feedback_success(self):
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-feedback')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-1',
            'feedback_type': 'liked',
            'structured_reasons': ['better_circulation', 'more_open_floor_space'],
            'feedback_text': 'I like the walking space.',
            'candidate_score': 92.0,
            'candidate_label': 'Option A',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('feedback', res.data)
        self.assertIn('learned_preferences', res.data)
        self.assertEqual(res.data['feedback']['candidate_id'], 'cand-1')
        self.assertEqual(res.data['feedback']['feedback_type'], 'liked')

        # Verify DB record
        fb = UserCandidateFeedback.objects.get(id=res.data['feedback']['id'])
        self.assertEqual(fb.user, self.user_a)
        self.assertEqual(fb.structured_reasons, ['better_circulation', 'more_open_floor_space'])

    def test_cross_user_cannot_submit_feedback_on_another_users_run(self):
        self.client.force_authenticate(user=self.user_b)
        url = reverse('agent-feedback')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-1',
            'feedback_type': 'liked',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_record_pairwise_comparison_success(self):
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-feedback-compare')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_a_id': 'cand-1',
            'candidate_b_id': 'cand-2',
            'outcome': 'a_preferred',
            'structured_reasons': ['better_circulation'],
            'comparison_text': 'Candidate A has much clearer entry route.',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['comparison']['outcome'], 'a_preferred')

        comp = UserPairwiseComparison.objects.get(id=res.data['comparison']['id'])
        self.assertEqual(comp.user, self.user_a)

    def test_learned_preferences_get_and_reset(self):
        self.client.force_authenticate(user=self.user_a)
        # Record feedback to trigger learned preference adjustment
        url_fb = reverse('agent-feedback')
        self.client.post(url_fb, {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-1',
            'feedback_type': 'selected',
            'structured_reasons': ['better_circulation'],
        }, format='json')

        # Check GET learned preferences
        url_get = reverse('agent-learned-preferences')
        res_get = self.client.get(url_get)
        self.assertEqual(res_get.status_code, status.HTTP_200_OK)
        self.assertGreater(res_get.data['feedback_count'], 0)
        self.assertIn('circulation', res_get.data['adjusted_weights'])

        # Check POST reset
        url_reset = reverse('agent-learned-preferences-reset')
        res_reset = self.client.post(url_reset, {}, format='json')
        self.assertEqual(res_reset.status_code, status.HTTP_200_OK)
        self.assertEqual(res_reset.data['feedback_count'], 0)
        self.assertEqual(res_reset.data['adjusted_weights'], {})


class Phase73PreferenceLearningTests(TestCase):
    """
    Tests mathematical stability, bounds, determinism, and explicit preference
    precedence of the PreferenceLearningEngine.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='pref_learn_user', password='password123')
        self.engine = PreferenceLearningEngine()

    def test_bounded_weight_updates(self):
        current_state = FeedbackRepository.get_learned_preference_state(self.user)
        # Generate 50 repeated positive feedback events for circulation
        feedback_history = [
            type('MockFB', (), {
                'candidate_id': f'cand-{i}',
                'feedback_type': 'selected',
                'structured_reasons': ['better_circulation'],
            })
            for i in range(50)
        ]
        weights, confidence, explanations, count = self.engine.compute_updated_weights(
            current_state=current_state,
            feedback_history=feedback_history,
        )
        self.assertEqual(count, 50)
        # Must be bounded strictly at MAX_WEIGHT (2.50)
        self.assertLessEqual(weights['circulation'], 2.50)
        self.assertGreaterEqual(weights['circulation'], 1.0)
        self.assertGreaterEqual(confidence['circulation'], 0.90)
        self.assertIn('Circulation weight increased', explanations['circulation'])

    def test_strictly_deterministic_from_identical_history(self):
        current_state = FeedbackRepository.get_learned_preference_state(self.user)
        history = [
            type('MockFB', (), {'feedback_type': 'liked', 'structured_reasons': ['more_open_floor_space']}),
            type('MockFB', (), {'feedback_type': 'disliked', 'structured_reasons': ['better_storage']}),
        ]
        w1, c1, e1, _ = self.engine.compute_updated_weights(current_state, history)
        w2, c2, e2, _ = self.engine.compute_updated_weights(current_state, history)
        self.assertEqual(w1, w2)
        self.assertEqual(c1, c2)
        self.assertEqual(e1, e2)

    def test_contradictory_signals_counteract_smoothly(self):
        current_state = FeedbackRepository.get_learned_preference_state(self.user)
        # 2 likes and 2 dislikes
        history = [
            type('MockFB', (), {'feedback_type': 'liked', 'structured_reasons': ['better_circulation']}),
            type('MockFB', (), {'feedback_type': 'liked', 'structured_reasons': ['better_circulation']}),
            type('MockFB', (), {'feedback_type': 'disliked', 'structured_reasons': ['better_circulation']}),
            type('MockFB', (), {'feedback_type': 'disliked', 'structured_reasons': ['better_circulation']}),
        ]
        weights, _, _, _ = self.engine.compute_updated_weights(current_state, history)
        # Should stay close to baseline 1.0
        self.assertAlmostEqual(weights['circulation'], 1.04, delta=0.10)

    def test_explicit_preference_precedence(self):
        current_state = FeedbackRepository.get_learned_preference_state(self.user)
        history = [
            type('MockFB', (), {'feedback_type': 'selected', 'structured_reasons': ['better_circulation']})
            for _ in range(5)
        ]
        explicit_saved = {'circulation': 2.0}
        weights, _, explanations, _ = self.engine.compute_updated_weights(
            current_state=current_state,
            feedback_history=history,
            explicit_saved_weights=explicit_saved,
        )
        # Explicit setting anchors the weight; feedback cannot wildly overwrite it
        self.assertAlmostEqual(weights['circulation'], 2.0, delta=0.25)
        self.assertIn("Anchored by explicit user setting (2.0)", explanations['circulation'])


class Phase73ExplanationAndComparisonTests(APITestCase):
    """
    Tests evidence-based candidate explanation generation and deep pairwise comparison.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='explain_user', password='password123')
        self.design = Design.objects.create(
            owner=self.user,
            title="Living Design",
            scene_json={
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
                'objects': [
                    {'id': 'sofa-1', 'name': 'Modern Sofa', 'assetId': 'sofa-modern-3seater', 'position': [0, 0.45, -0.8], 'rotationEuler': [0, 0, 0], 'dimensions': [2.2, 0.9, 0.9], 'scale': [1, 1, 1]}
                ]
            }
        )
        self.session = AgentSession.objects.create(owner=self.user, design=self.design, title="Session")
        self.cand_a_dict = {
            'id': 'cand-opt-a',
            'label': 'Option A: Conversational',
            'description': 'Balanced seating circle',
            'reasoning_summary': 'Conversational setup',
            'is_valid': True,
            'is_approval_eligible': True,
            'score': {'overall': 95.0, 'circulation': 92.0, 'clearance': 100.0, 'utilization': 95.0, 'boundary': 100.0, 'collision': 100.0, 'budget': 100.0, 'preference_dimensions': {'circulation': 92.0}},
            'candidate_scene': {
                'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
                'objects': [
                    {'id': 'sofa-1', 'name': 'Modern Sofa', 'assetId': 'sofa-modern-3seater', 'position': [0, 0.45, -0.8], 'dimensions': [2.2, 0.9, 0.9], 'scale': [1, 1, 1]},
                    {'id': 'table-1', 'name': 'Coffee Table', 'assetId': 'table-oak-coffee', 'position': [0, 0.225, 0.2], 'dimensions': [1.2, 0.45, 0.6], 'scale': [1, 1, 1]}
                ],
                'relationships': [{'anchorObjectId': 'sofa-1', 'childObjectId': 'table-1', 'socketId': 'sofa-front-table', 'gap': 0.40}]
            },
            'proposed_actions': [{'type': 'attach_to_socket', 'anchor_object_id': 'sofa-1', 'child_object_id': 'table-1', 'socket_id': 'sofa-front-table', 'gap_meters': 0.40}],
        }
        self.cand_b_dict = {
            'id': 'cand-opt-b',
            'label': 'Option B: Open Circulation',
            'description': 'Maximizes central floor space',
            'reasoning_summary': 'Perimeter focus',
            'is_valid': True,
            'is_approval_eligible': True,
            'score': {'overall': 90.0, 'circulation': 85.0, 'clearance': 95.0, 'utilization': 88.0, 'boundary': 100.0, 'collision': 100.0, 'budget': 100.0},
            'candidate_scene': {
                'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
                'objects': [
                    {'id': 'sofa-1', 'name': 'Modern Sofa', 'assetId': 'sofa-modern-3seater', 'position': [0, 0.45, -1.2], 'dimensions': [2.2, 0.9, 0.9], 'scale': [1, 1, 1]},
                    {'id': 'table-1', 'name': 'Coffee Table', 'assetId': 'table-oak-coffee', 'position': [0, 0.225, -0.4], 'dimensions': [1.2, 0.45, 0.6], 'scale': [1, 1, 1]}
                ],
                'relationships': []
            },
            'proposed_actions': [],
        }

        self.run = AgentRun.objects.create(
            session=self.session,
            user_prompt="Living room options",
            status=AgentRun.STATUS_PROPOSED,
            validation_results={'candidates': [self.cand_a_dict, self.cand_b_dict]}
        )

    def test_get_candidate_explanation_endpoint(self):
        self.client.force_authenticate(user=self.user)
        url = reverse('agent-candidate-explain', kwargs={'run_id': str(self.run.id), 'candidate_id': 'cand-opt-a'})
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['candidate_id'], 'cand-opt-a')
        self.assertEqual(res.data['rank'], 1)
        self.assertIn('overall_score', res.data)
        self.assertGreater(len(res.data['key_strengths']), 0)
        self.assertIn('factual_metrics', res.data)
        self.assertEqual(res.data['factual_metrics']['furniture_count'], 2)

    def test_compare_detailed_endpoint(self):
        self.client.force_authenticate(user=self.user)
        url = reverse('agent-candidates-compare-detailed', kwargs={'run_id': str(self.run.id)})
        payload = {
            'candidate_a_id': 'cand-opt-a',
            'candidate_b_id': 'cand-opt-b',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['candidate_a_id'], 'cand-opt-a')
        self.assertEqual(res.data['candidate_b_id'], 'cand-opt-b')
        self.assertIn('position_displacements', res.data)
        self.assertIn('objective_deltas', res.data)
        self.assertIn('summary_verdict', res.data)


class Phase73RefinementInterpreterTests(TestCase):
    """
    Tests natural language refinement parsing, protected items extraction,
    and ambiguity handling.
    """

    def setUp(self):
        self.scene = {
            'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
            'objects': [
                {'id': 'mock-sofa', 'name': 'Modern 3-Seater Sofa', 'assetId': 'sofa-modern-3seater'},
                {'id': 'mock-table', 'name': 'Minimalist Coffee Table', 'assetId': 'table-oak-coffee'},
                {'id': 'mock-chair-l', 'name': 'Lounge Accent Armchair', 'assetId': 'chair-accent-armchair'},
            ]
        }

    def test_parses_target_and_protected_objects(self):
        prompt = "Keep the sofa where it is, but move the coffee table slightly forward."
        req = RefinementInterpreter.interpret_refinement(prompt, self.scene)
        self.assertFalse(req.is_ambiguous)
        self.assertEqual(req.target_object_ids, ['mock-table'])
        self.assertEqual(req.protected_object_ids, ['mock-sofa'])
        self.assertEqual(req.preferred_direction, 'forward')

    def test_parses_open_space_directive(self):
        prompt = "Make the room feel more open and spacious."
        req = RefinementInterpreter.interpret_refinement(prompt, self.scene)
        self.assertFalse(req.is_ambiguous)
        self.assertEqual(req.intent_category, 'increase_open_space')

    def test_parses_circulation_directive(self):
        prompt = "Improve the walking path to the doorway."
        req = RefinementInterpreter.interpret_refinement(prompt, self.scene)
        self.assertFalse(req.is_ambiguous)
        self.assertEqual(req.intent_category, 'improve_circulation')

    def test_ambiguity_on_short_or_gibberish_prompt(self):
        req = RefinementInterpreter.interpret_refinement("asdf", self.scene)
        self.assertTrue(req.is_ambiguous)
        self.assertIsNotNone(req.ambiguity_reason)

    def test_ambiguity_on_nonexistent_furniture(self):
        req = RefinementInterpreter.interpret_refinement("Move the grand piano closer to the window", self.scene)
        self.assertTrue(req.is_ambiguous)
        self.assertIn("piano", req.ambiguity_reason)


class Phase73RefinementPlannerAndRunnerTests(APITestCase):
    """
    Tests bounded refinement execution, protected objects preservation,
    and canonical scene immutability.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='refine_runner_user', password='password123')
        self.design = Design.objects.create(
            owner=self.user,
            title="Refinement Design",
            scene_json={
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
                'objects': [
                    {'id': 'mock-sofa-a', 'name': 'Modern 3-Seater Sofa', 'assetId': 'sofa-modern-3seater', 'position': [0.0, 0.425, -0.8], 'dimensions': [2.1, 0.85, 0.9], 'scale': [1, 1, 1]},
                    {'id': 'mock-table-a', 'name': 'Minimalist Coffee Table', 'assetId': 'table-oak-coffee', 'position': [0.0, 0.225, 0.25], 'dimensions': [1.2, 0.45, 0.6], 'scale': [1, 1, 1]},
                ]
            }
        )
        self.session = AgentSession.objects.create(owner=self.user, design=self.design, title="Session")
        self.base_cand_dict = {
            'id': 'cand-base-1',
            'label': 'Option A: Initial',
            'description': 'Initial layout',
            'reasoning_summary': 'Initial layout',
            'is_valid': True,
            'is_approval_eligible': True,
            'score': {'overall': 92.0, 'circulation': 90.0, 'boundary': 100.0, 'collision': 100.0, 'clearance': 100.0, 'utilization': 90.0, 'budget': 100.0},
            'candidate_scene': {
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 6.0, 'length': 5.0, 'height': 2.8},
                'objects': [
                    {'id': 'mock-sofa-a', 'name': 'Modern 3-Seater Sofa', 'assetId': 'sofa-modern-3seater', 'position': [0.0, 0.425, -0.8], 'dimensions': [2.1, 0.85, 0.9], 'scale': [1, 1, 1]},
                    {'id': 'mock-table-a', 'name': 'Minimalist Coffee Table', 'assetId': 'table-oak-coffee', 'position': [0.0, 0.225, 0.25], 'dimensions': [1.2, 0.45, 0.6], 'scale': [1, 1, 1]},
                ],
                'relationships': [{'anchorObjectId': 'mock-sofa-a', 'childObjectId': 'mock-table-a', 'socketId': 'sofa-front-table', 'gap': 0.40}]
            },
            'proposed_actions': [
                {'type': 'add_furniture', 'object_id': 'mock-sofa-a', 'asset_id': 'sofa-modern-3seater', 'position': [0.0, 0.425, -0.8]},
                {'type': 'add_furniture', 'object_id': 'mock-table-a', 'asset_id': 'table-oak-coffee', 'position': [0.0, 0.225, 0.25]},
                {'type': 'attach_to_socket', 'anchor_object_id': 'mock-sofa-a', 'child_object_id': 'mock-table-a', 'socket_id': 'sofa-front-table', 'gap_meters': 0.40},
            ]
        }
        self.run = AgentRun.objects.create(
            session=self.session,
            user_prompt="Initial proposal",
            status=AgentRun.STATUS_PROPOSED,
            validation_results={'candidates': [self.base_cand_dict]}
        )

    def test_refine_candidate_endpoint_preserves_protected_sofa_and_shifts_table(self):
        self.client.force_authenticate(user=self.user)
        url = reverse('agent-candidate-refine', kwargs={'run_id': str(self.run.id), 'candidate_id': 'cand-base-1'})
        payload = {
            'instruction': 'Keep the sofa where it is, but move the coffee table forward.',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(res.data['is_ambiguous'])
        self.assertGreater(len(res.data['refined_candidates']), 0)

        top_refined = res.data['refined_candidates'][0]
        ref_meta = top_refined.get('optimization_metadata', {})
        self.assertTrue(ref_meta.get('protectedObjectsPreserved'))
        self.assertIn('mock-sofa-a', ref_meta.get('protectedObjects', []))

        # Check that sofa position in refined scene is identical to original [-0.8]
        refined_objs = {o['id']: o for o in top_refined['candidate_scene']['objects']}
        self.assertEqual(refined_objs['mock-sofa-a']['position'], [0.0, 0.425, -0.8])
        # Check that coffee table position shifted forward (> 0.25)
        self.assertGreater(refined_objs['mock-table-a']['position'][2], 0.25)

        # CRITICAL VERIFICATION: Canonical Scene in Database was NOT mutated!
        self.design.refresh_from_db()
        self.assertEqual(len(self.design.scene_json['objects']), 2)  # Remains exact initial 2 items
        self.assertEqual(self.design.scene_json['objects'][1]['position'], [0.0, 0.225, 0.25])  # Table in DB untouched!


class Phase74SecurityAndIntegrityTests(APITestCase):
    """
    Adversarial security, multi-user isolation, stale scene concurrency,
    and data integrity verification (Phase 7.4).
    """

    def setUp(self):
        self.user_a = User.objects.create_user(username='user_a', password='password123')
        self.user_b = User.objects.create_user(username='user_b', password='password123')

        self.design_a = Design.objects.create(
            title="User A Living Room",
            owner=self.user_a,
            scene_json={
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [
                    {'id': 'obj-sofa', 'assetId': 'sofa-leather-3seater', 'position': [0, 0.425, -1.0], 'rotationEuler': [0, 0, 0]},
                    {'id': 'obj-table', 'assetId': 'table-oak-coffee', 'position': [0, 0.225, 0.0], 'rotationEuler': [0, 0, 0]},
                ],
                'relationships': [
                    {'anchor_id': 'obj-sofa', 'child_id': 'obj-table', 'socket_id': 'sofa-front-table', 'gap': 0.40}
                ]
            }
        )

        self.design_b = Design.objects.create(
            title="User B Bedroom",
            owner=self.user_b,
            scene_json={
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 4.5, 'length': 4.0, 'height': 2.8},
                'objects': [
                    {'id': 'obj-bed', 'assetId': 'bed-queen-platform', 'position': [0, 0.5, -1.2], 'rotationEuler': [0, 0, 0]}
                ],
                'relationships': []
            }
        )

        self.session_a = AgentSession.objects.create(owner=self.user_a, design=self.design_a)
        self.session_b = AgentSession.objects.create(owner=self.user_b, design=self.design_b)

        cand_a1 = {
            'id': 'cand-user-a-1',
            'label': 'Layout Alpha',
            'is_valid': True,
            'is_approval_eligible': True,
            'score': {'overall': 88.0, 'boundary': 95.0, 'collision': 95.0, 'circulation': 85.0, 'clearance': 85.0, 'utilization': 80.0, 'budget': 90.0},
            'candidate_scene': self.design_a.scene_json,
            'proposed_actions': [{'type': 'move_furniture', 'object_id': 'obj-table', 'new_position': [0, 0.225, 0.3]}],
        }
        cand_a2 = {
            'id': 'cand-user-a-2',
            'label': 'Layout Beta',
            'is_valid': True,
            'is_approval_eligible': True,
            'score': {'overall': 82.0, 'boundary': 90.0, 'collision': 90.0, 'circulation': 80.0, 'clearance': 80.0, 'utilization': 75.0, 'budget': 85.0},
            'candidate_scene': self.design_a.scene_json,
            'proposed_actions': [{'type': 'move_furniture', 'object_id': 'obj-table', 'new_position': [0.2, 0.225, 0.3]}],
        }

        self.run_a = AgentRun.objects.create(
            session=self.session_a,
            user_prompt="Arrange living room",
            status=AgentRun.STATUS_PROPOSED,
            base_scene_snapshot=self.design_a.scene_json,
            validation_results={
                'source_scene_hash': compute_canonical_scene_hash(self.design_a.scene_json),
                'candidates': [cand_a1, cand_a2]
            }
        )

    def test_cross_user_feedback_submission_strictly_denied(self):
        """User B cannot submit feedback against User A's run/candidate."""
        self.client.force_authenticate(user=self.user_b)
        url = reverse('agent-feedback')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-user-a-1',
            'feedback_type': 'liked',
            'structured_reasons': ['good_circulation'],
        }
        res = self.client.post(url, payload, format='json')
        # Expect 404 Not Found (row-level isolation prevents discovering other user's runs)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_cross_user_candidate_explanation_strictly_denied(self):
        """User B cannot access explanations for User A's candidate proposal."""
        self.client.force_authenticate(user=self.user_b)
        url = reverse('agent-candidate-explain', kwargs={'run_id': str(self.run_a.id), 'candidate_id': 'cand-user-a-1'})
        res = self.client.get(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_candidate_id_not_in_run_rejected(self):
        """Submitting feedback for an arbitrary candidate ID not in run returns 400 Bad Request."""
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-feedback')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-fabricated-999',
            'feedback_type': 'liked',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("does not belong to run", res.data['detail'])

    def test_mismatched_design_id_rejected(self):
        """Submitting feedback with a mismatched design ID returns 400 Bad Request."""
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-feedback')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-user-a-1',
            'feedback_type': 'liked',
            'design_id': str(self.design_b.id),  # Belongs to user_b / session_b
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_duplicate_feedback_submission_idempotency(self):
        """Rapid duplicate feedback submissions do not create unbounded rows or runaway weights."""
        self.client.force_authenticate(user=self.user_a)
        url = reverse('agent-feedback')
        payload = {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-user-a-1',
            'feedback_type': 'liked',
            'structured_reasons': ['good_circulation'],
        }
        res1 = self.client.post(url, payload, format='json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        res2 = self.client.post(url, payload, format='json')
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)

        # Count in database should be 1, not 2
        count = UserCandidateFeedback.objects.filter(user=self.user_a, candidate_id='cand-user-a-1').count()
        self.assertEqual(count, 1)

    def test_reset_learned_preferences_preserves_historical_feedback(self):
        """Resetting learned preferences sets weights to neutral but does NOT delete feedback rows."""
        self.client.force_authenticate(user=self.user_a)
        # 1. Submit feedback
        url_fb = reverse('agent-feedback')
        self.client.post(url_fb, {
            'run_id': str(self.run_a.id),
            'candidate_id': 'cand-user-a-1',
            'feedback_type': 'liked',
            'structured_reasons': ['good_circulation'],
        }, format='json')

        self.assertEqual(UserCandidateFeedback.objects.filter(user=self.user_a).count(), 1)

        # 2. Reset preferences
        url_reset = reverse('agent-learned-preferences-reset')
        res_reset = self.client.post(url_reset)
        self.assertEqual(res_reset.status_code, status.HTTP_200_OK)
        self.assertEqual(res_reset.data['adjusted_weights'], {})
        self.assertEqual(res_reset.data['feedback_count'], 0)

        # 3. VERIFY: Historical feedback records are PRESERVED in database!
        self.assertEqual(UserCandidateFeedback.objects.filter(user=self.user_a).count(), 1)

    def test_delete_user_feedback_history_removes_user_data_only(self):
        """Dedicated delete endpoint permanently removes only the requesting user's records."""
        # Record feedback for User A
        UserCandidateFeedback.objects.create(
            user=self.user_a, run=self.run_a, candidate_id='cand-user-a-1', feedback_type='liked'
        )
        # Record feedback for User B
        run_b = AgentRun.objects.create(
            session=self.session_b, status=AgentRun.STATUS_PROPOSED, validation_results={'candidates': []}
        )
        UserCandidateFeedback.objects.create(
            user=self.user_b, run=run_b, candidate_id='cand-b-1', feedback_type='selected'
        )

        self.client.force_authenticate(user=self.user_a)
        url_del = reverse('agent-feedback-history-delete')
        res = self.client.post(url_del)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], 'deleted')

        # User A's feedback is deleted
        self.assertEqual(UserCandidateFeedback.objects.filter(user=self.user_a).count(), 0)
        # User B's feedback remains intact
        self.assertEqual(UserCandidateFeedback.objects.filter(user=self.user_b).count(), 1)

    def test_stale_candidate_apply_rejected(self):
        """Applying a candidate proposal after the canonical scene has changed returns 409 Conflict."""
        self.client.force_authenticate(user=self.user_a)
        url_apply = reverse('agent-run-apply', kwargs={'run_id': str(self.run_a.id)})

        # Simulate concurrent scene modification: User modifies scene before AI apply
        self.design_a.scene_json['objects'].append({
            'id': 'obj-plant', 'assetId': 'plant-potted-ficus', 'position': [1.5, 0.0, 1.0]
        })
        self.design_a.save()

        res = self.client.post(url_apply, {'candidate_id': 'cand-user-a-1'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(res.data.get('stale'))

    def test_protected_object_infeasible_conflict_clarification(self):
        """Conflict between moving and protecting an object produces clear clarification response."""
        self.client.force_authenticate(user=self.user_a)
        url_refine = reverse('agent-candidate-refine', kwargs={'run_id': str(self.run_a.id), 'candidate_id': 'cand-user-a-1'})
        payload = {
            'instruction': 'Keep the sofa where it is, but move the sofa forward.',
        }
        res = self.client.post(url_refine, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get('is_ambiguous'))
        self.assertIn("Cannot move", res.data.get('clarification_prompt', ''))

    def test_exhaustive_protected_object_state_comparison(self):
        """Verifies RefinementRunner.compare_protected_objects_state catches micro-displacements and alterations."""
        from apps.ai_agent.feedback.refinement_runner import RefinementRunner

        base_scene = {
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-leather-3seater',
                    'position': [1.0, 0.425, -1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'dimensions': {'width': 2.1, 'depth': 0.9, 'height': 0.85},
                    'scale': [1.0, 1.0, 1.0],
                    'material': {'color': '#333333'},
                }
            ],
            'relationships': []
        }

        # 1. Exact replica passes
        cand_scene_exact = copy.deepcopy(base_scene)
        ok, violations = RefinementRunner.compare_protected_objects_state(base_scene, cand_scene_exact, {'sofa-1'})
        self.assertTrue(ok)
        self.assertEqual(len(violations), 0)

        # 2. Position displacement > 0.001m fails
        cand_scene_moved = copy.deepcopy(base_scene)
        cand_scene_moved['objects'][0]['position'][0] += 0.002
        ok, violations = RefinementRunner.compare_protected_objects_state(base_scene, cand_scene_moved, {'sofa-1'})
        self.assertFalse(ok)
        self.assertTrue(any('position displaced' in v for v in violations))

        # 3. Asset ID altered fails
        cand_scene_asset = copy.deepcopy(base_scene)
        cand_scene_asset['objects'][0]['assetId'] = 'sofa-fabric-2seater'
        ok, violations = RefinementRunner.compare_protected_objects_state(base_scene, cand_scene_asset, {'sofa-1'})
        self.assertFalse(ok)
        self.assertTrue(any('assetId changed' in v for v in violations))








