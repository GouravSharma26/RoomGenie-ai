"""
Spatial AI Evaluation Package for RoomGenie AI (Phase 6.5).
Provides offline, deterministic evaluation dataset, scenario runner,
metric computation, and diagnostic reporting.
"""

from .evaluation_types import (
    EvaluationCase,
    CandidateEvaluationResult,
    CaseEvaluationResult,
    EvaluationSummaryMetrics,
)
from .evaluation_scenarios import EVALUATION_DATASET, get_scenario_by_id
from .evaluation_runner import run_spatial_evaluation
from .evaluation_report import generate_markdown_report, generate_json_report

__all__ = [
    'EvaluationCase',
    'CandidateEvaluationResult',
    'CaseEvaluationResult',
    'EvaluationSummaryMetrics',
    'EVALUATION_DATASET',
    'get_scenario_by_id',
    'run_spatial_evaluation',
    'generate_markdown_report',
    'generate_json_report',
]

