"""
tasks.py
─────────────────────────────────────────────────────────────────────────────
Celery tasks for the analyzer app.

run_repository_analysis is the single background job that powers the entire
"Repository Submitted → Queued → Cloning → Scanning → AI Analysis →
Generating Report → Completed/Failed" pipeline described in the product
spec. It:

  1. Marks the RepositoryAnalysis row as "Queued" the moment the worker
     picks it up.
  2. Delegates the actual cloning/scanning/analysis work to
     AnalysisOrchestrator, wiring its progress_callback straight into the
     database so polling clients (or a future WebSocket layer) see live
     stage + percentage updates.
  3. Persists the final AnalysisReport onto the RepositoryAnalysis row.
  4. Retries automatically on transient errors (network blips while
     talking to GitHub) with exponential backoff, and marks the job
     "Failed" with a useful error_message once retries are exhausted.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.utils import timezone

from architect.services.analysis_orchestrator import AnalysisOrchestrator, report_to_dict

logger = logging.getLogger(__name__)

# Errors worth retrying — anything network/clone related that may simply be
# a transient blip (GitHub rate limiting, DNS hiccup, etc).
RETRYABLE_EXCEPTIONS = (ConnectionError, TimeoutError, OSError)


def _build_metadata(report) -> dict:
    """Flatten an AnalysisReport into the JSON blob stored on the model."""
    report_dict = report_to_dict(report)
    return {
        "languages": report.languages if isinstance(report.languages, dict) else {},
        "frameworks": report.architecture.backend + report.architecture.frontend,
        "frontend": report.architecture.frontend,
        "package_managers": [],
        "docker_compose": report.has_docker_compose,
        "github_actions": report.has_github_actions,
        "license": report.has_license,
        "stars": report.stars,
        "forks": report.forks,
        "open_issues": report.open_issues,
        "contributors": report.contributors,
        "license_name": report.license_name,
        "topics": report.topics,
        "primary_language": report.primary_language,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
        # Repository owner / creator — surfaced in the Overview tab and
        # exported reports.
        "creator": report.owner_login,
        "owner_login": report.owner_login,
        "owner_avatar_url": report.owner_avatar_url,
        "owner_html_url": report.owner_html_url,
        "full_name": report.full_name,
        "quality_score": report.quality.overall_score,
        "quality_grade": report.quality.overall_grade,
        "security_risk_score": report.security.risk_score,
        "security_grade": report.security.risk_grade,
        "composite_score": report.composite_score,
        "composite_grade": report.composite_grade,
        "duration_seconds": report.duration_seconds,
        "errors": report.errors,
        "architecture": report_dict.get("architecture", {}),
        "file_tree": report_dict.get("file_tree", {}),
        "quality": report_dict.get("quality", {}),
        "security": report_dict.get("security", {}),
        "dependencies": report_dict.get("dependencies", {}),
        "predictions": report_dict.get("predictions", {}),
    }


@shared_task(
    bind=True,
    name="analyzer.tasks.run_repository_analysis",
    autoretry_for=RETRYABLE_EXCEPTIONS,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def run_repository_analysis(self, analysis_id: int, repo_url: str, branch: str = "", force_reclone: bool = False, deep_scan: bool = False):
    """
    Background job: clone, scan, analyze, and persist results for a single
    RepositoryAnalysis row. Reports live progress back onto the row so the
    frontend's step tracker can poll /api/analysis/<id>/progress/.
    """
    # Imported here (not at module top) to avoid Django "apps not ready"
    # issues when Celery autodiscovers tasks before the app registry loads.
    from .models import RepositoryAnalysis

    logger.info("analysis.task.start", extra={"analysis_id": analysis_id, "repo_url": repo_url})

    try:
        analysis = RepositoryAnalysis.objects.get(pk=analysis_id)
    except RepositoryAnalysis.DoesNotExist:
        logger.error("analysis.task.missing_row", extra={"analysis_id": analysis_id})
        return {"success": False, "error": "Analysis row no longer exists."}

    analysis.celery_task_id = self.request.id or ""
    analysis.status = "Queued"
    analysis.progress_percent = 5
    analysis.progress_message = "Job picked up by worker."
    analysis.started_at = timezone.now()
    analysis.save(update_fields=[
        "celery_task_id", "status", "progress_percent", "progress_message", "started_at",
    ])

    def on_progress(stage: str, percent: int, message: str) -> None:
        """Pushed into the DB after every orchestrator step so polling
        clients always see the current stage without waiting for the
        whole job to finish."""
        RepositoryAnalysis.objects.filter(pk=analysis_id).update(
            status=stage if stage != "Failed" else "Failed",
            progress_percent=percent,
            progress_message=message,
        )
        # Also publish through Celery's own state machine — useful if a
        # future WebSocket consumer wants to subscribe to task events
        # instead of polling the database. This writes to the *result
        # backend* (Redis), which is a separate thing from the eager-mode
        # fallback: CELERY_TASK_ALWAYS_EAGER only bypasses the broker
        # (task dispatch), not this. If USE_REDIS is off and nothing is
        # actually running on localhost:6379, every one of these calls
        # was blocking trying to reach a dead Redis instance before timing
        # out — 7 calls per analysis, silently adding up to the majority
        # of total wall-clock time. Skip it entirely when there's no real
        # backend to talk to; the DB write above is what polling clients
        # actually read from anyway.
        if getattr(settings, "USE_REDIS", False):
            self.update_state(state="PROGRESS", meta={"stage": stage, "percent": percent, "message": message})

    try:
        report = AnalysisOrchestrator(
            repo_url,
            branch=branch,
            force_reclone=force_reclone,
            deep_scan=deep_scan,
            progress_callback=on_progress,
        ).run()

    except SoftTimeLimitExceeded:
        logger.error("analysis.task.timeout", extra={"analysis_id": analysis_id})
        RepositoryAnalysis.objects.filter(pk=analysis_id).update(
            status="Failed",
            progress_percent=100,
            progress_message="Analysis timed out.",
            error_message="The analysis exceeded the maximum allowed runtime.",
            completed_at=timezone.now(),
        )
        return {"success": False, "error": "timeout"}

    except RETRYABLE_EXCEPTIONS as exc:
        logger.warning(
            "analysis.task.retryable_error",
            extra={"analysis_id": analysis_id, "error": str(exc), "attempt": self.request.retries},
        )
        RepositoryAnalysis.objects.filter(pk=analysis_id).update(
            progress_message=f"Retrying after transient error ({self.request.retries + 1}/{self.max_retries})...",
        )
        raise  # autoretry_for handles the retry/backoff

    except Exception as exc:
        logger.error("analysis.task.failed", extra={"analysis_id": analysis_id, "error": str(exc)}, exc_info=True)
        RepositoryAnalysis.objects.filter(pk=analysis_id).update(
            status="Failed",
            progress_percent=100,
            progress_message="Analysis failed.",
            error_message=str(exc),
            completed_at=timezone.now(),
        )
        return {"success": False, "error": str(exc)}

    # ── Persist final result ────────────────────────────────────────────
    final_status = "Completed" if not report.errors else "Failed"
    RepositoryAnalysis.objects.filter(pk=analysis_id).update(
        status=final_status,
        progress_percent=100,
        progress_message="Analysis complete." if final_status == "Completed" else "Completed with errors.",
        error_message="; ".join(report.errors) if report.errors else "",
        file_count=report.file_count,
        folder_count=report.dir_count,
        has_readme=report.has_readme,
        has_docker=report.has_docker,
        has_requirements=report.has_requirements,
        has_package_json=report.has_package_json,
        commit_sha=getattr(report, "commit_sha", "") or "",
        # NOTE: deliberately NOT persisting repository_path here. This app
        # runs locally on the user's own machine, so keeping every cloned
        # repo on disk after analysis means it silently accumulates real
        # files on their PC forever. Instead we clean the clone up below
        # and re-clone on demand only if/when the user clicks "Download
        # as ZIP" (see DownloadRepositoryZipView).
        metadata=_build_metadata(report),
        completed_at=timezone.now(),
    )

    # Remove the clone from disk now that analysis is finished — nothing
    # downstream needs it to stick around, and leaving it would mean a
    # fresh, untouched copy of every analyzed repo's source piles up on
    # the user's computer with every analysis.
    from .services.github_client import force_rmtree

    local_path = getattr(report, "local_path", "") or ""
    if local_path and not force_rmtree(local_path):
        logger.warning("analysis.task.cleanup_incomplete", extra={"analysis_id": analysis_id, "path": local_path})

    logger.info(
        "analysis.task.complete",
        extra={"analysis_id": analysis_id, "status": final_status, "score": report.composite_score},
    )

    return {"success": final_status == "Completed", "analysis_id": analysis_id, "score": report.composite_score}