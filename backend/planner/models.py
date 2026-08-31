from __future__ import annotations

import uuid
from secrets import token_urlsafe

from django.conf import settings
from django.db import models


class SavedTour(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_tours",
    )
    name = models.CharField(max_length=160)
    route_data = models.JSONField()
    share_enabled = models.BooleanField(default=False)
    share_token = models.CharField(
        max_length=32,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"]),
        ]

    def __str__(self) -> str:
        return self.name

    def set_sharing_enabled(self, enabled: bool) -> None:
        self.share_enabled = enabled
        self.share_token = token_urlsafe(18) if enabled else None
