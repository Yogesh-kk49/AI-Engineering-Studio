from django.db import models
from analyzer.models import RepositoryAnalysis


class ArchitectReport(models.Model):
    analysis = models.OneToOneField(
        RepositoryAnalysis,
        on_delete=models.CASCADE,
        related_name="architect_report"
    )

    architecture_type = models.CharField(max_length=200, blank=True)

    frontend = models.JSONField(default=list, blank=True)
    backend = models.JSONField(default=list, blank=True)
    databases = models.JSONField(default=list, blank=True)
    authentication = models.JSONField(default=list, blank=True)
    api_type = models.JSONField(default=list, blank=True)

    modules = models.JSONField(default=list, blank=True)
    technologies = models.JSONField(default=list, blank=True)

    recommendations = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Architect Report - {self.analysis.project_name}"