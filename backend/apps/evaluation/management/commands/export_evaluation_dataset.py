from pathlib import Path
from django.core.management.base import BaseCommand
from apps.evaluation.exports import generate_evaluation_csv_export, generate_evaluation_json_export
from apps.evaluation.models import EvaluationSession


class Command(BaseCommand):
    help = "Export research evaluation sessions dataset to JSON or CSV format."

    def add_arguments(self, parser):
        parser.add_argument(
            '--format',
            type=str,
            choices=['json', 'csv'],
            default='json',
            help="Export format: 'json' (default) or 'csv'."
        )
        parser.add_argument(
            '--output',
            type=str,
            default=None,
            help="Optional file path to write output. If omitted, prints to standard output."
        )
        parser.add_argument(
            '--condition',
            type=str,
            choices=['manual', 'ai_assisted'],
            default=None,
            help="Filter by workflow condition."
        )
        parser.add_argument(
            '--task',
            type=str,
            choices=['living_room', 'home_study'],
            default=None,
            help="Filter by experimental task."
        )
        parser.add_argument(
            '--status',
            type=str,
            choices=['in_progress', 'completed', 'aborted'],
            default=None,
            help="Filter by session status."
        )

    def handle(self, *args, **options):
        export_format = options['format']
        output_path = options['output']
        condition = options['condition']
        task = options['task']
        status_filter = options.get('status')

        queryset = EvaluationSession.objects.all().order_by('start_time')
        if condition:
            queryset = queryset.filter(condition=condition)
        if task:
            queryset = queryset.filter(task_name=task)
        if status_filter:
            queryset = queryset.filter(session_status=status_filter)

        count = queryset.count()

        if export_format == 'csv':
            content = generate_evaluation_csv_export(queryset)
        else:
            content = generate_evaluation_json_export(queryset)

        if output_path:
            p = Path(output_path).resolve()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding='utf-8')
            self.stdout.write(
                self.style.SUCCESS(
                    f"Successfully exported {count} evaluation session(s) in {export_format.upper()} format to {p}"
                )
            )
        else:
            self.stdout.write(content)
