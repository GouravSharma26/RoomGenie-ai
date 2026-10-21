from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.evaluation.exports import generate_evaluation_csv_export, generate_evaluation_json_export
from apps.evaluation.metrics import (
    TASK_SPECIFICATIONS,
    calculate_authoritative_session_metrics,
    sanitize_scene_snapshot,
)
from apps.evaluation.models import EvaluationSession
from apps.evaluation.serializers import (
    AbortSessionSerializer,
    CheckpointSessionSerializer,
    CompleteSessionSerializer,
    ExperimentSessionRecordSerializer,
    StartSessionSerializer,
)


def _check_telemetry_enabled():
    """
    Guarantees that evaluation telemetry logging remains strictly disabled by default
    and can only execute when ENABLE_EVALUATION_TELEMETRY=True is explicitly set.
    """
    if not getattr(settings, 'ENABLE_EVALUATION_TELEMETRY', False):
        raise PermissionDenied("Evaluation telemetry logging is currently disabled.")


def _compute_idle_aggregates(idle_intervals: list[dict]) -> tuple[float, float, bool]:
    """Calculates total idle duration, longest pause, and 15-minute prolonged interruption flag."""
    total_idle = 0.0
    max_gap = 0.0
    for interval in idle_intervals:
        dur = float(interval.get('durationSeconds', 0.0))
        total_idle += dur
        if dur > max_gap:
            max_gap = dur
    return total_idle, max_gap, (max_gap >= 900.0)


class StartSessionView(APIView):
    """
    Stage 1 — Session Initialization.
    Idempotent: If a session with the given sessionId already exists,
    returns the existing record with HTTP 200 without creating duplicates or resetting timestamps.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        _check_telemetry_enabled()

        serializer = StartSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        session_id = data['sessionId']
        task_name = data['taskName']
        task_spec = TASK_SPECIFICATIONS.get(task_name, TASK_SPECIFICATIONS['living_room'])

        # Idempotency check: return existing record if already initialized
        existing_session = EvaluationSession.objects.filter(id=session_id).first()
        if existing_session:
            return Response(
                ExperimentSessionRecordSerializer(existing_session).data,
                status=status.HTTP_200_OK
            )

        new_session = EvaluationSession.objects.create(
            id=session_id,
            participant_id=data['participantId'],
            condition=data['condition'],
            sequence_order=data['sequenceOrder'],
            task_name=task_name,
            budget_ceiling_paise=task_spec['budget_ceiling_paise'],
            session_status='in_progress',
            checkpoint_sequence=0,
            start_time=timezone.now(),
        )

        return Response(
            ExperimentSessionRecordSerializer(new_session).data,
            status=status.HTTP_201_CREATED
        )


class CheckpointSessionView(APIView):
    """
    Stage 2 — Revision-Ordered Periodic Checkpoints.
    Guarantees revision ordering:
    - seq > current: accepted and updates checkpointSceneSnapshot and counters.
    - seq == current: treated as harmless idempotent retry (HTTP 200).
    - seq < current: safely ignored as a stale delayed request (HTTP 200 with status info).
    - Terminal sessions (completed/aborted) are strictly immutable (HTTP 409 Conflict).
    """
    permission_classes = [AllowAny]

    def patch(self, request, session_id):
        _check_telemetry_enabled()

        serializer = CheckpointSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        incoming_seq = data['checkpointSequence']

        with transaction.atomic():
            session = get_object_or_404(
                EvaluationSession.objects.select_for_update(),
                id=session_id
            )

            # Terminal state immutability lock
            if session.session_status in ('completed', 'aborted'):
                return Response(
                    {
                        "error": f"Session {session_id} is in terminal state '{session.session_status}' and cannot be modified."
                    },
                    status=status.HTTP_409_CONFLICT
                )

            # Checkpoint sequence revision resolution
            if incoming_seq < session.checkpoint_sequence:
                return Response(
                    {
                        "status": "stale_ignored",
                        "checkpointSequence": session.checkpoint_sequence,
                        "message": "Checkpoint revision is older than the current session revision."
                    },
                    status=status.HTTP_200_OK
                )

            if incoming_seq == session.checkpoint_sequence:
                return Response(
                    {
                        "status": "idempotent_noop",
                        "checkpointSequence": session.checkpoint_sequence,
                        "message": "Checkpoint revision already processed."
                    },
                    status=status.HTTP_200_OK
                )

            # Valid newer revision: update checkpoint fields
            raw_snapshot = data.get('checkpointSceneSnapshot')
            sanitized_snapshot = sanitize_scene_snapshot(raw_snapshot) if raw_snapshot else None

            idle_intervals = data.get('idleIntervals', session.idle_intervals)
            total_idle, max_gap, has_prolonged = _compute_idle_aggregates(idle_intervals)

            session.checkpoint_sequence = incoming_seq
            session.active_duration_seconds = data.get('activeDurationSeconds', session.active_duration_seconds)
            session.total_edits = data.get('totalEdits', session.total_edits)
            session.undo_redo_count = data.get('undoRedoCount', session.undo_redo_count)
            session.attempted_out_of_bounds_count = data.get('attemptedOutOfBoundsCount', session.attempted_out_of_bounds_count)
            session.idle_intervals = idle_intervals
            session.total_idle_duration_seconds = total_idle
            session.max_single_idle_gap_seconds = max_gap
            session.has_prolonged_interruption = has_prolonged

            if sanitized_snapshot is not None:
                session.checkpoint_scene_snapshot = sanitized_snapshot

            session.save()

            return Response(
                ExperimentSessionRecordSerializer(session).data,
                status=status.HTTP_200_OK
            )


class CompleteSessionView(APIView):
    """
    Stage 3A — Task Completion.
    Submits finalized scene, sanitizes asset URLs, computes authoritative server-side metrics
    (budget compliance, room containment, AABB overlaps, doorway intrusions, task success),
    and transitions session to immutable 'completed' status.
    """
    permission_classes = [AllowAny]

    def post(self, request, session_id):
        _check_telemetry_enabled()

        serializer = CompleteSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            session = get_object_or_404(
                EvaluationSession.objects.select_for_update(),
                id=session_id
            )

            # Terminal state immutability lock
            if session.session_status in ('completed', 'aborted'):
                return Response(
                    {
                        "error": f"Session {session_id} is in terminal state '{session.session_status}' and cannot be completed again."
                    },
                    status=status.HTTP_409_CONFLICT
                )

            sanitized_final_scene = sanitize_scene_snapshot(data['finalSceneSnapshot'])
            if sanitized_final_scene is None:
                return Response(
                    {"error": "Invalid finalSceneSnapshot payload."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Calculate authoritative server-side metrics
            metrics = calculate_authoritative_session_metrics(
                session.task_name,
                sanitized_final_scene
            )

            end_time = timezone.now()
            duration_seconds = max(0.0, (end_time - session.start_time).total_seconds())

            idle_intervals = data.get('idleIntervals', session.idle_intervals)
            total_idle, max_gap, has_prolonged = _compute_idle_aggregates(idle_intervals)

            session.final_scene_snapshot = sanitized_final_scene
            session.budget_total_paise = metrics['budget_total_paise']
            session.is_budget_compliant = metrics['is_budget_compliant']
            session.final_scene_out_of_bounds_count = metrics['final_scene_out_of_bounds_count']
            session.aabb_overlap_pairs_count = metrics['aabb_overlap_pairs_count']
            session.doorway_intrusions_count = metrics['doorway_intrusions_count']
            session.is_task_successful = metrics['is_task_successful']

            session.end_time = end_time
            session.duration_seconds = duration_seconds
            session.active_duration_seconds = data.get('activeDurationSeconds', session.active_duration_seconds)
            session.total_edits = data.get('totalEdits', session.total_edits)
            session.undo_redo_count = data.get('undoRedoCount', session.undo_redo_count)
            session.attempted_out_of_bounds_count = data.get('attemptedOutOfBoundsCount', session.attempted_out_of_bounds_count)

            session.idle_intervals = idle_intervals
            session.total_idle_duration_seconds = total_idle
            session.max_single_idle_gap_seconds = max_gap
            session.has_prolonged_interruption = has_prolonged

            session.agent_proposals_count = data.get('agentProposalsCount', session.agent_proposals_count)
            session.agent_accepted_count = data.get('agentAcceptedCount', session.agent_accepted_count)
            session.agent_tier1_success_count = data.get('agentTier1SuccessCount', session.agent_tier1_success_count)
            session.agent_tier2_schema_valid_count = data.get('agentTier2SchemaValidCount', session.agent_tier2_schema_valid_count)
            session.agent_tier3_domain_valid_count = data.get('agentTier3DomainValidCount', session.agent_tier3_domain_valid_count)

            session.session_status = 'completed'
            session.save()

            return Response(
                ExperimentSessionRecordSerializer(session).data,
                status=status.HTTP_200_OK
            )


class AbortSessionView(APIView):
    """
    Stage 3B — Abort and Incomplete Session Preservation.
    Preserves checkpointSceneSnapshot for dropout and attrition analysis;
    marks session 'aborted' and locks the record.
    """
    permission_classes = [AllowAny]

    def post(self, request, session_id):
        _check_telemetry_enabled()

        serializer = AbortSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        abort_reason = serializer.validated_data.get('abortReason', 'user_cancelled')

        with transaction.atomic():
            session = get_object_or_404(
                EvaluationSession.objects.select_for_update(),
                id=session_id
            )

            if session.session_status == 'completed':
                return Response(
                    {"error": f"Session {session_id} is completed and cannot be aborted."},
                    status=status.HTTP_409_CONFLICT
                )

            if session.session_status == 'aborted':
                # Idempotent abort
                return Response(
                    ExperimentSessionRecordSerializer(session).data,
                    status=status.HTTP_200_OK
                )

            aborted_at = timezone.now()
            duration_seconds = max(0.0, (aborted_at - session.start_time).total_seconds())

            session.session_status = 'aborted'
            session.aborted_at = aborted_at
            session.abort_reason = abort_reason
            session.duration_seconds = duration_seconds
            session.save()

            return Response(
                ExperimentSessionRecordSerializer(session).data,
                status=status.HTTP_200_OK
            )


class SessionDetailView(APIView):
    """Retrieves an individual evaluation session record."""
    permission_classes = [AllowAny]

    def get(self, request, session_id):
        _check_telemetry_enabled()
        session = get_object_or_404(EvaluationSession, id=session_id)
        return Response(
            ExperimentSessionRecordSerializer(session).data,
            status=status.HTTP_200_OK
        )


class ExportDatasetView(APIView):
    """
    Evaluator-Restricted Export View.
    Allows authenticated evaluators (staff/admin) to export pseudonymized study telemetry
    in structured JSON or statistical CSV format.
    """
    permission_classes = [IsAdminUser]

    def perform_content_negotiation(self, request, force=False):
        renderers = self.get_renderers()
        return renderers[0], renderers[0].media_type

    def get(self, request):
        export_format = request.query_params.get('format', 'json').lower().strip()
        queryset = EvaluationSession.objects.all().order_by('start_time')

        # Optional filtering by condition or task
        condition = request.query_params.get('condition')
        if condition in ('manual', 'ai_assisted'):
            queryset = queryset.filter(condition=condition)

        task_name = request.query_params.get('taskName')
        if task_name in ('living_room', 'home_study'):
            queryset = queryset.filter(task_name=task_name)

        if export_format == 'csv':
            csv_content = generate_evaluation_csv_export(queryset)
            response = HttpResponse(csv_content, content_type='text/csv; charset=utf-8')
            response['Content-Disposition'] = 'attachment; filename="roomgenie_evaluation_dataset.csv"'
            return response

        json_content = generate_evaluation_json_export(queryset)
        response = HttpResponse(json_content, content_type='application/json; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="roomgenie_evaluation_dataset.json"'
        return response
