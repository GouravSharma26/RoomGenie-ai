import datetime
import hashlib
import json
import uuid
from io import StringIO
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.evaluation.metrics import (
    ASSIGNMENT_SEQUENCES,
    TASK_SPECIFICATIONS,
    calculate_authoritative_session_metrics,
    evaluate_aabb_overlap_pairs_count,
    evaluate_doorway_intrusions_count,
    evaluate_task_success,
    sanitize_scene_snapshot,
    validate_and_sanitize_canonical_scene,
    validate_study_assignment,
)
from apps.evaluation.models import EvaluationSession
from apps.furniture.models import FurnitureAsset


class EvaluationTelemetryTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_superuser(
            username='admin_evaluator',
            email='evaluator@university.edu',
            password='SecurePassword123!'
        )
        self.regular_user = User.objects.create_user(
            username='participant_user',
            email='p01@university.edu',
            password='ParticipantPassword123!'
        )

        # Ensure catalogue assets required by living_room and home_study exist
        self.sofa = FurnitureAsset.objects.create(
            id='sofa-modern-3seater',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=2.1,
            height=0.85,
            depth=0.9,
            price_paise=2999900
        )
        self.coffee_table = FurnitureAsset.objects.create(
            id='table-oak-coffee',
            name='Minimalist Coffee Table',
            category='tables',
            width=1.2,
            height=0.45,
            depth=0.6,
            price_paise=849900
        )
        self.armchair = FurnitureAsset.objects.create(
            id='chair-accent-armchair',
            name='Lounge Accent Armchair',
            category='seating',
            width=0.85,
            height=0.88,
            depth=0.85,
            price_paise=1199900
        )
        self.planter = FurnitureAsset.objects.create(
            id='decor-plant-floor-vase',
            name='Botanical Floor Planter',
            category='decor',
            width=0.4,
            height=0.9,
            depth=0.4,
            price_paise=249900
        )
        self.bookshelf = FurnitureAsset.objects.create(
            id='storage-bookshelf-tall',
            name='4-Tier Bookshelf',
            category='storage',
            width=1.0,
            height=1.8,
            depth=0.35,
            price_paise=1649900
        )
        self.study_desk = FurnitureAsset.objects.create(
            id='desk-workspace-study',
            name='Study Desk',
            category='tables',
            width=1.4,
            height=0.75,
            depth=0.7,
            price_paise=1499900
        )

    def test_telemetry_disabled_by_default_rejects_requests(self):
        """When ENABLE_EVALUATION_TELEMETRY is False (default), endpoints return 403 Forbidden."""
        with override_settings(ENABLE_EVALUATION_TELEMETRY=False):
            session_id = str(uuid.uuid4())
            resp = self.client.post(
                reverse('evaluation:session-start'),
                {
                    'sessionId': session_id,
                    'participantId': 'P01',
                    'condition': 'manual',
                    'sequenceOrder': 'G1',
                    'taskName': 'living_room',
                },
                format='json'
            )
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
            self.assertIn("disabled", resp.data['detail'].lower())

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_start_session_creation_idempotency_and_mismatched_rejection(self):
        """
        Start endpoint creates session, issues capability secret, returns 200 on identical retry,
        and rejects requests with mismatched assignment parameters with 409 Conflict.
        """
        session_id = str(uuid.uuid4())
        payload = {
            'sessionId': session_id,
            'participantId': 'P01',
            'condition': 'manual',
            'sequenceOrder': 'G1',
            'taskName': 'living_room',
        }

        # 1. First start request creates session and returns sessionSecret
        resp1 = self.client.post(reverse('evaluation:session-start'), payload, format='json')
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp1.data['sessionId'], session_id)
        self.assertEqual(resp1.data['sessionStatus'], 'in_progress')
        self.assertEqual(resp1.data['checkpointSequence'], 0)
        self.assertEqual(resp1.data['trialPeriod'], 1)  # G1 manual living_room is Period 1
        self.assertIn('sessionSecret', resp1.data)
        secret = resp1.data['sessionSecret']

        # 2. Idempotent retry with same UUID and matching parameters returns existing record (200)
        resp2 = self.client.post(reverse('evaluation:session-start'), payload, format='json')
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(resp2.data['sessionId'], session_id)
        self.assertEqual(EvaluationSession.objects.filter(id=session_id).count(), 1)

        # 3. Mismatched participantId with same UUID returns 409 Conflict
        mismatched_p = dict(payload)
        mismatched_p['participantId'] = 'P99'
        resp_p = self.client.post(reverse('evaluation:session-start'), mismatched_p, format='json')
        self.assertEqual(resp_p.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("participantId", resp_p.data['error'])

        # 4. Mismatched condition with same UUID returns 409 Conflict
        # Note: G1 with ai_assisted + home_study is valid G1 assignment, but differs from existing session
        mismatched_c = {
            'sessionId': session_id,
            'participantId': 'P01',
            'condition': 'ai_assisted',
            'sequenceOrder': 'G1',
            'taskName': 'home_study',
        }
        resp_c = self.client.post(reverse('evaluation:session-start'), mismatched_c, format='json')
        self.assertEqual(resp_c.status_code, status.HTTP_409_CONFLICT)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_start_session_concurrency_race_handling(self):
        """Simultaneous start requests with the same UUID are handled concurrency-safely without crashes."""
        import concurrent.futures

        s_id = str(uuid.uuid4())
        payload = {
            'sessionId': s_id,
            'participantId': 'P_CONCURRENCY',
            'condition': 'manual',
            'sequenceOrder': 'G1',
            'taskName': 'living_room',
        }

        def _make_call():
            local_client = APIClient()
            return local_client.post(reverse('evaluation:session-start'), payload, format='json')

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(_make_call) for _ in range(2)]
            results = [f.result() for f in futures]

        status_codes = sorted([r.status_code for r in results])
        # Both must succeed (200 OK or 201 CREATED), never 500 Internal Server Error
        self.assertEqual(status_codes, [status.HTTP_200_OK, status.HTTP_201_CREATED])
        self.assertEqual(EvaluationSession.objects.filter(id=s_id).count(), 1)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_start_session_sequence_group_counterbalance_validation(self):
        """
        Start endpoint strictly enforces pre-registered 4-sequence crossover assignment:
        - G1: P1=(manual, living_room), P2=(ai_assisted, home_study)
        - G2: P1=(ai_assisted, living_room), P2=(manual, home_study)
        - G3: P1=(manual, home_study), P2=(ai_assisted, living_room)
        - G4: P1=(ai_assisted, home_study), P2=(manual, living_room)
        Rejects invalid combinations and invalid explicit trialPeriod with 400 Bad Request.
        """
        # Test valid assignments for all 4 groups
        valid_cases = [
            ('G1', 'manual', 'living_room', 1),
            ('G1', 'ai_assisted', 'home_study', 2),
            ('G2', 'ai_assisted', 'living_room', 1),
            ('G2', 'manual', 'home_study', 2),
            ('G3', 'manual', 'home_study', 1),
            ('G3', 'ai_assisted', 'living_room', 2),
            ('G4', 'ai_assisted', 'home_study', 1),
            ('G4', 'manual', 'living_room', 2),
        ]
        for seq, cond, task, expected_period in valid_cases:
            s_id = str(uuid.uuid4())
            resp = self.client.post(
                reverse('evaluation:session-start'),
                {
                    'sessionId': s_id,
                    'participantId': f'P_{seq}_{expected_period}',
                    'condition': cond,
                    'sequenceOrder': seq,
                    'taskName': task,
                },
                format='json'
            )
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED, f"Failed for {seq} {cond} {task}")
            self.assertEqual(resp.data['trialPeriod'], expected_period)

        # Test invalid assignment combinations (violating group assignment)
        invalid_cases = [
            ('G1', 'ai_assisted', 'living_room'),  # G1 only has manual living_room
            ('G2', 'manual', 'living_room'),       # G2 only has ai_assisted living_room
            ('G3', 'ai_assisted', 'home_study'),   # G3 only has manual home_study
            ('G4', 'manual', 'home_study'),        # G4 only has ai_assisted home_study
        ]
        for seq, cond, task in invalid_cases:
            s_id = str(uuid.uuid4())
            resp = self.client.post(
                reverse('evaluation:session-start'),
                {
                    'sessionId': s_id,
                    'participantId': 'P_INVALID',
                    'condition': cond,
                    'sequenceOrder': seq,
                    'taskName': task,
                },
                format='json'
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, f"Expected 400 for {seq} {cond} {task}")

        # Test contradictory explicit trialPeriod
        s_id = str(uuid.uuid4())
        resp = self.client.post(
            reverse('evaluation:session-start'),
            {
                'sessionId': s_id,
                'participantId': 'P_CONTRADICT',
                'condition': 'manual',
                'sequenceOrder': 'G1',
                'taskName': 'living_room',
                'trialPeriod': 2,  # Contradicts Period 1
            },
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_checkpoint_revision_ordering_and_capability_authorization(self):
        """
        Checkpoints must require valid capability session secret, and adhere to revision ordering:
        - Missing or invalid secret returns 403 Forbidden.
        - seq > current updates revision and state.
        - seq == current is an idempotent no-op (200).
        - seq < current is stale ignored (200).
        """
        # Start a real session to obtain capability secret
        s_id = str(uuid.uuid4())
        start_resp = self.client.post(
            reverse('evaluation:session-start'),
            {
                'sessionId': s_id,
                'participantId': 'P02',
                'condition': 'manual',
                'sequenceOrder': 'G1',
                'taskName': 'living_room',
            },
            format='json'
        )
        self.assertEqual(start_resp.status_code, status.HTTP_201_CREATED)
        secret = start_resp.data['sessionSecret']

        url = reverse('evaluation:session-checkpoint', kwargs={'session_id': s_id})

        # 1. Checkpoint without secret is rejected with 403 Forbidden
        unauth_resp = self.client.patch(url, {'checkpointSequence': 1}, format='json')
        self.assertEqual(unauth_resp.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Checkpoint with wrong secret is rejected with 403 Forbidden
        wrong_resp = self.client.patch(
            url,
            {'checkpointSequence': 1},
            format='json',
            HTTP_X_SESSION_SECRET='invalid_secret_token_123'
        )
        self.assertEqual(wrong_resp.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Valid Checkpoint 1 (seq=1)
        snapshot_seq1 = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Sofa',
                    'position': [0.0, 0.425, -1.0],
                    'dimensions': [2.1, 0.85, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                }
            ]
        }
        resp1 = self.client.patch(
            url,
            {
                'checkpointSequence': 1,
                'totalEdits': 3,
                'undoRedoCount': 1,
                'activeDurationSeconds': 30.5,
                'checkpointSceneSnapshot': snapshot_seq1,
            },
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )
        self.assertEqual(resp1.status_code, status.HTTP_200_OK)

        session = EvaluationSession.objects.get(id=s_id)
        self.assertEqual(session.checkpoint_sequence, 1)
        self.assertEqual(session.total_edits, 3)

        # 4. Checkpoint 2 (seq=2)
        resp2 = self.client.patch(
            url,
            {
                'checkpointSequence': 2,
                'totalEdits': 5,
            },
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.checkpoint_sequence, 2)
        self.assertEqual(session.total_edits, 5)

        # 5. Stale packet arriving with seq=1 after seq=2 committed is safely ignored
        stale_resp = self.client.patch(
            url,
            {
                'checkpointSequence': 1,
                'totalEdits': 999,  # Must NOT overwrite
            },
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )
        self.assertEqual(stale_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(stale_resp.data['status'], 'stale_ignored')
        session.refresh_from_db()
        self.assertEqual(session.checkpoint_sequence, 2)
        self.assertEqual(session.total_edits, 5)

        # 6. Idempotent retry with seq=2
        retry_resp = self.client.patch(
            url,
            {'checkpointSequence': 2},
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )
        self.assertEqual(retry_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(retry_resp.data['status'], 'idempotent_noop')

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_partial_checkpoint_and_completion_preserves_recorded_counters(self):
        """
        Sparse checkpoints and completions must NOT reset or erase previously recorded counters.
        Omitted fields must preserve existing stored values.
        """
        s_id = str(uuid.uuid4())
        start_resp = self.client.post(
            reverse('evaluation:session-start'),
            {
                'sessionId': s_id,
                'participantId': 'P03',
                'condition': 'manual',
                'sequenceOrder': 'G1',
                'taskName': 'living_room',
            },
            format='json'
        )
        secret = start_resp.data['sessionSecret']

        # Checkpoint 1: sets totalEdits=15, undoRedoCount=4, activeDurationSeconds=120.0, idleIntervals
        self.client.patch(
            reverse('evaluation:session-checkpoint', kwargs={'session_id': s_id}),
            {
                'checkpointSequence': 1,
                'totalEdits': 15,
                'undoRedoCount': 4,
                'activeDurationSeconds': 120.0,
                'idleIntervals': [{'startOffsetSeconds': 30.0, 'durationSeconds': 20.0}],
            },
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )

        session = EvaluationSession.objects.get(id=s_id)
        self.assertEqual(session.total_edits, 15)
        self.assertEqual(session.undo_redo_count, 4)
        self.assertEqual(session.active_duration_seconds, 120.0)
        self.assertEqual(session.total_idle_duration_seconds, 20.0)

        # Checkpoint 2: sparse update with only checkpointSequence=2 (omits totalEdits, idleIntervals)
        self.client.patch(
            reverse('evaluation:session-checkpoint', kwargs={'session_id': s_id}),
            {'checkpointSequence': 2},
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )

        session.refresh_from_db()
        self.assertEqual(session.checkpoint_sequence, 2)
        # Verify counters were PRESERVED and not reset to 0
        self.assertEqual(session.total_edits, 15)
        self.assertEqual(session.undo_redo_count, 4)
        self.assertEqual(session.active_duration_seconds, 120.0)
        self.assertEqual(session.total_idle_duration_seconds, 20.0)

        # Complete session: provides finalSceneSnapshot but omits totalEdits, undoRedoCount, idleIntervals
        valid_final_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Sofa',
                    'position': [0.0, 0.425, -1.2],
                    'dimensions': [2.1, 0.85, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'table-1',
                    'assetId': 'table-oak-coffee',
                    'name': 'Table',
                    'position': [0.0, 0.225, 0.0],
                    'dimensions': [1.2, 0.45, 0.6],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'chair-1',
                    'assetId': 'chair-accent-armchair',
                    'name': 'Armchair',
                    'position': [-1.5, 0.44, 0.0],
                    'dimensions': [0.85, 0.88, 0.85],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'plant-1',
                    'assetId': 'decor-plant-floor-vase',
                    'name': 'Planter',
                    'position': [1.8, 0.45, -1.5],
                    'dimensions': [0.4, 0.9, 0.4],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
            ]
        }
        complete_resp = self.client.post(
            reverse('evaluation:session-complete', kwargs={'session_id': s_id}),
            {'finalSceneSnapshot': valid_final_scene},
            format='json',
            HTTP_X_SESSION_SECRET=secret
        )
        self.assertEqual(complete_resp.status_code, status.HTTP_200_OK)

        session.refresh_from_db()
        self.assertEqual(session.session_status, 'completed')
        # All counters originally accumulated in checkpoints are strictly preserved
        self.assertEqual(session.total_edits, 15)
        self.assertEqual(session.undo_redo_count, 4)
        self.assertEqual(session.total_idle_duration_seconds, 20.0)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_canonical_scene_validation_rejects_malformed_and_wrong_dimensions(self):
        """
        validate_and_sanitize_canonical_scene rejects malformed structures, empty dicts,
        duplicate placement IDs, and task-dimension mismatches.
        """
        # 1. Empty dict rejected
        with self.assertRaises(ValueError):
            validate_and_sanitize_canonical_scene({}, expected_task_name='living_room')

        # 2. Invalid schemaVersion rejected
        with self.assertRaises(ValueError):
            validate_and_sanitize_canonical_scene(
                {'schemaVersion': 99, 'unit': 'm', 'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []},
                expected_task_name='living_room'
            )

        # 3. Invalid unit rejected
        with self.assertRaises(ValueError):
            validate_and_sanitize_canonical_scene(
                {'schemaVersion': 1, 'unit': 'feet', 'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []},
                expected_task_name='living_room'
            )

        # 4. Mismatched room dimensions (Living room 5x4 submitted for Home study 4.5x3.5) rejected
        with self.assertRaises(ValueError) as ctx:
            validate_and_sanitize_canonical_scene(
                {
                    'schemaVersion': 1,
                    'unit': 'm',
                    'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                    'objects': []
                },
                expected_task_name='home_study'
            )
        self.assertIn("do not match required dimensions for task 'home_study'", str(ctx.exception))

        # 5. Duplicate placement IDs rejected
        dup_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'same-id',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Sofa 1',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'same-id',
                    'assetId': 'table-oak-coffee',
                    'name': 'Table',
                    'dimensions': [1.2, 0.45, 0.6],
                    'position': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
            ]
        }
        with self.assertRaises(ValueError) as ctx_dup:
            validate_and_sanitize_canonical_scene(dup_scene, expected_task_name='living_room')
        self.assertIn("Duplicate placement ID", str(ctx_dup.exception))

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_composite_task_success_exact_four_items_and_h04(self):
        """
        evaluate_task_success enforces exact 4 items (3 fixed + 1 choice), budget compliance,
        zero doorway intrusions, and zero out-of-bounds violations.
        Confirms AABB overlap count is exploratory (E1) and does NOT disqualify H04.
        """
        # Base valid 4-item living room objects
        valid_objects = [
            {'assetId': 'sofa-modern-3seater', 'dimensions': [2.1, 0.85, 0.9], 'position': [0.0, 0.425, -1.2], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            {'assetId': 'table-oak-coffee', 'dimensions': [1.2, 0.45, 0.6], 'position': [0.0, 0.225, 0.0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            {'assetId': 'chair-accent-armchair', 'dimensions': [0.85, 0.88, 0.85], 'position': [-1.5, 0.44, 0.0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            {'assetId': 'decor-plant-floor-vase', 'dimensions': [0.4, 0.9, 0.4], 'position': [1.8, 0.45, -1.5], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
        ]

        # 1. Exact 4 compliant items = SUCCESS
        self.assertTrue(
            evaluate_task_success(
                'living_room',
                valid_objects,
                is_budget_compliant=True,
                doorway_intrusions_count=0,
                final_scene_out_of_bounds_count=0
            )
        )

        # 2. Only 3 items placed = FAILS
        self.assertFalse(
            evaluate_task_success(
                'living_room',
                valid_objects[:3],
                is_budget_compliant=True,
                doorway_intrusions_count=0,
                final_scene_out_of_bounds_count=0
            )
        )

        # 3. 5 items placed = FAILS (must be EXACTLY 4)
        extra_objects = valid_objects + [{'assetId': 'storage-bookshelf-tall', 'dimensions': [1,1.8,0.35], 'position': [0,0,0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]}]
        self.assertFalse(
            evaluate_task_success(
                'living_room',
                extra_objects,
                is_budget_compliant=True,
                doorway_intrusions_count=0,
                final_scene_out_of_bounds_count=0
            )
        )

        # 4. 4 items with non-permitted choice item = FAILS
        wrong_choice = valid_objects[:3] + [{'assetId': 'desk-workspace-study', 'dimensions': [1.4,0.75,0.7], 'position': [0,0,0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]}]
        self.assertFalse(
            evaluate_task_success(
                'living_room',
                wrong_choice,
                is_budget_compliant=True,
                doorway_intrusions_count=0,
                final_scene_out_of_bounds_count=0
            )
        )

        # 5. Doorway intrusion > 0 = FAILS
        self.assertFalse(
            evaluate_task_success(
                'living_room',
                valid_objects,
                is_budget_compliant=True,
                doorway_intrusions_count=1,
                final_scene_out_of_bounds_count=0
            )
        )

        # 6. Out of bounds > 0 = FAILS
        self.assertFalse(
            evaluate_task_success(
                'living_room',
                valid_objects,
                is_budget_compliant=True,
                doorway_intrusions_count=0,
                final_scene_out_of_bounds_count=1
            )
        )

        # 7. AABB overlap pairs present but no doorway intrusion and budget compliant = SUCCESS
        # (AABB overlaps are exploratory metric E1 and not a failure criterion for H04)
        overlap_objects = [
            {'assetId': 'sofa-modern-3seater', 'dimensions': [2.1, 0.85, 0.9], 'position': [0.0, 0.425, -1.2], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            {'assetId': 'table-oak-coffee', 'dimensions': [1.2, 0.45, 0.6], 'position': [0.0, 0.225, 0.0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            # Chair overlapping coffee table
            {'assetId': 'chair-accent-armchair', 'dimensions': [0.85, 0.88, 0.85], 'position': [0.1, 0.35, 0.05], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            {'assetId': 'decor-plant-floor-vase', 'dimensions': [0.4, 0.9, 0.4], 'position': [1.8, 0.45, -1.5], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
        ]
        overlap_count = evaluate_aabb_overlap_pairs_count(overlap_objects)
        self.assertGreaterEqual(overlap_count, 1)
        self.assertTrue(
            evaluate_task_success(
                'living_room',
                overlap_objects,
                is_budget_compliant=True,
                doorway_intrusions_count=0,
                final_scene_out_of_bounds_count=0
            )
        )

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_unknown_catalogue_price_fails_budget_compliance(self):
        """If any placed asset has an unknown catalogue price, budget compliance cannot be assumed and must be False."""
        unpriced_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {'id': '1', 'assetId': 'sofa-modern-3seater', 'name': 'Sofa', 'dimensions': [2.1, 0.85, 0.9], 'position': [0, 0.425, -1.2], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
                {'id': '2', 'assetId': 'table-oak-coffee', 'name': 'Table', 'dimensions': [1.2, 0.45, 0.6], 'position': [0, 0.225, 0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
                {'id': '3', 'assetId': 'chair-accent-armchair', 'name': 'Armchair', 'dimensions': [0.85, 0.88, 0.85], 'position': [-1.5, 0.44, 0], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
                # Unknown/unregistered asset
                {'id': '4', 'assetId': 'mystery-unpriced-item', 'name': 'Mystery', 'dimensions': [0.4, 0.9, 0.4], 'position': [1.8, 0.45, -1.5], 'scale': [1,1,1], 'rotationEuler': [0,0,0]},
            ]
        }
        metrics = calculate_authoritative_session_metrics('living_room', unpriced_scene)
        self.assertFalse(metrics['is_budget_compliant'])
        self.assertFalse(metrics['is_task_successful'])

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_stale_session_reaper_management_command(self):
        """
        Management command reap_stale_evaluation_sessions marks in_progress sessions inactive for
        > 30 minutes as aborted with abort_reason='inactivity_timeout' and preserves dropout snapshots.
        """
        now = timezone.now()
        forty_mins_ago = now - datetime.timedelta(minutes=40)
        five_mins_ago = now - datetime.timedelta(minutes=5)

        # 1. Stale in-progress session with checkpoint snapshot
        stale_session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P_STALE',
            condition='manual',
            sequence_order='G1',
            task_name='living_room',
            session_status='in_progress',
            checkpoint_scene_snapshot={'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': []},
        )
        EvaluationSession.objects.filter(id=stale_session.id).update(updated_at=forty_mins_ago)

        # 2. Fresh in-progress session (active recently)
        fresh_session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P_FRESH',
            condition='manual',
            sequence_order='G1',
            task_name='living_room',
            session_status='in_progress',
        )
        EvaluationSession.objects.filter(id=fresh_session.id).update(updated_at=five_mins_ago)

        # 3. Completed session (should never be touched by reaper)
        completed_session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P_COMPLETED',
            condition='manual',
            sequence_order='G1',
            task_name='living_room',
            session_status='completed',
        )
        EvaluationSession.objects.filter(id=completed_session.id).update(updated_at=forty_mins_ago)

        # Execute reaper command
        out = StringIO()
        call_command('reap_stale_evaluation_sessions', timeout_minutes=30, stdout=out)

        stale_session.refresh_from_db()
        fresh_session.refresh_from_db()
        completed_session.refresh_from_db()

        # Stale session must be aborted with inactivity_timeout and checkpoint snapshot preserved
        self.assertEqual(stale_session.session_status, 'aborted')
        self.assertEqual(stale_session.abort_reason, 'inactivity_timeout')
        self.assertIsNotNone(stale_session.aborted_at)
        self.assertIsNotNone(stale_session.checkpoint_scene_snapshot)
        self.assertIsNone(stale_session.final_scene_snapshot)

        # Fresh session remains in_progress
        self.assertEqual(fresh_session.session_status, 'in_progress')

        # Completed session remains completed
        self.assertEqual(completed_session.session_status, 'completed')

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_privacy_and_asset_url_exclusion_invariants(self):
        """
        Snapshots strictly strip modelUrl, thumbnail, blob URLs, and reject credentials
        in retained string fields (id, assetId, name, materialOverrides.color, reconstructionJobId).
        """
        # 1. Normal snapshot with modelUrl and thumbnail: stripped cleanly
        cleanable_snapshot = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'item-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Sofa',
                    'position': [0.0, 0.425, 0.0],
                    'dimensions': [2.1, 0.85, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'modelUrl': 'https://s3.amazonaws.com/private-bucket/sofa.glb?token=secret123',
                    'thumbnail': 'blob:http://localhost:5173/uuid-blob-1234',
                }
            ]
        }
        sanitized = validate_and_sanitize_canonical_scene(cleanable_snapshot, expected_task_name='living_room')
        obj = sanitized['objects'][0]
        self.assertNotIn('modelUrl', obj)
        self.assertNotIn('thumbnail', obj)

        # 2. Injected URLs or credential strings in retained fields are caught and rejected
        injected_fields = [
            ('id', 'item-https://malicious.com?token=secret'),
            ('assetId', 'sofa?sig=signature123'),
            ('name', 'Sofa bearer token=xyz'),
            ('materialOverrides', {'color': 'https://evil.com/color'}),
            ('reconstructionJobId', 'uuid-blob:http://token=secret'),
        ]

        for field_name, bad_value in injected_fields:
            tainted = json.loads(json.dumps(cleanable_snapshot))
            del tainted['objects'][0]['modelUrl']
            del tainted['objects'][0]['thumbnail']

            if field_name == 'materialOverrides':
                tainted['objects'][0]['materialOverrides'] = bad_value
            else:
                tainted['objects'][0][field_name] = bad_value

            with self.assertRaises(ValueError, msg=f"Should have failed for tainted field {field_name}"):
                validate_and_sanitize_canonical_scene(tainted, expected_task_name='living_room')

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_export_dataset_filtering_by_status_condition_task(self):
        """Export view and management command support filtering by condition, task, and status."""
        # Session 1: completed manual living_room
        EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P01',
            condition='manual',
            sequence_order='G1',
            trial_period=1,
            task_name='living_room',
            session_status='completed',
            budget_total_paise=5299600,
        )
        # Session 2: in_progress ai_assisted home_study
        EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P02',
            condition='ai_assisted',
            sequence_order='G1',
            trial_period=2,
            task_name='home_study',
            session_status='in_progress',
        )
        # Session 3: aborted manual home_study
        EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P03',
            condition='manual',
            sequence_order='G3',
            trial_period=1,
            task_name='home_study',
            session_status='aborted',
            abort_reason='user_cancelled',
        )

        self.client.force_authenticate(user=self.admin_user)
        export_url = reverse('evaluation:dataset-export')

        # Filter by status=completed
        resp_completed = self.client.get(f"{export_url}?format=json&status=completed")
        data_completed = json.loads(resp_completed.content)
        self.assertEqual(len(data_completed), 1)
        self.assertEqual(data_completed[0]['participantId'], 'P01')
        self.assertEqual(data_completed[0]['trialPeriod'], 1)

        # Filter by status=aborted
        resp_aborted = self.client.get(f"{export_url}?format=json&status=aborted")
        data_aborted = json.loads(resp_aborted.content)
        self.assertEqual(len(data_aborted), 1)
        self.assertEqual(data_aborted[0]['participantId'], 'P03')

        # Filter by status=in_progress
        resp_in_progress = self.client.get(f"{export_url}?format=json&status=in_progress")
        data_in_progress = json.loads(resp_in_progress.content)
        self.assertEqual(len(data_in_progress), 1)
        self.assertEqual(data_in_progress[0]['participantId'], 'P02')

        # Management command with --status=completed
        out = StringIO()
        call_command('export_evaluation_dataset', '--format=json', '--status=completed', stdout=out)
        cmd_data = json.loads(out.getvalue())
        self.assertEqual(len(cmd_data), 1)
        self.assertEqual(cmd_data[0]['participantId'], 'P01')

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_terminal_state_immutability_and_race_protection(self):
        """Once completed or aborted, session cannot be modified by subsequent checkpoints or completions."""
        session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P03',
            condition='manual',
            sequence_order='G1',
            trial_period=1,
            task_name='living_room',
            session_status='in_progress',
            budget_ceiling_paise=6000000,
        )

        valid_final_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Sofa',
                    'position': [0.0, 0.425, -1.2],
                    'dimensions': [2.1, 0.85, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'table-1',
                    'assetId': 'table-oak-coffee',
                    'name': 'Table',
                    'position': [0.0, 0.225, 0.0],
                    'dimensions': [1.2, 0.45, 0.6],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'chair-1',
                    'assetId': 'chair-accent-armchair',
                    'name': 'Armchair',
                    'position': [-1.5, 0.44, 0.0],
                    'dimensions': [0.85, 0.88, 0.85],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'plant-1',
                    'assetId': 'decor-plant-floor-vase',
                    'name': 'Planter',
                    'position': [1.8, 0.45, -1.5],
                    'dimensions': [0.4, 0.9, 0.4],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
            ]
        }

        # 1. Complete the session
        complete_resp = self.client.post(
            reverse('evaluation:session-complete', kwargs={'session_id': session.id}),
            {
                'finalSceneSnapshot': valid_final_scene,
                'totalEdits': 12,
                'undoRedoCount': 2,
                'activeDurationSeconds': 180.0,
            },
            format='json'
        )
        self.assertEqual(complete_resp.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.session_status, 'completed')

        # 2. Late in-flight checkpoint arriving after completion must be rejected with 409 Conflict
        late_checkpoint_resp = self.client.patch(
            reverse('evaluation:session-checkpoint', kwargs={'session_id': session.id}),
            {
                'checkpointSequence': 10,
                'totalEdits': 999,
            },
            format='json'
        )
        self.assertEqual(late_checkpoint_resp.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("terminal state", late_checkpoint_resp.data['error'])

        # 3. Repeated complete call must also return 409 Conflict
        repeat_complete_resp = self.client.post(
            reverse('evaluation:session-complete', kwargs={'session_id': session.id}),
            {'finalSceneSnapshot': valid_final_scene},
            format='json'
        )
        self.assertEqual(repeat_complete_resp.status_code, status.HTTP_409_CONFLICT)

        # 4. Attempt to abort completed session must also return 409 Conflict
        abort_resp = self.client.post(
            reverse('evaluation:session-abort', kwargs={'session_id': session.id}),
            {'abortReason': 'user_cancelled'},
            format='json'
        )
        self.assertEqual(abort_resp.status_code, status.HTTP_409_CONFLICT)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_abort_session_lifecycle_preserves_checkpoint_snapshot(self):
        """Aborted session preserves last checkpointSceneSnapshot for dropout analysis and remains immutable."""
        session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P05',
            condition='manual',
            sequence_order='G1',
            trial_period=1,
            task_name='living_room',
            session_status='in_progress',
        )

        checkpoint_snapshot = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'sofa-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Sofa',
                    'position': [0.0, 0.425, 0.0],
                    'dimensions': [2.1, 0.85, 0.9],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                }
            ]
        }

        # 1. Dispatch checkpoint
        self.client.patch(
            reverse('evaluation:session-checkpoint', kwargs={'session_id': session.id}),
            {
                'checkpointSequence': 1,
                'activeDurationSeconds': 45.0,
                'totalEdits': 4,
                'checkpointSceneSnapshot': checkpoint_snapshot,
            },
            format='json'
        )

        # 2. Abort the session
        abort_resp = self.client.post(
            reverse('evaluation:session-abort', kwargs={'session_id': session.id}),
            {'abortReason': 'user_cancelled'},
            format='json'
        )
        self.assertEqual(abort_resp.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.session_status, 'aborted')
        self.assertEqual(session.abort_reason, 'user_cancelled')
        self.assertIsNotNone(session.aborted_at)
        self.assertIsNotNone(session.duration_seconds)
        # Checkpoint snapshot is preserved
        self.assertIsNotNone(session.checkpoint_scene_snapshot)
        self.assertEqual(len(session.checkpoint_scene_snapshot['objects']), 1)
        # Final snapshot remains None
        self.assertIsNone(session.final_scene_snapshot)

        # 3. Post-abort checkpoint rejected with 409 Conflict
        late_checkpoint = self.client.patch(
            reverse('evaluation:session-checkpoint', kwargs={'session_id': session.id}),
            {'checkpointSequence': 2},
            format='json'
        )
        self.assertEqual(late_checkpoint.status_code, status.HTTP_409_CONFLICT)
