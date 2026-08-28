from __future__ import annotations

import sqlite3
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from planner.services.database_backup import (
    create_verified_sqlite_backup,
    prune_database_backups,
)


class Command(BaseCommand):
    help = "Create and verify an online backup of the SQLite application database."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--directory",
            type=Path,
            default=settings.DATABASE_BACKUP_DIR,
            help="Directory for database backups.",
        )
        parser.add_argument(
            "--keep",
            type=int,
            default=settings.DATABASE_BACKUP_KEEP,
            help="Number of newest backups to keep.",
        )

    def handle(self, *args: object, **options: object) -> None:
        database = settings.DATABASES["default"]
        if database["ENGINE"] != "django.db.backends.sqlite3":
            raise CommandError("backup_database currently supports SQLite only.")

        keep = options["keep"]
        if not isinstance(keep, int) or not 1 <= keep <= 365:
            raise CommandError("--keep must be between 1 and 365.")

        source = Path(database["NAME"])
        directory = options["directory"]
        if not isinstance(directory, Path):
            directory = Path(directory)
        if not source.is_file():
            raise CommandError(f"SQLite database does not exist: {source}")

        try:
            destination = create_verified_sqlite_backup(
                source,
                directory,
                timezone.localtime(),
            )
            removed = prune_database_backups(directory, keep)
        except (OSError, sqlite3.Error) as error:
            raise CommandError(f"Database backup failed: {error}") from error

        size_megabytes = destination.stat().st_size / (1024 * 1024)
        self.stdout.write(
            self.style.SUCCESS(
                f"Database backup created: {destination} "
                f"({size_megabytes:.2f} MiB, {removed} old backup(s) removed)."
            )
        )
