import hashlib
import hmac
import math
import secrets
from typing import Any
from django.conf import settings
from django.db import IntegrityError, transaction
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
    validate_and_sanitize_canonical_scene,
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


def _hash_secret(secret: str) -> str:
    """Computes SHA-256 digest of session capability secret."""
    return hashlib.sha256(secret.strip().encode('utf-8')).hexdigest()


def _verify_session_secret(session: EvaluationSession, request) -> None:
    """
    Capability-based access control: verifies possession of session bearer secret.
    Allows staff/evaluator users to inspect or administer sessions directly.
    """
    if request.user and request.user.is_authenticated and request.user.is_staff:
        return

    # Deny non-staff access when the hash is missing
    if not session.session_secret_hash:
        raise PermissionDenied("Session has no configured capability secret.")

    provided = request.headers.get('X-Session-Secret')
    if not provided and request.headers.get('Authorization', '').startswith('Bearer '):
        provided = request.headers.get('Authorization')[7:].strip()

    if not provided:
        raise PermissionDenied("Missing session authorization capability secret in header 'X-Session-Secret'.")

    provided_hash = _hash_secret(provided)
    if not hmac.compare_digest(provided_hash, session.session_secret_hash):
        raise PermissionDenied("Invalid session authorization capability secret.")


def _validate_and_compute_idle_aggregates(idle_intervals: Any, elapsed_seconds: float) -> tuple[float, float, bool]:
    """
    Validates idle interval list strictly:
    - Must be a list of interval objects.
    - startOffsetSeconds and durationSeconds must be finite, non-boolean numbers >= 0.
    - Intervals must be temporally plausible within elapsed session duration.
    Calculates total idle duration, longest single pause, and >=15-min prolonged interruption flag.
    """
    if not isinstance(idle_intervals, list):
        raise ValueError("idleIntervals must be a list of interval objects.")

    total_idle = 0.0
    max_gap = 0.0
    for idx, interval in enumerate(idle_intervals):
        if not isinstance(interval, dict):
            raise ValueError(f"idleIntervals[{idx}] must be a JSON object.")

        start_offset = interval.get('startOffsetSeconds', interval.get('start'))
        duration = interval.get('durationSeconds')

        if start_offset is None or duration is None:
            raise ValueError(f"idleIntervals[{idx}] must provide 'startOffsetSeconds' and 'durationSeconds'.")

        if isinstance(start_offset, bool) or not isinstance(start_offset, (int, float)) or not math.isfinite(start_offset):
            raise ValueError(f"idleIntervals[{idx}].startOffsetSeconds must be a finite, non-boolean number.")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration):
            raise ValueError(f"idleIntervals[{idx}].durationSeconds must be a finite, non-boolean number.")

        start_offset = float(start_offset)
        duration = float(duration)

        if start_offset < 0.0:
            raise ValueError(f"idleIntervals[{idx}].startOffsetSeconds cannot be negative.")
        if duration < 0.0:
            raise ValueError(f"idleIntervals[{idx}].durationSeconds cannot be negative.")

        if start_offset > elapsed_seconds + 5.0:
            raise ValueError(f"idleIntervals[{idx}].startOffsetSeconds ({start_offset:.1f}s) exceeds elapsed session time ({elapsed_seconds:.1f}s).")
        if start_offset + duration > elapsed_seconds + 10.0:
            raise ValueError(f"idleIntervals[{idx}] extends beyond elapsed session time ({elapsed_seconds:.1f}s).")

        total_idle += duration
        if duration > max_gap:
            max_gap = duration

    return total_idle, max_gap, (max_gap >= 900.0)


class StartSessionView(APIView):
    """
    Stage 1 — Session Initialization.
    Idempotent & Concurrency-Safe:
    - Client generates high-entropy sessionSecret before first request and reuses it on retries.
    - Server stores only the SHA-256 hash in session_secret_hash.
    - If a session with sessionId already exists with identical parameters and matching secret, returns HTTP 200.
    - If assignment parameters or capability secret mismatch existing session, returns HTTP 409 Conflict.
    - Protects against concurrency collisions using atomic transactions and IntegrityError recovery.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        _check_telemetry_enabled()

        serializer = StartSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        session_id = data['sessionId']
        client_secret = data['sessionSecret']
        client_secret_hash = _hash_secret(client_secret)
        task_name = data['taskName']
        participant_id = data['participantId']
        condition = data['condition']
        sequence_order = data['sequenceOrder']
        trial_period = data['trialPeriod']
        task_spec = TASK_SPECIFICATIONS.get(task_name, TASK_SPECIFICATIONS['living_room'])

        # Check existing record for parameter and capability secret congruence
        with transaction.atomic():
            existing_session = EvaluationSession.objects.filter(id=session_id).first()
            if existing_session:
                mismatches = []
                if existing_session.participant_id != participant_id:
                    mismatches.append(f"participantId (stored: {existing_session.participant_id}, incoming: {participant_id})")
                if existing_session.condition != condition:
                    mismatches.append(f"condition (stored: {existing_session.condition}, incoming: {condition})")
                if existing_session.sequence_order != sequence_order:
                    mismatches.append(f"sequenceOrder (stored: {existing_session.sequence_order}, incoming: {sequence_order})")
                if existing_session.task_name != task_name:
                    mismatches.append(f"taskName (stored: {existing_session.task_name}, incoming: {task_name})")

                if mismatches:
                    return Response(
                        {
                            "error": f"Session {session_id} already exists with differing assignment parameters: {', '.join(mismatches)}."
                        },
                        status=status.HTTP_409_CONFLICT
                    )

                if not existing_session.session_secret_hash or not hmac.compare_digest(client_secret_hash, existing_session.session_secret_hash):
                    return Response(
                        {
                            "error": "Session capability secret does not match the existing session secret hash."
                        },
                        status=status.HTTP_409_CONFLICT
                    )

                response_data = ExperimentSessionRecordSerializer(existing_session).data
                return Response(response_data, status=status.HTTP_200_OK)

            try:
                with transaction.atomic():
                    new_session = EvaluationSession.objects.create(
                        id=session_id,
                        participant_id=participant_id,
                        condition=condition,
                        sequence_order=sequence_order,
                        trial_period=trial_period,
                        task_name=task_name,
                        budget_ceiling_paise=task_spec['budget_ceiling_paise'],
                        session_status='in_progress',
                        session_secret_hash=client_secret_hash,
                        checkpoint_sequence=0,
                        start_time=timezone.now(),
                    )
            except IntegrityError:
                # Concurrent race condition: another request created it in between
                existing = EvaluationSession.objects.get(id=session_id)
                if (
                    existing.participant_id != participant_id or
                    existing.condition != condition or
                    existing.sequence_order != sequence_order or
                    existing.task_name != task_name
                ):
                    return Response(
                        {"error": "Session UUID conflict with divergent assignment parameters."},
                        status=status.HTTP_409_CONFLICT
                    )
                if not existing.session_secret_hash or not hmac.compare_digest(client_secret_hash, existing.session_secret_hash):
                    return Response(
                        {"error": "Session capability secret mismatch on concurrent session creation."},
                        status=status.HTTP_409_CONFLICT
                    )
                return Response(
                    ExperimentSessionRecordSerializer(existing).data,
                    status=status.HTTP_200_OK
                )

        response_data = ExperimentSessionRecordSerializer(new_session).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class CheckpointSessionView(APIView):
    """
    Stage 2 — Revision-Ordered Periodic Checkpoints.
    Guarantees revision ordering and non-destructive partial updates:
    - seq > current: accepted and updates checkpointSceneSnapshot and counters.
    - seq == current: treated as harmless idempotent retry (HTTP 200).
    - seq < current: safely ignored as a stale delayed request (HTTP 200).
    - Terminal sessions (completed/aborted) are strictly immutable (HTTP 409 Conflict).
    - Preserves existing stored counters when omitted in partial requests.
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
            _verify_session_secret(session, request)

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
                        "message": "Checkpoint revision is older than current session revision."
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

            # Validate scene snapshot if provided
            raw_snapshot = data.get('checkpointSceneSnapshot')
            sanitized_snapshot = None
            if raw_snapshot is not None:
                try:
                    sanitized_snapshot = validate_and_sanitize_canonical_scene(
                        raw_snapshot,
                        expected_task_name=session.task_name
                    )
                except ValueError as exc:
                    return Response(
                        {"error": f"Invalid checkpointSceneSnapshot: {str(exc)}"},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            # Non-destructive counter preservation: update ONLY if provided
            session.checkpoint_sequence = incoming_seq

            # Unconditionally calculate elapsed session time
            now = timezone.now()
            elapsed_seconds = max(0.0, (now - session.start_time).total_seconds())

            if 'activeDurationSeconds' in data:
                if data['activeDurationSeconds'] > elapsed_seconds + 5.0:
                    return Response(
                        {"error": f"activeDurationSeconds ({data['activeDurationSeconds']}) cannot exceed elapsed session time ({elapsed_seconds:.1f}s)."},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            validated_idle_data = None
            if 'idleIntervals' in data:
                try:
                    total_idle, max_gap, has_prolonged = _validate_and_compute_idle_aggregates(
                        data['idleIntervals'],
                        elapsed_seconds
                    )
                except ValueError as exc:
                    return Response(
                        {"error": f"Invalid idleIntervals: {str(exc)}"},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                validated_idle_data = (total_idle, max_gap, has_prolonged)

            effective_active = data.get('activeDurationSeconds', session.active_duration_seconds or 0.0)
            effective_idle = validated_idle_data[0] if validated_idle_data is not None else (session.total_idle_duration_seconds or 0.0)
            if 'activeDurationSeconds' in data or 'idleIntervals' in data:
                if effective_active + effective_idle > elapsed_seconds + 10.0:
                    return Response(
                        {"error": f"Sum of active duration ({effective_active:.1f}s) and total idle duration ({effective_idle:.1f}s) exceeds elapsed session time ({elapsed_seconds:.1f}s)."},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            if 'activeDurationSeconds' in data:
                session.active_duration_seconds = data['activeDurationSeconds']
            if 'totalEdits' in data:
                session.total_edits = data['totalEdits']
            if 'undoRedoCount' in data:
                session.undo_redo_count = data['undoRedoCount']
            if 'attemptedOutOfBoundsCount' in data:
                session.attempted_out_of_bounds_count = data['attemptedOutOfBoundsCount']

            if validated_idle_data is not None:
                total_idle, max_gap, has_prolonged = validated_idle_data
                session.idle_intervals = data['idleIntervals']
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
    Validates canonical scene strictly against task requirements, sanitizes asset URLs,
    computes authoritative server-side metrics, and transitions session to immutable 'completed' status.
    Preserves any counters previously recorded in checkpoints if omitted at completion.
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
            _verify_session_secret(session, request)

            # Terminal state immutability lock
            if session.session_status in ('completed', 'aborted'):
                return Response(
                    {
                        "error": f"Session {session_id} is in terminal state '{session.session_status}' and cannot be completed again."
                    },
                    status=status.HTTP_409_CONFLICT
                )

            # Validate final scene snapshot strictly
            try:
                sanitized_final_scene = validate_and_sanitize_canonical_scene(
                    data['finalSceneSnapshot'],
                    expected_task_name=session.task_name
                )
            except ValueError as exc:
                return Response(
                    {"error": f"Invalid finalSceneSnapshot: {str(exc)}"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            end_time = timezone.now()
            duration_seconds = max(0.0, (end_time - session.start_time).total_seconds())

            if 'activeDurationSeconds' in data:
                if data['activeDurationSeconds'] > duration_seconds + 5.0:
                    return Response(
                        {"error": f"activeDurationSeconds ({data['activeDurationSeconds']}) cannot exceed elapsed session duration ({duration_seconds:.1f}s)."},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            validated_idle_data = None
            if 'idleIntervals' in data:
                try:
                    total_idle, max_gap, has_prolonged = _validate_and_compute_idle_aggregates(
                        data['idleIntervals'],
                        duration_seconds
                    )
                except ValueError as exc:
                    return Response(
                        {"error": f"Invalid idleIntervals: {str(exc)}"},
                        status=status.HTTP_400_BAD_REQUEST
                    )

                validated_idle_data = (total_idle, max_gap, has_prolonged)

            effective_active = data.get('activeDurationSeconds', session.active_duration_seconds or 0.0)
            effective_idle = validated_idle_data[0] if validated_idle_data is not None else (session.total_idle_duration_seconds or 0.0)
            if 'activeDurationSeconds' in data or 'idleIntervals' in data:
                if effective_active + effective_idle > duration_seconds + 10.0:
                    return Response(
                        {"error": f"Sum of active duration ({effective_active:.1f}s) and total idle duration ({effective_idle:.1f}s) exceeds elapsed session duration ({duration_seconds:.1f}s)."},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            # Calculate authoritative server-side metrics
            metrics = calculate_authoritative_session_metrics(
                session.task_name,
                sanitized_final_scene
            )

            session.final_scene_snapshot = sanitized_final_scene
            session.budget_total_paise = metrics['budget_total_paise']
            session.is_budget_compliant = metrics['is_budget_compliant']
            session.final_scene_out_of_bounds_count = metrics['final_scene_out_of_bounds_count']
            session.aabb_overlap_pairs_count = metrics['aabb_overlap_pairs_count']
            session.doorway_intrusions_count = metrics['doorway_intrusions_count']
            session.is_task_successful = metrics['is_task_successful']

            session.end_time = end_time
            session.duration_seconds = duration_seconds

            # Preserve existing counters if omitted in completion payload
            if 'activeDurationSeconds' in data:
                session.active_duration_seconds = data['activeDurationSeconds']
            if 'totalEdits' in data:
                session.total_edits = data['totalEdits']
            if 'undoRedoCount' in data:
                session.undo_redo_count = data['undoRedoCount']
            if 'attemptedOutOfBoundsCount' in data:
                session.attempted_out_of_bounds_count = data['attemptedOutOfBoundsCount']

            if validated_idle_data is not None:
                total_idle, max_gap, has_prolonged = validated_idle_data
                session.idle_intervals = data['idleIntervals']
                session.total_idle_duration_seconds = total_idle
                session.max_single_idle_gap_seconds = max_gap
                session.has_prolonged_interruption = has_prolonged

            if 'agentProposalsCount' in data:
                session.agent_proposals_count = data['agentProposalsCount']
            if 'agentAcceptedCount' in data:
                session.agent_accepted_count = data['agentAcceptedCount']
            if 'agentTier1SuccessCount' in data:
                session.agent_tier1_success_count = data['agentTier1SuccessCount']
            if 'agentTier2SchemaValidCount' in data:
                session.agent_tier2_schema_valid_count = data['agentTier2SchemaValidCount']
            if 'agentTier3DomainValidCount' in data:
                session.agent_tier3_domain_valid_count = data['agentTier3DomainValidCount']

            if 'susResponses' in data and data['susResponses'] is not None:
                from apps.evaluation.metrics import calculate_sus_score
                sus_calc = calculate_sus_score(data['susResponses'])
                session.sus_responses = sus_calc['normalized_responses']
                session.sus_score = sus_calc['score']

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
            _verify_session_secret(session, request)

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
        _verify_session_secret(session, request)
        return Response(
            ExperimentSessionRecordSerializer(session).data,
            status=status.HTTP_200_OK
        )


class ExportDatasetView(APIView):
    """
    Evaluator-Restricted Export View.
    Allows authenticated evaluators (staff/admin) to export pseudonymized study telemetry
    in structured JSON or statistical CSV format, with optional filtering by condition, task, and status.
    """
    permission_classes = [IsAdminUser]

    def perform_content_negotiation(self, request, force=False):
        renderers = self.get_renderers()
        return renderers[0], renderers[0].media_type

    def get(self, request):
        export_format = request.query_params.get('format', 'json').lower().strip()
        queryset = EvaluationSession.objects.all().order_by('start_time')

        # Filter by condition
        condition = request.query_params.get('condition')
        if condition in ('manual', 'ai_assisted'):
            queryset = queryset.filter(condition=condition)

        # Filter by task
        task_name = request.query_params.get('taskName')
        if task_name in ('living_room', 'home_study'):
            queryset = queryset.filter(task_name=task_name)

        # Filter by session status
        status_filter = request.query_params.get('status')
        if status_filter in ('in_progress', 'completed', 'aborted'):
            queryset = queryset.filter(session_status=status_filter)

        if export_format == 'csv':
            csv_content = generate_evaluation_csv_export(queryset)
            response = HttpResponse(csv_content, content_type='text/csv; charset=utf-8')
            response['Content-Disposition'] = 'attachment; filename="roomgenie_evaluation_dataset.csv"'
            return response

        json_content = generate_evaluation_json_export(queryset)
        response = HttpResponse(json_content, content_type='application/json; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="roomgenie_evaluation_dataset.json"'
        return response
