from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path

BACKUP_FILE_PATTERN = "nightsky-trail-*.sqlite3"


def create_verified_sqlite_backup(
    source: Path,
    directory: Path,
    timestamp: datetime,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"nightsky-trail-{timestamp:%Y%m%d-%H%M%S}.sqlite3"
    temporary_destination = destination.with_suffix(".sqlite3.tmp")
    temporary_destination.unlink(missing_ok=True)

    try:
        source_uri = f"{source.resolve().as_uri()}?mode=ro"
        with (
            sqlite3.connect(source_uri, uri=True) as source_connection,
            sqlite3.connect(temporary_destination) as backup_connection,
        ):
            source_connection.backup(backup_connection)
            check = backup_connection.execute("PRAGMA quick_check").fetchone()
            if check != ("ok",):
                raise sqlite3.DatabaseError("SQLite backup integrity check failed.")
        os.replace(temporary_destination, destination)
    except Exception:
        temporary_destination.unlink(missing_ok=True)
        raise

    return destination


def prune_database_backups(directory: Path, keep: int) -> int:
    backups = sorted(
        directory.glob(BACKUP_FILE_PATTERN),
        key=lambda path: (path.stat().st_mtime, path.name),
        reverse=True,
    )
    for backup in backups[keep:]:
        backup.unlink()
    return max(0, len(backups) - keep)


def latest_database_backup(directory: Path) -> Path | None:
    backups = list(directory.glob(BACKUP_FILE_PATTERN)) if directory.exists() else []
    if not backups:
        return None
    return max(backups, key=lambda path: (path.stat().st_mtime, path.name))
