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
    base = {
        "scan_mode": report.scan_mode,
        "languages": report.languages if isinstance(report.languages, dict) else {},
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
        "composite_score": report.composite_score,
        "composite_grade": report.composite_grade,
        "duration_seconds": report.duration_seconds,
        "errors": report.errors,
        "file_tree": report_dict.get("file_tree", {}),
    }

    if report.scan_mode == "basic":
        # No architecture/quality/security/dependency services ran — this
        # was API-metadata-only, nothing was cloned. Surface the lighter
        # basic-scan fields instead of the (empty) full-pipeline ones.
        base.update({
            "frameworks": report.basic_frameworks,
            "frontend": [],
            "package_managers": list(report.basic_dependencies.keys()),
            "basic_dependencies": report.basic_dependencies,
            "basic_recommendations": report.basic_recommendations,
            "readme_preview": report.readme_preview,
            "quality_score": None,
            "quality_grade": None,
            "security_risk_score": None,
            "security_grade": None,
            "architecture": {},
            "quality": {},
            "security": {},
            "dependencies": {},
            "predictions": {},
        })
    else:
        base.update({
            "frameworks": report.architecture.backend + report.architecture.frontend,
            "frontend": report.architecture.frontend,
            "package_managers": [],
            "quality_score": report.quality.overall_score,
            "quality_grade": report.quality.overall_grade,
            "security_risk_score": report.security.risk_score,
            "security_grade": report.security.risk_grade,
            "architecture": report_dict.get("architecture", {}),
            "quality": report_dict.get("quality", {}),
            "security": report_dict.get("security", {}),
            "dependencies": report_dict.get("dependencies", {}),
            "predictions": report_dict.get("predictions", {}),
        })

    return base


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
def run_repository_analysis(self, analysis_id: int, repo_url: str, branch: str = "", force_reclone: bool = False,
                             deep_scan: bool = False, scan_mode: str = "deep", repo_action: str = "auto"):
    """
    Background job: scan, analyze, and persist results for a single
    RepositoryAnalysis row. Reports live progress back onto the row so the
    frontend's step tracker can poll /api/analysis/<id>/progress/.

    scan_mode:
      "basic" – GitHub-API-only scan (AnalysisOrchestrator.run_basic()).
                Never clones/downloads anything.
      "deep"  – full clone + architecture/quality/security/dependency
                pipeline (AnalysisOrchestrator.run()). The clone is now
                cached on disk and reused by future scans of the same
                repo instead of being deleted after every run — see
                repo_action below and GitHubClient's reuse_mode.

    repo_action (deep scans only) — resolves the "repository already
    downloaded" duplicate-protection prompt:
      "auto"           – default; reuse the cached clone instantly if the
                         remote commit hasn't changed, otherwise refresh it.
      "use_existing"   – always reuse whatever's cached on disk.
      "update"         – same as "auto" (explicit "check for changes").
      "fresh"          – force a brand-new download (force_reclone).
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
        orchestrator = AnalysisOrchestrator(
            repo_url,
            branch=branch,
            force_reclone=force_reclone or repo_action == "fresh",
            deep_scan=deep_scan,
            progress_callback=on_progress,
        )
        if scan_mode == "basic":
            report = orchestrator.run_basic()
        else:
            orchestrator.reuse_mode = "force_existing" if repo_action == "use_existing" else "auto"
            report = orchestrator.run()

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
    local_path = getattr(report, "local_path", "") or ""
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
        scan_mode=report.scan_mode,
        # Deep scans now persist the cached clone's path so a rescan,
        # Deep-Scan-again, or ZIP download can reuse it instead of
        # re-downloading. Basic scans never clone anything, so this stays
        # blank for them (GitHubClient already leaves local_path empty).
        repository_path=str(local_path) if local_path else "",
        metadata=_build_metadata(report),
        completed_at=timezone.now(),
    )

    # NOTE: the clone is deliberately left on disk for deep scans (see
    # GitHubClient._clone_or_update's cache-reuse logic) instead of being
    # deleted here — that's the whole point of the "clone once → cache →
    # reuse" architecture. Nothing to clean up for basic scans since they
    # never touch disk in the first place.

    logger.info(
        "analysis.task.complete",
        extra={"analysis_id": analysis_id, "status": final_status, "score": report.composite_score},
    )

    return {"success": final_status == "Completed", "analysis_id": analysis_id, "score": report.composite_score}