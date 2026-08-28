from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError


@pytest.mark.django_db
def test_backup_command_creates_verified_copy_and_prunes_old_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source.sqlite3"
    with sqlite3.connect(source) as connection:
        connection.execute("CREATE TABLE sample (value TEXT NOT NULL)")
        connection.execute("INSERT INTO sample VALUES ('preserved')")

    backup_directory = tmp_path / "backups"
    backup_directory.mkdir()
    for index in range(2):
        old_backup = backup_directory / f"nightsky-trail-2026010{index + 1}-000000.sqlite3"
        old_backup.write_bytes(b"old")
        os.utime(old_backup, (index + 1, index + 1))

    monkeypatch.setitem(settings.DATABASES["default"], "NAME", source)
    call_command("backup_database", directory=backup_directory, keep=2)

    backups = sorted(backup_directory.glob("nightsky-trail-*.sqlite3"))
    assert len(backups) == 2
    current_backup = max(backups, key=lambda path: path.stat().st_mtime)
    with sqlite3.connect(current_backup) as connection:
        assert connection.execute("SELECT value FROM sample").fetchone() == ("preserved",)
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)


def test_backup_command_rejects_invalid_retention() -> None:
    with pytest.raises(CommandError, match="--keep must be between 1 and 365"):
        call_command("backup_database", keep=0)
