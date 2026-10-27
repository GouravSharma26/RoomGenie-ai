import csv
import io
import json
from typing import Any
from django.db.models import QuerySet
from apps.evaluation.models import EvaluationSession
from apps.evaluation.serializers import ExperimentSessionRecordSerializer


CSV_EXPORT_FIELDS = [
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
]


def generate_evaluation_json_export(queryset: QuerySet[EvaluationSession]) -> str:
    """
    Serializes an EvaluationSession queryset into a formatted JSON string
    matching the ExperimentSessionRecord schema.
    """
    serializer = ExperimentSessionRecordSerializer(queryset, many=True)
    return json.dumps(serializer.data, indent=2)


def generate_evaluation_csv_export(queryset: QuerySet[EvaluationSession]) -> str:
    """
    Serializes an EvaluationSession queryset into a standard CSV dataset
    for statistical analysis (e.g. R, Python, SPSS, JASP).
    """
    serializer = ExperimentSessionRecordSerializer(queryset, many=True)
    records: list[dict[str, Any]] = serializer.data

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_EXPORT_FIELDS, extrasaction='ignore')
    writer.writeheader()

    for record in records:
        row = {field: record.get(field) for field in CSV_EXPORT_FIELDS}
        writer.writerow(row)

    return output.getvalue()
