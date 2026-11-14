"""
Phase 8.1: Production Deployment Readiness & Real-World Validation
Automated Backend Test Suite covering Workstreams C (Persistence & Multi-User Isolation),
D (Reliability & Failure Recovery), and G (Security & Operational Readiness).
"""

import json
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.designs.models import Design
from apps.furniture.models import FurnitureAsset
from apps.ai_agent.models import AgentSession, AgentRun, UserDesignPreference
from apps.ai_agent.feedback.feedback_models import (
    UserCandidateFeedback,
    UserPairwiseComparison,
    LearnedPreferenceAdjustment,
)
from apps.ai_agent.feedback.feedback_repository import FeedbackRepository
from apps.ai_agent.candidate_types import (
    LayoutCandidate,
    ScoreBreakdown,
    CandidateValidationFeedback,
    compute_canonical_scene_hash,
)

User = get_user_model()


class Phase81ProductionReadinessBackendTests(TestCase):
    """
    Comprehensive verification of multi-user boundaries, transactional rollbacks,
    stale proposal detection, and failure recovery.
    """

    def setUp(self):
        self.client_a = APIClient()
        self.client_b = APIClient()

        self.user_a = User.objects.create_user(
            username='user_alice',
            email='alice@example.com',
            password='Password123!',
        )
        self.user_b = User.objects.create_user(
            username='user_bob',
            email='bob@example.com',
            password='Password123!',
        )

        self.client_a.force_authenticate(user=self.user_a)
        self.client_b.force_authenticate(user=self.user_b)

        # Seed catalogue assets for simulation
        FurnitureAsset.objects.create(
            id='sofa-nordic',
            name='Nordic Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
        )
        FurnitureAsset.objects.create(
            id='table-coffee-1',
            name='Minimalist Coffee Table',
            category='tables',
            width=Decimal('1.20'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=1500000,
        )

        # Base scene representation
        self.initial_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-base-1',
                    'assetId': 'sofa-nordic',
                    'name': 'Nordic Sofa',
                    'position': [0.0, 0.425, 0.0],
                    'rotation': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                    'dimensions': [2.1, 0.85, 0.9],
                }
            ],
            'relationships': [],
        }

        # User A Design
        self.design_a = Design.objects.create(
            title="Alice's Living Room",
            owner=self.user_a,
            scene_json=self.initial_scene,
            budget=5000000,
        )

        # User B Design
        self.design_b = Design.objects.create(
            title="Bob's Bedroom",
            owner=self.user_b,
            scene_json=self.initial_scene,
            budget=3500000,
        )

        # AI Session & Run for User A
        self.session_a = AgentSession.objects.create(
            owner=self.user_a,
            design=self.design_a,
        )

        self.mock_candidate = {
            'id': 'cand-prod-1',
            'schema_version': 1,
            'label': 'Option A: Valid Living Arrangement',
            'description': 'Balanced seating layout',
            'reasoning_summary': 'Ergonomic clearances maintained',
            'proposed_actions': [
                {
                    'type': 'add_furniture',
                    'asset_id': 'table-coffee-1',
                    'position': [0.0, 0.225, 1.1],
                    'rotation_euler': [0.0, 0.0, 0.0],
                }
            ],
            'candidate_scene': {
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [
                    {
                        'id': 'sofa-base-1',
                        'assetId': 'sofa-nordic',
                        'position': [0.0, 0.425, 0.0],
                        'rotation': [0.0, 0.0, 0.0],
                        'scale': [1.0, 1.0, 1.0],
                        'dimensions': [2.1, 0.85, 0.9],
                    },
                    {
                        'id': 'table-coffee-1',
                        'assetId': 'table-coffee-1',
                        'position': [0.0, 0.225, 1.1],
                        'rotation': [0.0, 0.0, 0.0],
                        'scale': [1.0, 1.0, 1.0],
                        'dimensions': [1.2, 0.45, 0.6],
                    },
                ],
            },
            'is_valid': True,
            'is_approval_eligible': True,
            'score': {
                'boundary': 100.0,
                'collision': 100.0,
                'circulation': 95.0,
                'clearance': 100.0,
                'utilization': 92.0,
                'budget': 100.0,
                'overall': 98.2,
                'weights': {},
            },
            'validation_feedback': {
                'is_valid': True,
                'is_approval_eligible': True,
                'has_collisions': False,
                'has_boundary_breaches': False,
                'is_budget_compliant': True,
                'is_room_passable': True,
                'errors': [],
                'warnings': [],
            },
        }

        self.run_a = AgentRun.objects.create(
            session=self.session_a,
            user_prompt='Add a coffee table in front of sofa',
            status=AgentRun.STATUS_PROPOSED,
            proposed_actions=self.mock_candidate['proposed_actions'],
            base_scene_snapshot=self.initial_scene,
            validation_results={
                'is_valid': True,
                'candidates': [self.mock_candidate],
                'source_scene_hash': compute_canonical_scene_hash(self.initial_scene),
            },
        )

    # =========================================================================
    # WORKSTREAM C: MULTI-USER ISOLATION & PERSISTENCE
    # =========================================================================

    def test_cross_user_design_access_is_forbidden(self):
        """User B cannot view, modify, or delete User A's design."""
        url = reverse('designs:design-detail', kwargs={'pk': self.design_a.id})
        # User B attempt to GET
        res = self.client_b.get(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # User B attempt to PUT
        res = self.client_b.put(url, {'title': 'Hacked Title'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # User B attempt to DELETE
        res = self.client_b.delete(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # Verify Alice's design remains completely intact
        self.design_a.refresh_from_db()
        self.assertEqual(self.design_a.title, "Alice's Living Room")

    def test_cross_user_ai_session_and_run_access_is_forbidden(self):
        """User B cannot trigger prompts or apply proposals on User A's session."""
        prompt_url = reverse('agent-prompt', kwargs={'session_id': self.session_a.id})
        res = self.client_b.post(prompt_url, {'prompt': 'Malicious prompt'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        apply_url = reverse('agent-run-apply', kwargs={'run_id': self.run_a.id})
        res = self.client_b.post(apply_url, {'candidate_id': 'cand-prod-1'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_cross_user_feedback_and_preferences_isolation(self):
        """User B cannot view, modify, or reset User A's learned preferences or feedback."""
        # Alice records feedback
        FeedbackRepository.record_candidate_feedback(
            user=self.user_a,
            run=self.run_a,
            candidate_id='cand-prod-1',
            feedback_type='liked',
            structured_reasons=['better_circulation'],
        )

        # Verify feedback count for Alice is 1, for Bob is 0
        alice_history = FeedbackRepository.get_user_feedback_history(self.user_a)
        bob_history = FeedbackRepository.get_user_feedback_history(self.user_b)
        self.assertEqual(len(alice_history), 1)
        self.assertEqual(len(bob_history), 0)

        # Bob calls delete feedback history endpoint
        delete_url = reverse('agent-feedback-history-delete')
        res = self.client_b.post(delete_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Alice's feedback must remain 100% untouched
        alice_history_after = FeedbackRepository.get_user_feedback_history(self.user_a)
        self.assertEqual(len(alice_history_after), 1)

    # =========================================================================
    # WORKSTREAM D: RELIABILITY, CONCURRENCY & FAILURE RECOVERY
    # =========================================================================

    def test_stale_proposal_conflict_rejection(self):
        """
        If a design scene is modified externally after a proposal was generated,
        the apply endpoint rejects the stale proposal with 409 Conflict.
        """
        # Simulate external modification to Alice's design scene
        modified_scene = dict(self.initial_scene)
        modified_scene['objects'] = list(self.initial_scene['objects']) + [
            {'id': 'lamp-1', 'assetId': 'floor-lamp', 'position': [1.0, 0.7, 1.0], 'dimensions': [0.4, 1.4, 0.4]}
        ]
        self.design_a.scene_json = modified_scene
        self.design_a.save()

        # Alice attempts to apply the older run
        apply_url = reverse('agent-run-apply', kwargs={'run_id': self.run_a.id})
        res = self.client_a.post(apply_url, {'candidate_id': 'cand-prod-1'}, format='json')

        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(res.data.get('stale', False))
        self.assertEqual(res.data.get('code'), 'stale_proposal')

    def test_invalid_candidate_id_returns_400_without_scene_mutation(self):
        """Applying a non-existent candidate ID fails cleanly and leaves scene intact."""
        apply_url = reverse('agent-run-apply', kwargs={'run_id': self.run_a.id})
        res = self.client_a.post(apply_url, {'candidate_id': 'non-existent-candidate'}, format='json')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.design_a.refresh_from_db()
        self.assertEqual(len(self.design_a.scene_json.get('objects', [])), 1)

    def test_successful_apply_persists_authoritatively_with_status_approved(self):
        """
        Applying an approved candidate executes within transaction.atomic()
        and updates the design scene in PostgreSQL authoritatively.
        """
        apply_url = reverse('agent-run-apply', kwargs={'run_id': self.run_a.id})
        res = self.client_a.post(apply_url, {'candidate_id': 'cand-prod-1'}, format='json')

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.run_a.refresh_from_db()
        self.assertEqual(self.run_a.status, AgentRun.STATUS_APPROVED)

        self.design_a.refresh_from_db()
        # Verify the new coffee table was committed to DB
        asset_ids = [o.get('assetId') for o in self.design_a.scene_json.get('objects', [])]
        self.assertIn('table-coffee-1', asset_ids)

    # =========================================================================
    # WORKSTREAM G: SECURITY & INPUT INTEGRITY
    # =========================================================================

    def test_unauthenticated_requests_are_rejected(self):
        """Unauthenticated requests to protected endpoints return 401 Unauthorized."""
        unauthed_client = APIClient()

        res = unauthed_client.get(reverse('designs:design-list'))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

        res = unauthed_client.get(reverse('agent-preferences'))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_public_health_endpoint_remains_accessible_without_leaking_secrets(self):
        """The health check endpoint is public (200 OK) but exposes zero secrets."""
        unauthed_client = APIClient()
        res = unauthed_client.get(reverse('health-check'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data
        self.assertEqual(data.get('status'), 'ok')
        # Ensure sensitive values are NOT in the payload
        self.assertNotIn('SECRET_KEY', data)
        self.assertNotIn('GEMINI_API_KEY', data)
        self.assertNotIn('DB_PASSWORD', data)
        self.assertNotIn('database_url', data)
