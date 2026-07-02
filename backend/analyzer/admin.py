from django.contrib import admin
from .models import RepositoryAnalysis


@admin.register(RepositoryAnalysis)
class RepositoryAnalysisAdmin(admin.ModelAdmin):
    list_display = (
        "project_name",
        "repo_url",
        "status",
        "created_at",
    )

    search_fields = (
        "project_name",
        "repo_url",
    )