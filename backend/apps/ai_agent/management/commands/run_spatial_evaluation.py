"""
Django Management Command: run_spatial_evaluation
Executes the RoomGenie AI deterministic Spatial Evaluation Framework (Phase 6.5).
"""

import os
from django.core.management.base import BaseCommand
from apps.ai_agent.evaluation import (
    run_spatial_evaluation,
    generate_markdown_report,
    generate_json_report,
)


class Command(BaseCommand):
    help = "Run the deterministic Spatial AI Evaluation Framework across all 32 benchmark scenarios."

    def add_arguments(self, parser):
        parser.add_argument(
            '--category',
            type=str,
            default=None,
            help='Filter evaluation scenarios by category (e.g. living_room, bedroom, polygon, concave, etc.)'
        )
        parser.add_argument(
            '--json-out',
            type=str,
            default=None,
            help='Path to output JSON evaluation report (defaults to backend/apps/ai_agent/evaluation/evaluation_results.json)'
        )
        parser.add_argument(
            '--md-out',
            type=str,
            default=None,
            help='Path to output Markdown evaluation summary (defaults to backend/apps/ai_agent/evaluation/EVALUATION_REPORT.md)'
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Print detailed scenario diagnostic logs to stdout.'
        )

    def handle(self, *args, **options):
        category = options.get('category')
        self.stdout.write(self.style.MIGRATE_HEADING("=== RoomGenie AI: Spatial AI Evaluation Runner (Phase 6.5) ==="))
        if category:
            self.stdout.write(f"Filtering by category: {category}")

        result = run_spatial_evaluation(category_filter=category)
        sm = result.summary_metrics

        self.stdout.write(self.style.SUCCESS(f"Evaluation completed across {sm.total_cases} scenarios ({sm.total_candidates} candidates)."))
        self.stdout.write(f"Hard Validity Rate: {sm.hard_validity_rate_pct:.1f}%")
        self.stdout.write(f"Mean Circulation Score: {sm.mean_circulation_score:.1f}/100")
        self.stdout.write(f"Mean Clearance Score: {sm.mean_clearance_score:.1f}/100")
        self.stdout.write(f"Mean Utilization Score: {sm.mean_utilization_score:.1f}/100")
        self.stdout.write(f"Mean Candidate Diversity: {sm.mean_candidate_diversity_score:.1f}/100")
        self.stdout.write(f"Gate Pass Rate: {sm.gate_pass_rate_pct:.1f}% ({sm.passed_gates_count}/{sm.total_cases})")
        self.stdout.write(f"Mean Latency: {sm.mean_latency_ms:.1f}ms")

        # Save JSON output
        json_path = options.get('json_out')
        if not json_path:
            json_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'evaluation',
                'evaluation_results.json'
            )
        json_content = generate_json_report(result)
        with open(json_path, 'w', encoding='utf-8') as f:
            f.write(json_content)
        self.stdout.write(self.style.SUCCESS(f"Saved machine-readable JSON report: {json_path}"))

        # Save Markdown output
        md_path = options.get('md_out')
        if not md_path:
            md_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'evaluation',
                'EVALUATION_REPORT.md'
            )
        md_content = generate_markdown_report(result)
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
        self.stdout.write(self.style.SUCCESS(f"Saved human-readable Markdown report: {md_path}"))

