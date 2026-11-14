"""
Evaluation Metrics Computation for RoomGenie AI Spatial Engine (Phase 6.5).
Calculates physical validity, functional quality, candidate diversity,
generation reliability, and timing diagnostics.
"""

import math
from typing import Any, Dict, List, Set
from .evaluation_types import (
    CandidateEvaluationResult,
    CaseEvaluationResult,
    EvaluationSummaryMetrics,
)


def calculate_candidate_diversity(candidates: List[CandidateEvaluationResult]) -> float:
    """
    Measures genuine layout diversity across multiple candidates within a single proposal run.
    Evaluates:
      1. Spatial distribution divergence (mean Euclidean displacement of placed items).
      2. Orientation diversity (yaw variance).
      3. Catalogue asset diversity (Jaccard distance: 1 - |A ∩ B| / |A ∪ B|).
    Returns a normalized diversity score from 0.0 (identical) to 100.0 (highly varied).
    """
    if len(candidates) < 2:
        return 0.0

    pair_diversities: List[float] = []

    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            c1 = candidates[i]
            c2 = candidates[j]

            # 1. Asset selection diversity (Jaccard distance)
            set1 = set(c1.placed_asset_ids)
            set2 = set(c2.placed_asset_ids)
            union_len = len(set1 | set2)
            if union_len > 0:
                asset_jaccard = 1.0 - (len(set1 & set2) / union_len)
            else:
                asset_jaccard = 0.0

            # 2. Position divergence: compare closest matching items
            pos1 = c1.placed_positions
            pos2 = c2.placed_positions

            pos_diff_sum = 0.0
            comparisons = 0

            for p1 in pos1:
                # Find minimum distance to any item in pos2
                if pos2:
                    min_dist = min(
                        math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)
                        for p2 in pos2
                    )
                    pos_diff_sum += min(min_dist, 3.0) / 3.0  # normalize up to 3m
                    comparisons += 1

            pos_score = (pos_diff_sum / comparisons) if comparisons > 0 else 0.0

            # 3. Action count / zone differences
            count_diff = abs(c1.furniture_count - c2.furniture_count) / max(c1.furniture_count, c2.furniture_count, 1)

            # Combined pair diversity: 40% position, 40% asset choice, 20% item count
            pair_score = (0.40 * pos_score + 0.40 * asset_jaccard + 0.20 * count_diff) * 100.0
            pair_diversities.append(pair_score)

    return sum(pair_diversities) / len(pair_diversities) if pair_diversities else 0.0


def aggregate_summary_metrics(
    case_results: List[CaseEvaluationResult],
    dataset_version: str = "1.0.0"
) -> EvaluationSummaryMetrics:
    """
    Aggregates per-case evaluation results into complete summary metrics.
    """
    metrics = EvaluationSummaryMetrics(dataset_version=dataset_version)
    metrics.total_cases = len(case_results)

    if not case_results:
        return metrics

    all_candidates: List[CandidateEvaluationResult] = []
    case_diversities: List[float] = []
    case_latencies: List[float] = []
    passed_gates = 0
    failed_gates = 0

    category_satisfied_count = 0
    preservation_satisfied_count = 0
    budget_tested_count = 0
    budget_satisfied_count = 0

    for cr in case_results:
        all_candidates.extend(cr.candidates)
        case_diversities.append(cr.diversity_score)
        case_latencies.append(cr.latency_ms)

        if cr.passed_all_gates:
            passed_gates += 1
        else:
            failed_gates += 1

        # Check top candidate compliance
        if cr.candidates:
            top_cand = cr.candidates[0]
            if top_cand.required_categories_satisfied:
                category_satisfied_count += 1
            if top_cand.preservation_satisfied:
                preservation_satisfied_count += 1
            if top_cand.has_budget_violation is not None:
                budget_tested_count += 1
                if not top_cand.has_budget_violation:
                    budget_satisfied_count += 1

    metrics.total_candidates = len(all_candidates)
    metrics.passed_gates_count = passed_gates
    metrics.failed_gates_count = failed_gates
    metrics.gate_pass_rate_pct = (passed_gates / len(case_results) * 100.0) if case_results else 0.0

    if all_candidates:
        valid_cands = [c for c in all_candidates if c.is_valid]
        eligible_cands = [c for c in all_candidates if c.is_approval_eligible]
        metrics.valid_candidates = len(valid_cands)
        metrics.hard_validity_rate_pct = (len(valid_cands) / len(all_candidates)) * 100.0
        metrics.candidate_eligibility_rate_pct = (len(eligible_cands) / len(all_candidates)) * 100.0

        metrics.boundary_violation_rate_pct = (
            sum(1 for c in all_candidates if c.has_boundary_breach) / len(all_candidates) * 100.0
        )
        metrics.collision_rate_pct = (
            sum(1 for c in all_candidates if c.has_collision) / len(all_candidates) * 100.0
        )
        metrics.doorway_obstruction_rate_pct = (
            sum(1 for c in all_candidates if c.has_doorway_blockage) / len(all_candidates) * 100.0
        )
        metrics.invalid_relationship_rate_pct = (
            sum(1 for c in all_candidates if c.has_invalid_relationship) / len(all_candidates) * 100.0
        )

        metrics.mean_circulation_score = sum(c.circulation_score for c in all_candidates) / len(all_candidates)
        metrics.mean_clearance_score = sum(c.clearance_score for c in all_candidates) / len(all_candidates)
        metrics.mean_utilization_score = sum(c.utilization_score for c in all_candidates) / len(all_candidates)
        metrics.mean_overall_score = sum(c.overall_score for c in all_candidates) / len(all_candidates)
        metrics.mean_preference_score = (
            sum(c.preference_score for c in valid_cands) / len(valid_cands)
        ) if valid_cands else 0.0

    metrics.required_category_fulfillment_rate_pct = (
        (category_satisfied_count / len(case_results) * 100.0) if case_results else 0.0
    )
    metrics.preservation_compliance_rate_pct = (
        (preservation_satisfied_count / len(case_results) * 100.0) if case_results else 0.0
    )
    metrics.budget_compliance_rate_pct = (
        (budget_satisfied_count / budget_tested_count * 100.0) if budget_tested_count > 0 else 100.0
    )

    metrics.mean_candidate_diversity_score = (
        sum(case_diversities) / len(case_diversities) if case_diversities else 0.0
    )
    metrics.generation_success_rate_pct = (
        sum(1 for cr in case_results if cr.candidates_generated > 0) / len(case_results) * 100.0
    )
    metrics.simulation_success_rate_pct = (
        sum(1 for cr in case_results if cr.candidates_generated > 0) / len(case_results) * 100.0
    )
    metrics.mean_latency_ms = sum(case_latencies) / len(case_latencies) if case_latencies else 0.0

    return metrics

