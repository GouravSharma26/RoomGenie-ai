import datetime
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.evaluation.models import EvaluationSession


class Command(BaseCommand):
    help = "Reaps stale in-progress evaluation sessions that have exceeded the heartbeat timeout and marks them aborted."

    def add_arguments(self, parser):
        parser.add_argument(
            '--timeout-minutes',
            type=int,
            default=30,
            help='Inactivity heartbeat timeout in minutes before marking session aborted (default: 30).'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simulate reaping without persisting changes to the database.'
        )

    def handle(self, *args, **options):
        timeout_minutes = options['timeout_minutes']
        dry_run = options['dry_run']

        cutoff = timezone.now() - datetime.timedelta(minutes=timeout_minutes)
        candidates = EvaluationSession.objects.filter(
            session_status='in_progress',
            updated_at__lte=cutoff
        ).order_by('updated_at')

        candidate_count = candidates.count()
        if candidate_count == 0:
            self.stdout.write(self.style.SUCCESS(f"No stale in-progress sessions found older than {timeout_minutes} minutes."))
            return

        self.stdout.write(f"Found {candidate_count} stale session(s) inactive since {cutoff.isoformat()}.")

        reaped_count = 0
        now = timezone.now()

        for session_id in list(candidates.values_list('id', flat=True)):
            with transaction.atomic():
                session = EvaluationSession.objects.select_for_update().filter(id=session_id).first()
                if not session or session.session_status != 'in_progress' or session.updated_at > cutoff:
                    # Raced with completion, explicit abort, or recent checkpoint heartbeat
                    continue

                if dry_run:
                    self.stdout.write(f"[DRY RUN] Would abort session {session.id} (Participant: {session.participant_id}).")
                    reaped_count += 1
                    continue

                # Preserve checkpoint snapshot for dropout/attrition analysis
                session.session_status = 'aborted'
                session.abort_reason = 'inactivity_timeout'
                session.aborted_at = now
                session.duration_seconds = max(0.0, (now - session.start_time).total_seconds())
                session.save(update_fields=[
                    'session_status',
                    'abort_reason',
                    'aborted_at',
                    'duration_seconds',
                    'updated_at'
                ])
                reaped_count += 1
                self.stdout.write(f"Aborted stale session {session.id} (Participant: {session.participant_id}).")

        self.stdout.write(self.style.SUCCESS(
            f"Successfully {'simulated reaping of' if dry_run else 'reaped'} {reaped_count} stale session(s)."
        ))
