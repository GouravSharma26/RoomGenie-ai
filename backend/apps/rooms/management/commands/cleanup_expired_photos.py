from django.core.management.base import BaseCommand
from apps.rooms.services import cleanup_expired_room_photos


class Command(BaseCommand):
    help = "Purge expired ephemeral room photos from disk and mark database records as deleted."

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simulate cleanup without deleting files from disk or updating database records.'
        )
        parser.add_argument(
            '--max-age-seconds',
            type=int,
            default=None,
            help='Override default TTL and purge photos older than the specified seconds.'
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        max_age = options['max_age_seconds']

        if dry_run:
            self.stdout.write(self.style.WARNING("Running cleanup in DRY-RUN mode..."))

        summary = cleanup_expired_room_photos(max_age_seconds=max_age, dry_run=dry_run)

        msg = (
            f"Room photo cleanup summary: "
            f"scanned={summary['total_scanned']}, "
            f"purged={summary['purged_count']}, "
            f"missing={summary['missing_count']}, "
            f"failed={summary['failed_count']}"
        )

        if summary['failed_count'] > 0:
            self.stdout.write(self.style.WARNING(msg))
        else:
            self.stdout.write(self.style.SUCCESS(msg))
