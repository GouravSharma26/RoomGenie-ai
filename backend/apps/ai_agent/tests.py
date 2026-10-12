import uuid
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
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

    def test_tools_reject_nonexistent_asset_id(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        actions = [
            {'type': 'add_furniture', 'asset_id': 'totally-fake-nonexistent-asset-id'}
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertIn("does not exist in catalogue", result['errors'][0])

    def test_tools_reject_nonexistent_object_id_on_move(self):
        scene = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [],
        }
        actions = [
            {'type': 'move_object', 'object_id': 'nonexistent-obj', 'position': [1, 0, 1]}
        ]
        result = validate_and_simulate_actions(scene, actions)
        self.assertFalse(result['is_valid'])
        self.assertIn("not found in scene", result['errors'][0])

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

    def test_prompt_endpoint_proposes_actions_without_mutating_design(self):
        self.client.force_authenticate(user=self.user_a)
        prompt_url = reverse('agent-prompt', kwargs={'session_id': str(self.session_a.id)})

        res = self.client.post(prompt_url, {'prompt': 'Add an armchair for reading'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['requires_approval'])

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
