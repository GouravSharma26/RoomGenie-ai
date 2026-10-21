import json
import uuid
from io import StringIO
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.evaluation.metrics import (
    TASK_SPECIFICATIONS,
    calculate_authoritative_session_metrics,
    evaluate_aabb_overlap_pairs_count,
    evaluate_doorway_intrusions_count,
    evaluate_task_success,
    sanitize_scene_snapshot,
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
    def test_start_session_creation_and_idempotency(self):
        """Start endpoint creates session and returns 200 on identical UUID retry without duplicates."""
        session_id = str(uuid.uuid4())
        payload = {
            'sessionId': session_id,
            'participantId': 'P01',
            'condition': 'manual',
            'sequenceOrder': 'G1',
            'taskName': 'living_room',
        }

        # 1. First start request creates session
        resp1 = self.client.post(reverse('evaluation:session-start'), payload, format='json')
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp1.data['sessionId'], session_id)
        self.assertEqual(resp1.data['sessionStatus'], 'in_progress')
        self.assertEqual(resp1.data['checkpointSequence'], 0)
        self.assertEqual(resp1.data['budgetCeilingPaise'], 6000000)

        # Verify DB record exists
        self.assertEqual(EvaluationSession.objects.filter(id=session_id).count(), 1)
        original_start_time = resp1.data['startTime']

        # 2. Idempotent retry with same UUID returns existing record without creating duplicate
        resp2 = self.client.post(reverse('evaluation:session-start'), payload, format='json')
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(resp2.data['sessionId'], session_id)
        self.assertEqual(resp2.data['startTime'], original_start_time)
        self.assertEqual(EvaluationSession.objects.filter(id=session_id).count(), 1)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_checkpoint_revision_ordering_and_stale_request_handling(self):
        """
        Checkpoints must adhere to revision ordering:
        - newer sequence updates state and sequence counter
        - identical sequence is handled as harmless no-op
        - older/stale sequence is safely ignored without overwriting newer state
        """
        session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P02',
            condition='ai_assisted',
            sequence_order='G2',
            task_name='living_room',
            session_status='in_progress',
            checkpoint_sequence=0,
        )
        url = reverse('evaluation:session-checkpoint', kwargs={'session_id': session.id})

        # 1. Checkpoint 1 (seq=1)
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
            format='json'
        )
        self.assertEqual(resp1.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.checkpoint_sequence, 1)
        self.assertEqual(session.total_edits, 3)
        self.assertEqual(len(session.checkpoint_scene_snapshot['objects']), 1)

        # 2. Checkpoint 2 (seq=2)
        snapshot_seq2 = {
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
                },
                {
                    'id': 'table-1',
                    'assetId': 'table-oak-coffee',
                    'name': 'Table',
                    'position': [0.0, 0.225, 0.0],
                    'dimensions': [1.2, 0.45, 0.6],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                }
            ]
        }
        resp2 = self.client.patch(
            url,
            {
                'checkpointSequence': 2,
                'totalEdits': 5,
                'undoRedoCount': 1,
                'activeDurationSeconds': 60.0,
                'checkpointSceneSnapshot': snapshot_seq2,
            },
            format='json'
        )
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.checkpoint_sequence, 2)
        self.assertEqual(session.total_edits, 5)
        self.assertEqual(len(session.checkpoint_scene_snapshot['objects']), 2)

        # 3. Delayed stale packet arriving with seq=1 after seq=2 has already been committed
        stale_resp = self.client.patch(
            url,
            {
                'checkpointSequence': 1,
                'totalEdits': 999,  # Should NOT overwrite
                'checkpointSceneSnapshot': snapshot_seq1,
            },
            format='json'
        )
        self.assertEqual(stale_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(stale_resp.data['status'], 'stale_ignored')
        session.refresh_from_db()
        # Verify state was NOT overwritten by stale packet
        self.assertEqual(session.checkpoint_sequence, 2)
        self.assertEqual(session.total_edits, 5)
        self.assertEqual(len(session.checkpoint_scene_snapshot['objects']), 2)

        # 4. Identical retry with seq=2
        retry_resp = self.client.patch(
            url,
            {
                'checkpointSequence': 2,
                'totalEdits': 5,
            },
            format='json'
        )
        self.assertEqual(retry_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(retry_resp.data['status'], 'idempotent_noop')

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_terminal_state_immutability_and_race_protection(self):
        """Once completed or aborted, session cannot be modified by subsequent checkpoints or completions."""
        session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P03',
            condition='manual',
            sequence_order='G3',
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
        self.assertIsNotNone(session.final_scene_snapshot)

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
            {
                'finalSceneSnapshot': valid_final_scene,
            },
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
    def test_authoritative_metrics_calculation(self):
        """Authoritative metrics correctly calculate budget, containment, AABB overlaps, doorway intrusions, and task success."""
        # Compliant living room setup
        # Total price: Sofa (29,999) + Table (8,499) + Armchair (11,999) + Planter (2,499) = ₹52,996 <= ₹60,000 (compliant)
        living_room_scene = {
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

        metrics = calculate_authoritative_session_metrics('living_room', living_room_scene)
        self.assertEqual(metrics['budget_total_paise'], 5299600)
        self.assertTrue(metrics['is_budget_compliant'])
        self.assertEqual(metrics['final_scene_out_of_bounds_count'], 0)
        self.assertEqual(metrics['aabb_overlap_pairs_count'], 0)
        self.assertEqual(metrics['doorway_intrusions_count'], 0)
        self.assertTrue(metrics['is_task_successful'])

        # Now test Doorway Intrusion: move plant into South wall doorway zone (X in [-0.6, 0.6], Z in [0.8, 2.0])
        intruding_scene = json.loads(json.dumps(living_room_scene))
        intruding_scene['objects'][3]['position'] = [0.0, 0.45, 1.5]  # In keep-out zone

        metrics_intruded = calculate_authoritative_session_metrics('living_room', intruding_scene)
        self.assertEqual(metrics_intruded['doorway_intrusions_count'], 1)
        self.assertFalse(metrics_intruded['is_task_successful'])

        # Now test AABB Overlap Pair: move chair on top of coffee table
        overlap_scene = json.loads(json.dumps(living_room_scene))
        overlap_scene['objects'][2]['position'] = [0.1, 0.35, 0.05]  # Overlaps coffee table

        overlap_pairs = evaluate_aabb_overlap_pairs_count(overlap_scene['objects'])
        self.assertGreaterEqual(overlap_pairs, 1)

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_privacy_and_asset_url_exclusion_rule(self):
        """Snapshots with signed/credentialed URLs are strictly stripped of URLs before persistence."""
        tainted_snapshot = {
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
                    'modelUrl': 'https://s3.amazonaws.com/private-bucket/sofa.glb?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D',
                    'thumbnail': 'blob:http://localhost:5173/uuid-blob-1234',
                }
            ]
        }

        sanitized = sanitize_scene_snapshot(tainted_snapshot)
        obj = sanitized['objects'][0]
        self.assertNotIn('modelUrl', obj)
        self.assertNotIn('thumbnail', obj)
        self.assertEqual(obj['assetId'], 'sofa-modern-3seater')
        self.assertEqual(obj['position'], [0.0, 0.425, 0.0])

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_evaluator_restricted_export_and_management_command(self):
        """Export view requires admin authentication; exports valid JSON and CSV datasets."""
        # Create completed test session
        EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P01',
            condition='manual',
            sequence_order='G1',
            task_name='living_room',
            session_status='completed',
            budget_total_paise=5299600,
            budget_ceiling_paise=6000000,
            is_budget_compliant=True,
            is_task_successful=True,
            total_edits=15,
            duration_seconds=142.5,
        )

        export_url = reverse('evaluation:dataset-export')

        # 1. Unauthenticated request rejected
        resp_unauth = self.client.get(export_url)
        self.assertIn(resp_unauth.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

        # 2. Non-admin regular user rejected
        self.client.force_authenticate(user=self.regular_user)
        resp_user = self.client.get(export_url)
        self.assertEqual(resp_user.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Admin user authorized for JSON export
        self.client.force_authenticate(user=self.admin_user)
        resp_json = self.client.get(f"{export_url}?format=json")
        self.assertEqual(resp_json.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_json['Content-Type'], 'application/json; charset=utf-8')
        data = json.loads(resp_json.content)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['participantId'], 'P01')
        self.assertEqual(data[0]['budgetTotalPaise'], 5299600)

        # 4. Admin user authorized for CSV export
        resp_csv = self.client.get(f"{export_url}?format=csv")
        self.assertEqual(resp_csv.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_csv['Content-Type'], 'text/csv; charset=utf-8')
        csv_text = resp_csv.content.decode('utf-8')
        self.assertIn("sessionId,participantId,condition", csv_text)
        self.assertIn("P01,manual,G1,living_room", csv_text)

        # 5. Management command export_evaluation_dataset
        out_json = StringIO()
        call_command('export_evaluation_dataset', '--format=json', stdout=out_json)
        cmd_json = json.loads(out_json.getvalue())
        self.assertEqual(len(cmd_json), 1)
        self.assertEqual(cmd_json[0]['participantId'], 'P01')

        out_csv = StringIO()
        call_command('export_evaluation_dataset', '--format=csv', stdout=out_csv)
        self.assertIn("sessionId,participantId", out_csv.getvalue())
        self.assertIn("P01", out_csv.getvalue())

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_abort_session_lifecycle_preserves_checkpoint_snapshot(self):
        """Aborted session preserves last checkpointSceneSnapshot for dropout analysis and remains immutable."""
        session = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P05',
            condition='manual',
            sequence_order='G1',
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

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_home_study_task_metrics_and_doorway_intrusion(self):
        """Home study task metrics verify budget trap overrun, East wall doorway keep-out, and success."""
        # 1. Budget trap setup: desk (14,999) + armchair (11,999) + bookshelf (16,499) + table (8,499) = ₹51,996 (> ₹50,000 ceiling)
        budget_trap_scene = {
            'schemaVersion': 1,
            'unit': 'm',
            'room': {'width': 4.5, 'length': 3.5, 'height': 2.8},
            'objects': [
                {
                    'id': 'desk-1',
                    'assetId': 'desk-workspace-study',
                    'name': 'Desk',
                    'position': [-1.0, 0.375, -0.8],
                    'dimensions': [1.4, 0.75, 0.7],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'chair-1',
                    'assetId': 'chair-accent-armchair',
                    'name': 'Armchair',
                    'position': [-1.0, 0.44, 0.0],
                    'dimensions': [0.85, 0.88, 0.85],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'bookshelf-1',
                    'assetId': 'storage-bookshelf-tall',
                    'name': 'Bookshelf',
                    'position': [0.5, 0.9, -1.3],
                    'dimensions': [1.0, 1.8, 0.35],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
                {
                    'id': 'table-1',
                    'assetId': 'table-oak-coffee',
                    'name': 'Side Table (Budget Trap)',
                    'position': [0.5, 0.225, 0.5],
                    'dimensions': [1.2, 0.45, 0.6],
                    'scale': [1.0, 1.0, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                },
            ]
        }

        trap_metrics = calculate_authoritative_session_metrics('home_study', budget_trap_scene)
        self.assertEqual(trap_metrics['budget_total_paise'], 5199600)
        self.assertEqual(trap_metrics['budget_ceiling_paise'], 5000000)
        self.assertFalse(trap_metrics['is_budget_compliant'])
        self.assertFalse(trap_metrics['is_task_successful'])  # Fails due to budget trap

        # 2. Compliant option: replace table with planter: ₹45,996 <= ₹50,000
        compliant_study_scene = json.loads(json.dumps(budget_trap_scene))
        compliant_study_scene['objects'][3] = {
            'id': 'planter-1',
            'assetId': 'decor-plant-floor-vase',
            'name': 'Planter',
            'position': [0.5, 0.45, 0.5],
            'dimensions': [0.4, 0.9, 0.4],
            'scale': [1.0, 1.0, 1.0],
            'rotationEuler': [0.0, 0.0, 0.0],
        }

        compliant_metrics = calculate_authoritative_session_metrics('home_study', compliant_study_scene)
        self.assertEqual(compliant_metrics['budget_total_paise'], 4599600)
        self.assertTrue(compliant_metrics['is_budget_compliant'])
        self.assertEqual(compliant_metrics['doorway_intrusions_count'], 0)
        self.assertTrue(compliant_metrics['is_task_successful'])

        # 3. Test Home Study East Wall doorway keep-out zone: X in [1.05, 2.25], Z in [-0.60, 0.60]
        intruded_study = json.loads(json.dumps(compliant_study_scene))
        intruded_study['objects'][3]['position'] = [1.8, 0.45, 0.0]  # Right in East door corridor

        intruded_metrics = calculate_authoritative_session_metrics('home_study', intruded_study)
        self.assertEqual(intruded_metrics['doorway_intrusions_count'], 1)
        self.assertFalse(intruded_metrics['is_task_successful'])

    @override_settings(ENABLE_EVALUATION_TELEMETRY=True)
    def test_session_detail_and_export_filtering(self):
        """Detail view returns single session and export view properly filters by condition/task."""
        session1 = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P01',
            condition='manual',
            sequence_order='G1',
            task_name='living_room',
            session_status='completed',
            budget_total_paise=5299600,
        )
        session2 = EvaluationSession.objects.create(
            id=uuid.uuid4(),
            participant_id='P02',
            condition='ai_assisted',
            sequence_order='G2',
            task_name='home_study',
            session_status='completed',
            budget_total_paise=4599600,
        )

        # 1. Detail view
        detail_resp = self.client.get(
            reverse('evaluation:session-detail', kwargs={'session_id': session1.id})
        )
        self.assertEqual(detail_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_resp.data['participantId'], 'P01')

        # 2. Export filtering by condition
        self.client.force_authenticate(user=self.admin_user)
        export_url = reverse('evaluation:dataset-export')

        resp_manual = self.client.get(f"{export_url}?format=json&condition=manual")
        data_manual = json.loads(resp_manual.content)
        self.assertEqual(len(data_manual), 1)
        self.assertEqual(data_manual[0]['participantId'], 'P01')

        resp_ai = self.client.get(f"{export_url}?format=json&condition=ai_assisted")
        data_ai = json.loads(resp_ai.content)
        self.assertEqual(len(data_ai), 1)
        self.assertEqual(data_ai[0]['participantId'], 'P02')

        # 3. Export filtering by task
        resp_study = self.client.get(f"{export_url}?format=json&taskName=home_study")
        data_study = json.loads(resp_study.content)
        self.assertEqual(len(data_study), 1)
        self.assertEqual(data_study[0]['taskName'], 'home_study')

