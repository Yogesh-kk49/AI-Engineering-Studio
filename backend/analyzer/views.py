import logging
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import requests
from django.conf import settings
from django.db import close_old_connections
from django.http import FileResponse, HttpResponse, StreamingHttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RepositoryAnalysis
from .serializers import RepositoryAnalysisSerializer
from .services.export_service import build_markdown_report, build_pdf_report
from .services.github_client import (
    _parse_github_url, get_latest_commit_sha, CLONE_BASE_DIR,
    fetch_file_content,
)
from .tasks import run_repository_analysis

logger = logging.getLogger(__name__)


class AnalyzeRepositoryView(APIView):
    """
    POST /api/analyze/

    Kicks off an asynchronous analysis job on Celery and returns immediately
    with the job's id + status so the frontend can start polling progress.
    Does NOT block the request/response cycle on the scan/analyze pipeline
    — that all happens on a background worker.

    Body:
      repo_url       (required)
      branch         (optional)
      scan_mode      "basic" (default) or "deep".
                       - "basic": GitHub-API-only, never clones. Fast (~1-5s).
                       - "deep": full clone + architecture/quality/security/
                         dependency pipeline. The clone is cached on disk
                         and reused by future scans (see repo_action).
      deep_scan      (deep scans only) exhaustive per-file sampling, no cap.
      force_reclone  force a brand-new download even if one is cached.
      repo_action    (deep scans only) resolves the duplicate-protection
                       prompt: "use_existing" | "update" | "fresh". Omit it
                       on the first request for a repo that's already
                       cached on disk and this view responds with
                       "duplicate": true + the available options instead of
                       queuing a job, so the frontend can ask the user.

    Repository cache: before queuing a new job, does a cheap GitHub API call
    (no cloning) to check the latest commit SHA on the requested branch. If
    we already have a Completed analysis for this exact repo_url + branch +
    commit_sha + scan_mode, that cached result is returned immediately
    instead of re-running the whole pipeline — this is what makes a rescan
    of an unchanged repo return in milliseconds. Re-analysis only happens
    when the commit has actually changed, the cache lookup is inconclusive
    (private repo, rate limited, etc.), or the caller explicitly passes
    force_reclone.
    """

    def post(self, request):
        repo_url = request.data.get("repo_url", "").strip()
        branch = request.data.get("branch", "").strip()
        force_reclone = bool(request.data.get("force_reclone", False))
        deep_scan = bool(request.data.get("deep_scan", False))
        scan_mode = (request.data.get("scan_mode") or "basic").strip().lower()
        if scan_mode not in ("basic", "deep"):
            scan_mode = "basic"
        repo_action = (request.data.get("repo_action") or "").strip().lower() or None

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
        # Skipped for deep_scan (exhaustive) requests — a cached result may
        # have been produced by a sampled run, and returning that would
        # silently give the caller sampled data when they explicitly asked
        # for exhaustive coverage.
        latest_sha = None
        if not force_reclone and not deep_scan:
            latest_sha = get_latest_commit_sha(owner, repo_name, branch or None)
            if latest_sha:
                cached = (
                    RepositoryAnalysis.objects.filter(
                        repo_url=repo_url, branch=branch, commit_sha=latest_sha,
                        scan_mode=scan_mode, status="Completed",
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

        # ── Duplicate protection (deep scans only) ────────────────────────
        # A deep scan is the only thing that ever puts a real copy of the
        # repo on disk. If one's already cached there from an earlier deep
        # scan, don't silently pick a behavior — ask the caller which of
        # the three options they want, unless they've already told us via
        # repo_action (e.g. this is the follow-up request after the user
        # picked one).
        if scan_mode == "deep" and not repo_action:
            existing_deep = (
                RepositoryAnalysis.objects.filter(
                    repo_url=repo_url, branch=branch, scan_mode="deep",
                    status="Completed",
                )
                .exclude(repository_path="")
                .order_by("-created_at")
                .first()
            )
            if existing_deep and Path(existing_deep.repository_path).exists():
                return Response(
                    {
                        "success": True,
                        "duplicate": True,
                        "message": "Repository already downloaded.",
                        "data": RepositoryAnalysisSerializer(existing_deep).data,
                        "options": [
                            {"value": "use_existing", "label": "Use Existing Repository"},
                            {"value": "update", "label": "Update Repository"},
                            {"value": "fresh", "label": "Download Fresh Copy"},
                        ],
                    },
                    status=status.HTTP_200_OK,
                )

        analysis = RepositoryAnalysis.objects.create(
            repo_url=repo_url,
            branch=branch,
            project_name=project_name,
            status="Queued",
            progress_percent=0,
            progress_message="Repository submitted.",
            commit_sha=latest_sha or "",
            scan_mode=scan_mode,
        )

        # When a real Celery broker (Redis) is configured, .delay() queues
        # the job onto a worker and this view returns immediately, exactly
        # as documented above. But when USE_REDIS is off, Celery falls
        # back to CELERY_TASK_ALWAYS_EAGER — .delay() then runs the *entire*
        # scan/analyze pipeline synchronously, right here, before this
        # request can return. That silently breaks the "kicks off an
        # asynchronous job and returns immediately" contract this view
        # promises: a Basic Scan that should take ~1-3s instead holds the
        # HTTP connection open (and the frontend's button spinner frozen)
        # for however long the whole pipeline takes — several seconds for
        # Basic, potentially a minute+ for Deep. Running it on a plain
        # background thread in that case restores the intended behavior
        # (fast response, progress via polling) without requiring a real
        # Celery worker process for local/dev use.
        if getattr(settings, "USE_REDIS", False):
            task = run_repository_analysis.delay(
                analysis.pk, repo_url, branch, force_reclone, deep_scan, scan_mode, repo_action or "auto",
            )
            task_id = task.id
        else:
            def _run_in_background():
                # A brand-new thread doesn't inherit the request thread's
                # DB connection — Django would normally open one lazily on
                # first query, but explicitly closing any stale handle
                # first (and again after finishing) keeps this consistent
                # with how a real Celery worker process manages its own
                # connection lifecycle per task.
                close_old_connections()
                try:
                    run_repository_analysis(
                        analysis.pk, repo_url, branch, force_reclone, deep_scan, scan_mode, repo_action or "auto",
                    )
                finally:
                    close_old_connections()

            thread = threading.Thread(target=_run_in_background, daemon=True, name=f"analysis-{analysis.pk}")
            thread.start()
            task_id = ""

        RepositoryAnalysis.objects.filter(pk=analysis.pk).update(celery_task_id=task_id)
        analysis.refresh_from_db()

        return Response(
            {
                "success": True,
                "cached": False,
                "duplicate": False,
                "message": "Analysis queued.",
                "task_id": task_id,
                "data": RepositoryAnalysisSerializer(analysis).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class RepositoryAnalysisListView(APIView):
    def get(self, request):
        analyses = RepositoryAnalysis.objects.all()
        data = RepositoryAnalysisSerializer(analyses, many=True).data

        # A card only reads these five values from `metadata` while
        # collapsed (project name, file count, status, etc. all come from
        # plain model fields, already present above) — everything else
        # (file_tree, security findings, quality hotspots, dependency
        # lists, architecture patterns, predictions, the AI review write-
        # up) only ever gets read once a card is expanded. Sending all of
        # that for *every* analysis on every list load means the payload
        # scales with the total number of analyses ever run, not with how
        # many are actually open — a single Deep Scan's full metadata can
        # be 1MB+ on its own, and this list can have dozens of rows.
        # AnalysisCard fetches the full detail lazily the first time a
        # given card is expanded (see `analysis/<id>/` below), so trimming
        # this here doesn't lose anything the list view itself shows.
        for row in data:
            full_meta = row.get("metadata") or {}
            quality = full_meta.get("quality") or {}
            security = full_meta.get("security") or {}
            row["metadata"] = {
                "primary_language": full_meta.get("primary_language"),
                "stars": full_meta.get("stars"),
                "composite_score": full_meta.get("composite_score"),
                **({"quality": {"overall_score": quality["overall_score"]}} if quality.get("overall_score") is not None else {}),
                **({"security": {"risk_score": security["risk_score"]}} if security.get("risk_score") is not None else {}),
            }

        return Response({"count": analyses.count(), "results": data})


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
    own "Download ZIP" button. Optimized to avoid duplicate/unnecessary
    downloads:

      • Deep scan already cached on disk (analysis.repository_path exists)
        → zip straight from that cached copy. No network call at all.
      • Basic scan only (nothing cloned) → proxy GitHub's own codeload ZIP
        endpoint directly to the client. No clone happens on our side
        either — we never touch disk for this case.
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

        # ── Case 1: already cloned & cached on disk — zip it directly ────
        cached_dir = Path(analysis.repository_path) if analysis.repository_path else None
        if cached_dir and cached_dir.exists():
            return self._zip_from_disk(analysis, cached_dir)

        # ── Case 2: basic scan only — proxy GitHub's ZIP API, no clone ───
        try:
            owner, repo_name = _parse_github_url(analysis.repo_url)
        except ValueError:
            return Response({"error": "Could not resolve this analysis's repository."}, status=status.HTTP_400_BAD_REQUEST)

        ref = analysis.commit_sha or analysis.branch or "HEAD"
        codeload_url = f"https://codeload.github.com/{owner}/{repo_name}/zip/{ref}"
        try:
            upstream = requests.get(codeload_url, stream=True, timeout=(10, 120))
            upstream.raise_for_status()
        except requests.exceptions.RequestException:
            logger.error("download.codeload_failed", extra={"analysis_id": pk, "repo_url": analysis.repo_url}, exc_info=True)
            return Response(
                {"error": "Could not fetch the repository ZIP from GitHub. It may be private, deleted, or rate-limited."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        filename = f"{analysis.project_name or 'repository'}.zip"
        response = StreamingHttpResponse(
            upstream.iter_content(chunk_size=65536),
            content_type="application/zip",
        )
        # codeload.github.com often does send a Content-Length even though
        # it's building the archive on the fly — forward it when present so
        # the frontend can show a real percentage instead of just a raw
        # byte count. When GitHub streams it chunked with no known size
        # (no header), there's nothing to forward and the client falls back
        # to showing bytes-received instead of a percentage.
        content_length = upstream.headers.get("Content-Length")
        if content_length:
            response["Content-Length"] = content_length
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    def _zip_from_disk(self, analysis, repo_dir: Path):
        try:
            # Safety: only ever zip something that actually lives under the
            # configured clone directory.
            repo_dir.resolve().relative_to(CLONE_BASE_DIR.resolve())
        except ValueError:
            return Response({"error": "Cached repository path is invalid."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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
                        extra={"analysis_id": analysis.pk, "path": str(file_path)},
                    )
        if skipped:
            logger.warning("download.files_skipped_total", extra={"analysis_id": analysis.pk, "count": skipped})
        buffer.seek(0)

        # NOTE: the cached clone is deliberately NOT deleted here — it's
        # the whole point of the cache: a repeat download (or a future
        # deep scan of the same repo) reuses this same copy instantly
        # instead of re-downloading from GitHub.
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
        t_start = time.monotonic()
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
        t_fetch = time.monotonic()
        is_first_turn = len(history) == 0
        if owner:
            # Hotspot files are ~40K characters of context — resending them
            # on every single follow-up message means every turn after the
            # first pays for re-fetching AND re-processing that much extra
            # prompt content, even for something like "thanks" or a
            # question about a totally different file. The model already
            # saw them in its own earlier reply (preserved in `history`),
            # so only load them fresh on the first message of a
            # conversation; later turns only fetch files newly mentioned.
            # "Hotspot files" here means "whatever the analysis flagged as
            # needing attention" from the user's point of view — which
            # includes the security findings shown in the Security tab, not
            # just the quality analyzer's complexity hotspots. Previously
            # only the latter were pre-fetched, so a generic follow-up like
            # "write a test for one of the hotspot files" (referring to a
            # file the user only ever saw flagged as a security finding)
            # had no content loaded and the model — correctly, given what
            # it was actually shown — asked the user to paste the file
            # itself instead of just writing the test.
            severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            sorted_findings = sorted(
                (f for f in (security.get("findings") or []) if f.get("file")),
                key=lambda f: severity_rank.get(str(f.get("severity", "")).lower(), 4),
            )
            security_hotspot_paths = []
            security_hotspot_reasons = {}
            for f in sorted_findings:
                p = f.get("file", "").replace("\\", "/")
                if p in security_hotspot_reasons:
                    continue
                security_hotspot_reasons[p] = f"{f.get('severity', '?')} security finding: {f.get('title', '')}"
                security_hotspot_paths.append(p)
                if len(security_hotspot_paths) >= 3:
                    break

            quality_hotspot_paths = [h.get("file", "").replace("\\", "/") for h in (quality.get("hotspots") or [])[:3] if h.get("file")]
            hotspot_reasons = {h.get("file", "").replace("\\", "/"): h.get("reasons", "") for h in (quality.get("hotspots") or [])}
            hotspot_reasons.update(security_hotspot_reasons)

            combined_paths, seen_paths = [], set()
            for p in quality_hotspot_paths + security_hotspot_paths:
                if p and p not in seen_paths:
                    seen_paths.add(p)
                    combined_paths.append(p)

            hotspot_paths = combined_paths[:6] if is_first_turn else []
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

        logger.warning("TIMING chat.file_fetch: %.2fs (hotspot=%d, extra=%d, first_turn=%s)",
                       time.monotonic() - t_fetch, len(hotspot_files), len(extra_files), is_first_turn)

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

        t_gemini = time.monotonic()
        result = agent.chat(context, history, message)
        logger.warning("TIMING chat.gemini_call: %.2fs", time.monotonic() - t_gemini)
        logger.warning("TIMING chat.TOTAL: %.2fs", time.monotonic() - t_start)

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