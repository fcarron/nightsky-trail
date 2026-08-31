from __future__ import annotations

from django.contrib import admin

from .models import SavedTour


@admin.register(SavedTour)
class SavedTourAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "owner",
        "share_enabled",
        "updated_at",
        "created_at",
    )
    list_filter = ("share_enabled",)
    search_fields = ("name", "owner__username", "owner__email")
    readonly_fields = ("id", "share_token", "created_at", "updated_at")
    raw_id_fields = ("owner",)
