import logging
import zipfile
from io import BytesIO
from pathlib import Path

from django.http import FileResponse, HttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RepositoryAnalysis
from .serializers import RepositoryAnalysisSerializer
from .services.export_service import build_markdown_report, build_pdf_report
from .services.github_client import (
    _parse_github_url, get_latest_commit_sha, CLONE_BASE_DIR, GitHubClient, force_rmtree,
    fetch_file_content,
)
from .tasks import run_repository_analysis

logger = logging.getLogger(__name__)


class AnalyzeRepositoryView(APIView):
    """
    POST /api/analyze/

    Kicks off an asynchronous analysis job on Celery and returns immediately
    with the job's id + status so the frontend can start polling progress.
    Does NOT block the request/response cycle on the clone/scan/analyze
    pipeline — that all happens on a background worker.

    Repository cache: before queuing a new job, does a cheap GitHub API call
    (no cloning) to check the latest commit SHA on the requested branch. If
    we already have a Completed analysis for this exact repo_url + branch +
    commit_sha, that cached result is returned immediately instead of
    re-running the whole pipeline. Re-clone only happens when the commit has
    actually changed, the cache lookup is inconclusive (private repo, rate
    limited, etc.), or the caller explicitly passes force_reclone.
    """

    def post(self, request):
        repo_url = request.data.get("repo_url", "").strip()
        branch = request.data.get("branch", "").strip()
        force_reclone = bool(request.data.get("force_reclone", False))

        if not repo_url:
            return Response({"error": "repo_url is required."}, status=status.HTTP_400_BAD_REQUEST)
        if "github.com" not in repo_url:
            return Response({"error": "Only GitHub repositories are supported."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            owner, repo_name = _parse_github_url(repo_url)
        except ValueError:
            return Response({"error": "Could not parse a valid GitHub owner/repo from that URL."},
                             status=status.HTTP_400_BAD_REQUEST)

        project_name = repo_name

        # ── Repository cache check (commit-SHA based) ────────────────────
        latest_sha = None
        if not force_reclone:
            latest_sha = get_latest_commit_sha(owner, repo_name, branch or None)
            if latest_sha:
                cached = (
                    RepositoryAnalysis.objects.filter(
                        repo_url=repo_url, branch=branch, commit_sha=latest_sha, status="Completed",
                    )
                    .order_by("-created_at")
                    .first()
                )
                if cached:
                    logger.info(
                        "analysis.cache_hit",
                        extra={"repo_url": repo_url, "analysis_id": cached.pk, "commit_sha": latest_sha},
                    )
                    return Response(
                        {
                            "success": True,
                            "cached": True,
                            "message": "Repository hasn't changed since the last analysis — returning cached result.",
                            "commit_sha": latest_sha,
                            "data": RepositoryAnalysisSerializer(cached).data,
                        },
                        status=status.HTTP_200_OK,
                    )
            # latest_sha is None means we couldn't determine it cheaply
            # (private repo, rate limited, branch doesn't exist yet, etc.)
            # — fall through and let the full pipeline figure it out.

        analysis = RepositoryAnalysis.objects.create(
            repo_url=repo_url,
            branch=branch,
            project_name=project_name,
            status="Queued",
            progress_percent=0,
            progress_message="Repository submitted.",
            commit_sha=latest_sha or "",
        )

        task = run_repository_analysis.delay(analysis.pk, repo_url, branch, force_reclone)
        RepositoryAnalysis.objects.filter(pk=analysis.pk).update(celery_task_id=task.id)
        analysis.refresh_from_db()

        return Response(
            {
                "success": True,
                "cached": False,
                "message": "Analysis queued.",
                "task_id": task.id,
                "data": RepositoryAnalysisSerializer(analysis).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class RepositoryAnalysisListView(APIView):
    def get(self, request):
        analyses = RepositoryAnalysis.objects.all()
        return Response({"count": analyses.count(), "results": RepositoryAnalysisSerializer(analyses, many=True).data})


class RepositoryAnalysisDetailView(APIView):
    def get(self, request, pk):
        try:
            analysis = RepositoryAnalysis.objects.get(pk=pk)
        except RepositoryAnalysis.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(RepositoryAnalysisSerializer(analysis).data)

    def delete(self, request, pk):
        try:
            RepositoryAnalysis.objects.get(pk=pk).delete()
        except RepositoryAnalysis.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RepositoryAnalysisProgressView(APIView):
    """
    GET /api/analysis/<id>/progress/

    Lightweight polling endpoint for the frontend's step tracker. Returns
    just the fields needed to render progress — not the full (potentially
    large) metadata blob — so polling every 1-2s stays cheap.
    """

    def get(self, request, pk):
        try:
            analysis = RepositoryAnalysis.objects.only(
                "id", "status", "progress_percent", "progress_message",
                "error_message", "started_at", "completed_at",
            ).get(pk=pk)
        except RepositoryAnalysis.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "id": analysis.pk,
            "status": analysis.status,
            "progress_percent": analysis.progress_percent,
            "progress_message": analysis.progress_message,
            "error_message": analysis.error_message,
            "is_terminal": analysis.is_terminal,
            "started_at": analysis.started_at,
            "completed_at": analysis.completed_at,
        })


class DownloadRepositoryZipView(APIView):
    """
    GET /api/analysis/<id>/download/

    Streams the repository back to the client as a .zip, mirroring GitHub's
    own "Download ZIP" button. This app runs locally on the user's machine,
    so repos are NOT kept cloned on disk between analyses (see tasks.py) —
    this view clones a fresh, temporary copy only when the button is
    actually clicked, zips it into memory, then deletes the temp clone
    immediately afterward. Nothing lingers on the user's PC either way.
    """

    def get(self, request, pk):
        try:
            analysis = RepositoryAnalysis.objects.get(pk=pk)
        except RepositoryAnalysis.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if analysis.status != "Completed":
            return Response(
                {"error": "This analysis hasn't completed successfully, so there's nothing to download yet."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            ctx = GitHubClient(analysis.repo_url, branch=analysis.branch, force_reclone=True).build()
        except Exception:
            logger.error("download.clone_failed", extra={"analysis_id": pk, "repo_url": analysis.repo_url}, exc_info=True)
            return Response(
                {"error": "Could not fetch the repository for download. It may be private, deleted, or rate-limited."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if not ctx.clone_success or not ctx.local_path or not ctx.local_path.exists():
            return Response(
                {"error": "Could not fetch the repository for download."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        repo_dir = ctx.local_path
        try:
            # Safety: only ever zip something that actually lives under the
            # configured clone directory.
            repo_dir.resolve().relative_to(CLONE_BASE_DIR.resolve())

            buffer = BytesIO()
            skipped = 0
            with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
                for file_path in repo_dir.rglob("*"):
                    try:
                        if not file_path.is_file():
                            continue
                        rel_parts = file_path.relative_to(repo_dir).parts
                        if rel_parts and rel_parts[0] == ".git":
                            continue
                        arcname = Path(analysis.project_name or "repository") / file_path.relative_to(repo_dir)
                        zf.write(file_path, arcname=str(arcname))
                    except OSError:
                        # A handful of files can vanish or be unreadable
                        # between listing and writing — most commonly
                        # Windows MAX_PATH edge cases on very deeply
                        # nested repos. Skip that one file rather than
                        # failing the entire download.
                        skipped += 1
                        logger.warning(
                            "download.file_skipped",
                            extra={"analysis_id": pk, "path": str(file_path)},
                        )
            if skipped:
                logger.warning("download.files_skipped_total", extra={"analysis_id": pk, "count": skipped})
            buffer.seek(0)
        finally:
            # The zip is fully built in memory at this point, so it's safe
            # to remove the temporary clone immediately — this download
            # endpoint never leaves repo files sitting on the user's disk,
            # win or fail.
            if not force_rmtree(repo_dir):
                logger.warning("download.cleanup_incomplete", extra={"analysis_id": pk, "path": str(repo_dir)})

        filename = f"{analysis.project_name or 'repository'}.zip"
        return FileResponse(buffer, as_attachment=True, filename=filename, content_type="application/zip")


class AnalysisFileContentView(APIView):
    """
    GET /api/analysis/<id>/file/?path=relative/path/to/file.py

    Powers the "view code" action from the Project Structure / File Flow
    Chart tabs. Fetches the file straight from GitHub's raw content CDN
    using the analysis's stored repo_url + branch/commit — no git clone
    involved, so nothing ever touches the user's disk for this.
    """

    def get(self, request, pk):
        try:
            analysis = RepositoryAnalysis.objects.get(pk=pk)
        except RepositoryAnalysis.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        path = (request.query_params.get("path") or "").strip()
        if not path:
            return Response({"error": "path query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            owner, repo_name = _parse_github_url(analysis.repo_url)
        except ValueError:
            return Response({"error": "Could not resolve this analysis's repository."}, status=status.HTTP_400_BAD_REQUEST)

        ref = analysis.commit_sha or analysis.branch or "HEAD"
        result = fetch_file_content(owner, repo_name, ref, path)
        if "error" in result:
            return Response(result, status=status.HTTP_404_NOT_FOUND)
        return Response({"path": path, **result})


def _get_completed_analysis_or_error(pk):
    """Shared lookup for the two export views below — both need a
    Completed analysis with metadata to build a report from."""
    try:
        analysis = RepositoryAnalysis.objects.get(pk=pk)
    except RepositoryAnalysis.DoesNotExist:
        return None, Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if analysis.status != "Completed" or not analysis.metadata:
        return None, Response(
            {"error": "This analysis hasn't completed successfully, so there's no report to export yet."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return analysis, None


class ExportMarkdownView(APIView):
    """GET /api/analysis/<id>/export/markdown/ — downloads a one-click
    Markdown summary report (scores, findings, architecture, recommendations)."""

    def get(self, request, pk):
        analysis, error = _get_completed_analysis_or_error(pk)
        if error:
            return error

        try:
            content = build_markdown_report(analysis)
        except Exception:
            logger.error("export.markdown_failed", extra={"analysis_id": pk}, exc_info=True)
            return Response({"error": "Could not generate the Markdown report."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        filename = f"{analysis.project_name or 'repository'}-report.md"
        response = HttpResponse(content, content_type="text/markdown; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class ExportPdfView(APIView):
    """GET /api/analysis/<id>/export/pdf/ — downloads a one-click PDF
    summary report, same content as the Markdown export, formatted as a
    printable document."""

    def get(self, request, pk):
        analysis, error = _get_completed_analysis_or_error(pk)
        if error:
            return error

        try:
            content = build_pdf_report(analysis)
        except Exception:
            logger.error("export.pdf_failed", extra={"analysis_id": pk}, exc_info=True)
            return Response({"error": "Could not generate the PDF report."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        filename = f"{analysis.project_name or 'repository'}-report.pdf"
        response = HttpResponse(content, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response