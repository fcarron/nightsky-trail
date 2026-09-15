from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from planner.integrations.local_osm import LocalOsmUnavailableError, ensure_index


class Command(BaseCommand):
    help = "Build the local OSM trail and drinking-water index outside API requests."

    def handle(self, *args: object, **options: object) -> None:
        try:
            ensure_index(settings.OSM_PBF_PATH, settings.OSM_TRAIL_INDEX_PATH)
        except LocalOsmUnavailableError as error:
            raise CommandError(error.message) from error
        self.stdout.write(self.style.SUCCESS("Local OSM index is ready."))
