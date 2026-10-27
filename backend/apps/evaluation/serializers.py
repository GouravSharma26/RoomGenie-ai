import math
from rest_framework import serializers
from apps.evaluation.models import EvaluationSession
from apps.evaluation.metrics import sanitize_scene_snapshot


class ExperimentSessionRecordSerializer(serializers.ModelSerializer):
    """
    Serializes EvaluationSession into the exact ExperimentSessionRecord format
    specified in docs/RESEARCH_PROTOCOL_AND_TASKS.md Section 9.3.
    """
    schemaVersion = serializers.SerializerMethodField()
    sessionId = serializers.UUIDField(source='id')
    participantId = serializers.CharField(source='participant_id')
    sequenceOrder = serializers.CharField(source='sequence_order')
    taskName = serializers.CharField(source='task_name')
    sessionStatus = serializers.CharField(source='session_status')
    checkpointSequence = serializers.IntegerField(source='checkpoint_sequence')
    
    startTime = serializers.DateTimeField(source='start_time', format='iso-8601')
    endTime = serializers.DateTimeField(source='end_time', format='iso-8601', allow_null=True)
    durationSeconds = serializers.FloatField(source='duration_seconds', allow_null=True)
    activeDurationSeconds = serializers.FloatField(source='active_duration_seconds')

    abortedAt = serializers.DateTimeField(source='aborted_at', format='iso-8601', allow_null=True)
    abortReason = serializers.CharField(source='abort_reason', allow_null=True)

    idleIntervals = serializers.JSONField(source='idle_intervals')
    totalIdleDurationSeconds = serializers.FloatField(source='total_idle_duration_seconds')
    maxSingleIdleGapSeconds = serializers.FloatField(source='max_single_idle_gap_seconds')
    hasProlongedInterruption = serializers.BooleanField(source='has_prolonged_interruption')

    budgetTotalPaise = serializers.IntegerField(source='budget_total_paise', allow_null=True)
    budgetCeilingPaise = serializers.IntegerField(source='budget_ceiling_paise')
    isBudgetCompliant = serializers.BooleanField(source='is_budget_compliant', allow_null=True)
    attemptedOutOfBoundsCount = serializers.IntegerField(source='attempted_out_of_bounds_count')
    finalSceneOutOfBoundsCount = serializers.IntegerField(source='final_scene_out_of_bounds_count', allow_null=True)
    aabbOverlapPairsCount = serializers.IntegerField(source='aabb_overlap_pairs_count', allow_null=True)
    doorwayIntrusionsCount = serializers.IntegerField(source='doorway_intrusions_count', allow_null=True)
    isTaskSuccessful = serializers.BooleanField(source='is_task_successful', allow_null=True)

    totalEdits = serializers.IntegerField(source='total_edits')
    undoRedoCount = serializers.IntegerField(source='undo_redo_count')

    agentProposalsCount = serializers.IntegerField(source='agent_proposals_count')
    agentAcceptedCount = serializers.IntegerField(source='agent_accepted_count')
    agentTier1SuccessCount = serializers.IntegerField(source='agent_tier1_success_count')
    agentTier2SchemaValidCount = serializers.IntegerField(source='agent_tier2_schema_valid_count')
    agentTier3DomainValidCount = serializers.IntegerField(source='agent_tier3_domain_valid_count')

    trialPeriod = serializers.IntegerField(source='trial_period')
    checkpointSceneSnapshot = serializers.JSONField(source='checkpoint_scene_snapshot', allow_null=True)
    finalSceneSnapshot = serializers.JSONField(source='final_scene_snapshot', allow_null=True)

    susScore = serializers.FloatField(source='sus_score', allow_null=True)
    susResponses = serializers.JSONField(source='sus_responses', allow_null=True)

    class Meta:
        model = EvaluationSession
        fields = [
            'schemaVersion',
            'sessionId',
            'participantId',
            'condition',
            'sequenceOrder',
            'trialPeriod',
            'taskName',
            'sessionStatus',
            'checkpointSequence',
            'startTime',
            'endTime',
            'durationSeconds',
            'activeDurationSeconds',
            'abortedAt',
            'abortReason',
            'idleIntervals',
            'totalIdleDurationSeconds',
            'maxSingleIdleGapSeconds',
            'hasProlongedInterruption',
            'budgetTotalPaise',
            'budgetCeilingPaise',
            'isBudgetCompliant',
            'attemptedOutOfBoundsCount',
            'finalSceneOutOfBoundsCount',
            'aabbOverlapPairsCount',
            'doorwayIntrusionsCount',
            'isTaskSuccessful',
            'totalEdits',
            'undoRedoCount',
            'agentProposalsCount',
            'agentAcceptedCount',
            'agentTier1SuccessCount',
            'agentTier2SchemaValidCount',
            'agentTier3DomainValidCount',
            'checkpointSceneSnapshot',
            'finalSceneSnapshot',
            'susScore',
            'susResponses',
        ]

    def get_schemaVersion(self, obj) -> int:
        return 1


class StartSessionSerializer(serializers.Serializer):
    sessionId = serializers.UUIDField(required=True)
    sessionSecret = serializers.CharField(min_length=16, max_length=128, required=True)
    participantId = serializers.CharField(max_length=64, required=True)
    condition = serializers.ChoiceField(choices=['manual', 'ai_assisted'], required=True)
    sequenceOrder = serializers.ChoiceField(choices=['G1', 'G2', 'G3', 'G4'], required=True)
    taskName = serializers.ChoiceField(choices=['living_room', 'home_study'], required=True)
    trialPeriod = serializers.IntegerField(min_value=1, max_value=2, required=False)

    def validate(self, attrs):
        from apps.evaluation.metrics import validate_study_assignment
        try:
            validated_period = validate_study_assignment(
                sequence_order=attrs['sequenceOrder'],
                condition=attrs['condition'],
                task_name=attrs['taskName'],
                trial_period=attrs.get('trialPeriod')
            )
            attrs['trialPeriod'] = validated_period
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        return attrs


def _validate_idle_intervals(intervals: list) -> list[dict]:
    cleaned = []
    for idx, item in enumerate(intervals):
        if not isinstance(item, dict):
            raise serializers.ValidationError(f"idleIntervals[{idx}] must be a JSON object.")
        start = item.get('startOffsetSeconds')
        dur = item.get('durationSeconds')
        if start is None or isinstance(start, bool) or not isinstance(start, (int, float)) or not math.isfinite(start):
            raise serializers.ValidationError(f"idleIntervals[{idx}].startOffsetSeconds must be a finite, non-boolean number.")
        if start < 0:
            raise serializers.ValidationError(f"idleIntervals[{idx}].startOffsetSeconds cannot be negative.")
        if dur is None or isinstance(dur, bool) or not isinstance(dur, (int, float)) or not math.isfinite(dur):
            raise serializers.ValidationError(f"idleIntervals[{idx}].durationSeconds must be a finite, non-boolean number.")
        if dur <= 0:
            raise serializers.ValidationError(f"idleIntervals[{idx}].durationSeconds cannot be negative.")
        cleaned.append({
            'startOffsetSeconds': float(start),
            'durationSeconds': float(dur),
        })
    return cleaned


class CheckpointSessionSerializer(serializers.Serializer):
    checkpointSequence = serializers.IntegerField(min_value=1, required=True)
    activeDurationSeconds = serializers.FloatField(min_value=0.0, required=False)
    totalEdits = serializers.IntegerField(min_value=0, required=False)
    undoRedoCount = serializers.IntegerField(min_value=0, required=False)
    attemptedOutOfBoundsCount = serializers.IntegerField(min_value=0, required=False)
    idleIntervals = serializers.ListField(
        child=serializers.DictField(),
        required=False
    )
    checkpointSceneSnapshot = serializers.DictField(required=False, allow_null=True)

    def validate_idleIntervals(self, value):
        return _validate_idle_intervals(value)


class SusResponsesField(serializers.Field):
    """
    Field for validating and normalizing SUS responses dictionary while preserving
    exact raw key types (preventing DictField from silently stringifying or collapsing duplicate keys).
    """
    def to_internal_value(self, data):
        if data is None:
            return None
        if not isinstance(data, dict):
            raise serializers.ValidationError("SUS responses must be a JSON dictionary mapping question numbers (1..10) to Likert ratings (1..5).")
        from apps.evaluation.metrics import validate_sus_responses
        is_valid, missing, err = validate_sus_responses(data)
        if not is_valid:
            raise serializers.ValidationError(err or "Invalid SUS responses.")
        return {q: int(data[q] if q in data else data[str(q)]) for q in range(1, 11)}

    def to_representation(self, value):
        return value


class CompleteSessionSerializer(serializers.Serializer):
    finalSceneSnapshot = serializers.DictField(required=True)
    activeDurationSeconds = serializers.FloatField(min_value=0.0, required=False)
    totalEdits = serializers.IntegerField(min_value=0, required=False)
    undoRedoCount = serializers.IntegerField(min_value=0, required=False)
    attemptedOutOfBoundsCount = serializers.IntegerField(min_value=0, required=False)
    idleIntervals = serializers.ListField(
        child=serializers.DictField(),
        required=False
    )
    agentProposalsCount = serializers.IntegerField(min_value=0, required=False)
    agentAcceptedCount = serializers.IntegerField(min_value=0, required=False)
    agentTier1SuccessCount = serializers.IntegerField(min_value=0, required=False)
    agentTier2SchemaValidCount = serializers.IntegerField(min_value=0, required=False)
    agentTier3DomainValidCount = serializers.IntegerField(min_value=0, required=False)
    susResponses = SusResponsesField(required=False, allow_null=True)

    def validate_idleIntervals(self, value):
        return _validate_idle_intervals(value)


class AbortSessionSerializer(serializers.Serializer):
    abortReason = serializers.ChoiceField(
        choices=['user_cancelled', 'inactivity_timeout', 'browser_closed'],
        required=False,
        default='user_cancelled'
    )
