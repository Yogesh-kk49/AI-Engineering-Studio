from django.conf import settings
from django.db import models


class RepositoryAnalysis(models.Model):
    """
    One row per analysis job. Tracks both the final analysis results AND
    the live progress of the background Celery pipeline so the frontend
    can render a step-by-step progress tracker instead of a spinner.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analyses",
        null=True,
        blank=True,
        help_text="Owner of this analysis. Nullable for legacy rows created "
                   "before per-user isolation was added.",
    )

    # Every stage the async pipeline moves through, in order. Mirrors the
    # workflow requested by product:
    #   Repository Submitted → Queued → Cloning → Scanning → AI Analysis →
    #   Generating Report → Completed / Failed
    STATUS_CHOICES = [
        ("Queued", "Queued"),
        ("Cloning", "Cloning"),
        ("Scanning", "Scanning"),
        ("AI Analysis", "AI Analysis"),
        ("Generating Report", "Generating Report"),
        ("Completed", "Completed"),
        ("Failed", "Failed"),
    ]

    repo_url = models.URLField()

    branch = models.CharField(
        max_length=255,
        blank=True,
        help_text="Branch that was analyzed. Empty = repository default branch.",
    )

    project_name = models.CharField(
        max_length=255,
        blank=True
    )

    repository_path = models.CharField(
        max_length=500,
        blank=True,
        help_text="On-disk path of the cached clone. Only ever set for Deep "
                   "Scans — Basic Scan never downloads/clones anything.",
    )

    SCAN_MODE_CHOICES = [
        ("basic", "Basic"),
        ("deep", "Deep"),
    ]
    scan_mode = models.CharField(
        max_length=10,
        choices=SCAN_MODE_CHOICES,
        default="basic",
        db_index=True,
        help_text="'basic' = GitHub-API-only scan, no clone. "
                   "'deep' = full clone + architecture/quality/security/dependency analysis.",
    )

    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default="Queued",
        db_index=True,
    )

    # ── Background job tracking ────────────────────────────────────────
    celery_task_id = models.CharField(max_length=255, blank=True, db_index=True)
    progress_percent = models.PositiveSmallIntegerField(default=0)
    progress_message = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # ── Repository identity / cache key ─────────────────────────────────
    # Used so a repeat analysis request for the same url+branch+commit can
    # short-circuit straight to "Completed" instead of re-cloning.
    commit_sha = models.CharField(max_length=64, blank=True, db_index=True)

    file_count = models.IntegerField(default=0)

    folder_count = models.IntegerField(default=0)

    has_readme = models.BooleanField(default=False)

    has_docker = models.BooleanField(default=False)

    has_requirements = models.BooleanField(default=False)

    has_package_json = models.BooleanField(default=False)

    metadata = models.JSONField(
        default=dict,
        blank=True
    )

    last_scanned = models.DateTimeField(auto_now=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # `-id` is a tiebreaker: on platforms with coarser datetime
        # resolution (notably Windows), two rows created back-to-back can
        # end up with the exact same `created_at` value, making "newest
        # first" ambiguous on `-created_at` alone. Since id is always
        # monotonically increasing with creation order, it resolves ties
        # the same way `created_at` intends to.
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["repo_url", "branch", "commit_sha"]),
        ]

    def __str__(self):
        return self.project_name or self.repo_url

    @property
    def is_terminal(self) -> bool:
        """True once the job has finished, successfully or not."""
        return self.status in ("Completed", "Failed")