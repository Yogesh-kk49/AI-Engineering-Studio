import logging
import zipfile
from concurrent.futures import ThreadPoolExecutor
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
        deep_scan = bool(request.data.get("deep_scan", False))

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
        # Skipped for deep_scan requests too — a cached result may have
        # been produced by a sampled (non-deep) run, and returning that
        # would silently give the caller sampled data when they explicitly
        # asked for exhaustive coverage.
        latest_sha = None
        if not force_reclone and not deep_scan:
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

        task = run_repository_analysis.delay(analysis.pk, repo_url, branch, force_reclone, deep_scan)
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


def _flatten_file_tree(node: dict, paths: list, prefix: str = "") -> None:
    """Walk the capped file_tree dict (as stored in analysis.metadata) and
    collect a flat list of file paths, for feeding a lightweight file
    listing to the chat context without needing a fresh clone."""
    if not isinstance(node, dict):
        return
    name = node.get("name", "")
    full = f"{prefix}/{name}" if prefix else name
    if node.get("type") == "file":
        if full:
            paths.append(full)
        return
    for child in node.get("children") or []:
        _flatten_file_tree(child, paths, full)


class RepositoryChatView(APIView):
    """
    POST /api/analysis/<id>/chat/
    Body: {"message": str, "history": [{"role": "user"|"model", "content": str}, ...]}

    An AI chat interface scoped to one already-analyzed repository. Reuses
    the same GeminiAgent as the AI-review pipeline step, but conversational
    and able to generate code on request. Context is assembled from the
    already-computed report (metadata) plus, when the user's message
    mentions a specific file by name, that file's live content fetched
    straight from GitHub's raw CDN (cloneless, same mechanism as the code
    viewer) — so it can discuss/modify files beyond just the hotspots
    baked into the original analysis.
    """

    MAX_HISTORY_TURNS = 12  # server-side cap regardless of what the client sends

    def post(self, request, pk):
        analysis, error_response = _get_completed_analysis_or_error(pk)
        if error_response:
            return error_response

        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"error": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

        history = request.data.get("history") or []
        if not isinstance(history, list):
            history = []
        history = history[-self.MAX_HISTORY_TURNS:]

        m = analysis.metadata or {}
        quality = m.get("quality") or {}
        security = m.get("security") or {}

        file_paths: list = []
        _flatten_file_tree(m.get("file_tree") or {}, file_paths)

        # Which files is the user pointing at? This needs to look beyond
        # just the current message — a reply like "both" or "the first
        # one" only makes sense against files the *assistant* named in
        # its previous turn, which lives in `history`, not `message`.
        # Search the current message plus the last couple of turns.
        search_text = message + "\n" + "\n".join(
            str(turn.get("content", "")) for turn in history[-4:]
        )

        # Candidate paths come from two sources: the file tree (forward-
        # slash, since that's what flattening always produces) and the
        # raw `file` values already sitting in the findings/hotspots
        # (which on a Windows-run analysis are backslash-separated, since
        # they were built from `str(Path)` on that OS). Normalize both to
        # forward slashes for matching AND for the actual fetch — GitHub's
        # raw-content URLs require forward slashes regardless of what OS
        # produced the path originally.
        finding_paths = [f.get("file", "") for f in (security.get("findings") or []) if f.get("file")]
        hotspot_paths_raw = [h.get("file", "") for h in (quality.get("hotspots") or []) if h.get("file")]
        candidate_paths = {p.replace("\\", "/") for p in (file_paths + finding_paths + hotspot_paths_raw) if p}

        def _mentioned(path: str) -> bool:
            basename = path.split("/")[-1]
            windows_style = path.replace("/", "\\")
            return path in search_text or windows_style in search_text or basename in search_text

        try:
            owner, repo_name = _parse_github_url(analysis.repo_url)
            ref = analysis.commit_sha or analysis.branch or "HEAD"
        except ValueError:
            owner = repo_name = ref = None

        # Hotspot files — fetch their real content (this was previously
        # left as an empty string by mistake, which meant the model had
        # nothing but a filename to look at and, reasonably, asked the
        # user to paste the code themselves instead of reviewing it).
        #
        # Fetched concurrently rather than one-by-one: these are 5+
        # independent network calls to GitHub's raw CDN made on *every*
        # chat message (they don't change between turns in the same
        # conversation, but re-fetching is simpler and safer than adding
        # a cache here) — doing them sequentially would add real,
        # avoidable latency to every single message.
        hotspot_files = []
        extra_files = []
        if owner:
            hotspot_paths = [h.get("file", "").replace("\\", "/") for h in (quality.get("hotspots") or [])[:5] if h.get("file")]
            hotspot_reasons = {h.get("file", "").replace("\\", "/"): h.get("reasons", "") for h in (quality.get("hotspots") or [])}
            matched_paths = [p for p in candidate_paths if _mentioned(p)][:5]

            with ThreadPoolExecutor(max_workers=max(len(hotspot_paths) + len(matched_paths), 1)) as pool:
                hotspot_futures = {pool.submit(fetch_file_content, owner, repo_name, ref, p): p for p in hotspot_paths}
                extra_futures = {pool.submit(fetch_file_content, owner, repo_name, ref, p): p for p in matched_paths}

                for future, path in hotspot_futures.items():
                    result = future.result()
                    if "content" in result:
                        hotspot_files.append({"file": path, "content": result["content"], "reasons": hotspot_reasons.get(path, "")})

                for future, path in extra_futures.items():
                    result = future.result()
                    if "content" in result:
                        extra_files.append({"file": path, "content": result["content"]})

        context = {
            "full_name": m.get("full_name", analysis.project_name),
            "description": m.get("description", ""),
            "languages": m.get("languages", {}),
            "composite_score": m.get("composite_score"),
            "quality_summary": quality.get("summary", ""),
            "top_security_findings": [
                {"title": f.get("title"), "severity": f.get("severity"), "file": f.get("file")}
                for f in (security.get("findings") or [])[:10]
            ],
            "file_paths": file_paths,
            "hotspot_files": hotspot_files,
            "extra_files": extra_files,
        }

        from agents.gemini_agent import GeminiAgent
        agent = GeminiAgent()
        if not agent.enabled:
            return Response(
                {"error": "AI chat isn't available — GEMINI_API_KEY isn't configured on the server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        result = agent.chat(context, history, message)
        if result.get("error") and not result.get("reply"):
            return Response({"error": result["error"]}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"reply": result["reply"]})


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