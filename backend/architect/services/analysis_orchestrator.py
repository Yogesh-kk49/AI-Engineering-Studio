"""
analysis_orchestrator.py
─────────────────────────────────────────────────────────────────────────────
Master orchestrator for the AI Engineering Studio.

Coordinates all analysis services and returns a single unified
AnalysisReport that the Django view/serialiser layer can consume.

Pipeline
  1. Clone / refresh repo  (GitHubClient)
  2. Architecture analysis (ArchitectService)
  3. Code quality analysis  (QualityService)
  4. Security scan          (SecurityService)
  5. Dependency health      (DependencyService)
  6. Future predictions     (PredictionsService)
  7. Assemble AnalysisReport

Steps 2–5 run concurrently in a thread pool (none of them depend on each
other's output); the orchestrator is designed to be called from a Celery
task so the Django request layer stays non-blocking.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from typing import Any, Callable
from analyzer.services.github_client import GitHubClient, RepoContext
from architect.services.architect_service import ArchitectService, ArchitectureResult
from architect.services.quality_service import QualityService, QualityResult
from architect.services.security_service import SecurityService, SecurityResult
from architect.services.dependancy_service import DependencyService, DependencyResult
from architect.services.predictions_service import PredictionsService, PredictionsResult

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Unified report
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class AnalysisReport:
    # Identity
    repo_url: str = ""
    owner: str = ""
    repo_name: str = ""
    full_name: str = ""
    default_branch: str = "main"
    analyzed_branch: str = ""
    commit_sha: str = ""
    analyzed_at: str = ""
    duration_seconds: float = 0.0
    # Absolute path of the cloned working copy on the server's filesystem.
    # Internal-use only (powers the "download as ZIP" feature) — stripped
    # out before the report is serialised for the frontend.
    local_path: str = ""

    # Presentation
    description: str = ""
    homepage: str = ""
    size_kb: int = 0
    archived: bool = False
    visibility: str = "public"

    # Author / owner info
    owner_login: str = ""
    owner_avatar_url: str = ""
    owner_html_url: str = ""
    owner_type: str = ""
    is_organization: bool = False

    # GitHub social stats
    stars: int = 0
    forks: int = 0
    watchers: int = 0
    open_issues: int = 0
    contributors: int = 0
    license_name: str = ""
    topics: list[str] = field(default_factory=list)
    languages: dict[str, int] = field(default_factory=dict)
    primary_language: str = ""
    created_at: str = ""
    updated_at: str = ""

    # File stats
    file_count: int = 0
    dir_count: int = 0

    # Capped, nested directory/file tree used to render the "Project
    # Structure" flowchart on the frontend. Shape:
    #   { name, type: "dir", children: [ {name, type: "dir"|"file"|"more", children?}, ... ] }
    file_tree: dict = field(default_factory=dict)

    # Presence flags (from RepoContext)
    has_readme: bool = False
    has_docker: bool = False
    has_docker_compose: bool = False
    has_requirements: bool = False
    has_package_json: bool = False
    has_github_actions: bool = False
    has_license: bool = False

    # Sub-results
    architecture: ArchitectureResult = field(default_factory=ArchitectureResult)
    quality: QualityResult = field(default_factory=QualityResult)
    security: SecurityResult = field(default_factory=SecurityResult)
    dependencies: DependencyResult = field(default_factory=DependencyResult)
    predictions: PredictionsResult = field(default_factory=PredictionsResult)

    # Optional AI-powered review (Gemini). Empty dict if GEMINI_API_KEY
    # isn't configured or the call failed — frontend should treat an
    # empty/missing dict as "AI review not available" rather than erroring.
    ai_review: dict = field(default_factory=dict)

    # Composite scores
    composite_score: float = 0.0       # 0–100 weighted aggregate
    composite_grade: str = "F"

    # Which pipeline produced this report — "basic" (API-only, no clone) or
    # "deep" (full clone + architecture/quality/security/dependency scan).
    scan_mode: str = "deep"

    # Basic-Scan-only fields. Left empty on a deep scan (that pipeline's
    # much richer `architecture`/`dependencies` results supersede these).
    basic_frameworks: list[str] = field(default_factory=list)
    basic_dependencies: dict = field(default_factory=dict)
    basic_recommendations: list[str] = field(default_factory=list)
    readme_preview: str = ""

    # Errors encountered during analysis
    errors: list[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ──────────────────────────────────────────────────────────────────────────────

class AnalysisOrchestrator:
    """
    Usage
    ─────
        report = AnalysisOrchestrator("https://github.com/owner/repo").run()
        report_dict = report_to_dict(report)
    """

    # Composite score weights (must sum to 1.0)
    _COMPOSITE_WEIGHTS = {
        "quality":      0.30,
        "security":     0.30,   # inverted: 100 - risk_score
        "dependencies": 0.20,
        "architecture": 0.10,   # confidence as proxy
        "predictions":  0.10,   # trajectory mapped to a score
    }

    def __init__(
        self,
        repo_url: str,
        *,
        branch: str = "",
        force_reclone: bool = False,
        deep_scan: bool = False,
        reuse_mode: str = "auto",
        progress_callback: "Callable[[str, int, str], None] | None" = None,
    ):
        self.repo_url = repo_url
        self.branch = branch
        self.force_reclone = force_reclone
        self.deep_scan = deep_scan
        # Passed straight through to GitHubClient — controls how an
        # already-cached clone on disk is treated (see GitHubClient docs).
        self.reuse_mode = reuse_mode
        # Optional hook: progress_callback(stage, percent, message). Called
        # by the Celery task to push live progress into the DB/WebSocket
        # without the orchestrator needing to know anything about Celery
        # or Django models — it only knows how to report "I'm at step X".
        self._progress_callback = progress_callback or (lambda stage, pct, msg: None)

    def _report_progress(self, stage: str, percent: int, message: str) -> None:
        try:
            self._progress_callback(stage, percent, message)
        except Exception:
            # Progress reporting must never break the analysis itself.
            pass

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def run_basic(self) -> AnalysisReport:
        """
        Fast Basic Scan pipeline — GitHub API only, never clones/downloads
        the repository. Populates identity/metadata, the file tree,
        framework detection, and basic dependency info + recommendations
        straight from the API, then returns. Typically ~1s for small repos
        and a few seconds for huge ones, since the only network cost is a
        handful of small API calls instead of downloading repo contents.
        """
        start = time.monotonic()
        report = AnalysisReport(repo_url=self.repo_url, scan_mode="basic")

        self._report_progress("Scanning", 20, "Fetching repository metadata...")
        ctx = GitHubClient(self.repo_url, branch=self.branch).build_basic()
        if not ctx.clone_success:
            report.errors.extend(ctx.errors)
            report.duration_seconds = round(time.monotonic() - start, 2)
            self._report_progress("Failed", 100, "Basic scan failed.")
            return report

        self._populate_repo_metadata(report, ctx)
        report.local_path = ""  # nothing on disk for a basic scan
        report.file_tree = self._build_file_tree(ctx)
        self._report_progress("Scanning", 60, "Detecting frameworks & dependencies...")

        # Fetch each key file's content exactly once, concurrently, and
        # reuse it for framework detection + dependency parsing + README
        # preview below. This used to fetch README/package.json/
        # requirements.txt sequentially — and package.json/requirements.txt
        # were each fetched *twice* (once for framework detection, once
        # for dependency parsing) — which on a repo with all three files
        # meant 5 sequential network round trips instead of up to 3
        # parallel ones.
        contents = self._fetch_key_files(ctx)

        report.basic_frameworks = self._basic_detect_frameworks(ctx, contents)
        report.basic_dependencies = self._basic_dependency_info(contents)
        report.readme_preview = (contents.get("readme") or "")[:2000]
        report.basic_recommendations = self._basic_recommendations(ctx, report)

        report.duration_seconds = round(time.monotonic() - start, 2)
        self._report_progress("Completed", 100, "Basic scan complete.")
        return report

    def _basic_file_content(self, ctx: RepoContext, path: str) -> str:
        try:
            from analyzer.services.github_client import fetch_file_content
            result = fetch_file_content(ctx.owner, ctx.repo_name, ctx.commit_sha or "HEAD", path)
            return result.get("content", "") if "content" in result else ""
        except Exception:
            return ""

    def _fetch_key_files(self, ctx: RepoContext) -> dict[str, str]:
        """Concurrently fetches README / package.json / requirements.txt
        content (whichever are present) in a single round of parallel
        requests, keyed by a short label ("readme"/"package_json"/
        "requirements") — the one place these files are ever fetched for
        a Basic Scan."""
        wanted: dict[str, str] = {}
        readme_path = next(
            (str(f) for f in ctx.all_files if f.name.lower().startswith("readme")), ""
        )
        if readme_path:
            wanted["readme"] = readme_path
        if ctx.has_package_json:
            pkg_path = next((str(f) for f in ctx.all_files if f.name.lower() == "package.json"), "")
            if pkg_path:
                wanted["package_json"] = pkg_path
        if ctx.has_requirements:
            req_path = next((str(f) for f in ctx.all_files if f.name.lower() == "requirements.txt"), "")
            if req_path:
                wanted["requirements"] = req_path

        if not wanted:
            return {}

        results: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=len(wanted), thread_name_prefix="basic-scan-fetch") as pool:
            futures = {
                pool.submit(self._basic_file_content, ctx, path): label
                for label, path in wanted.items()
            }
            for future, label in futures.items():
                results[label] = future.result()
        return results

    def _basic_detect_frameworks(self, ctx: RepoContext, contents: dict[str, str]) -> list[str]:
        names = {f.name.lower() for f in ctx.all_files}
        found: set[str] = set()

        pkg_content = contents.get("package_json", "")
        if pkg_content:
            deps_blob = pkg_content.lower()
            for keyword, label in (
                ("\"react\"", "React"), ("\"next\"", "Next.js"), ("\"vue\"", "Vue.js"),
                ("\"@angular/core\"", "Angular"), ("\"express\"", "Express"),
                ("\"nestjs\"", "NestJS"), ("\"svelte\"", "Svelte"), ("\"vite\"", "Vite"),
            ):
                if keyword in deps_blob:
                    found.add(label)

        req_content = contents.get("requirements", "").lower()
        if req_content:
            for keyword, label in (
                ("django", "Django"), ("flask", "Flask"), ("fastapi", "FastAPI"),
                ("celery", "Celery"), ("pytest", "Pytest"),
            ):
                if keyword in req_content:
                    found.add(label)

        if "manage.py" in names:
            found.add("Django")
        if "angular.json" in names:
            found.add("Angular")
        if any(n in names for n in ("next.config.js", "next.config.mjs")):
            found.add("Next.js")
        if any(n in names for n in ("tailwind.config.js", "tailwind.config.ts")):
            found.add("TailwindCSS")

        return sorted(found)

    def _basic_dependency_info(self, contents: dict[str, str]) -> dict:
        """Lightweight dependency listing (name → version-or-spec) parsed
        straight from already-fetched package.json / requirements.txt
        content — no resolution, no vulnerability lookup (that's what
        Deep Scan's DependencyService is for), and no re-fetching."""
        info: dict[str, Any] = {}

        pkg_content = contents.get("package_json", "")
        if pkg_content:
            try:
                import json as _json
                data = _json.loads(pkg_content)
                deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
                if deps:
                    info["npm"] = deps
            except Exception:
                pass

        req_content = contents.get("requirements", "")
        if req_content:
            pip_deps: dict[str, str] = {}
            for line in req_content.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                for sep in ("==", ">=", "<=", "~=", ">", "<"):
                    if sep in line:
                        name, _, ver = line.partition(sep)
                        pip_deps[name.strip()] = f"{sep}{ver.strip()}"
                        break
                else:
                    pip_deps[line] = ""
            if pip_deps:
                info["pip"] = pip_deps

        return info

    def _basic_recommendations(self, ctx: RepoContext, report: AnalysisReport) -> list[str]:
        """Static, rule-based suggestions from presence flags alone —
        deliberately simple; Deep Scan's QualityService/SecurityService
        give the exhaustive, code-aware version of this."""
        recs: list[str] = []
        if not ctx.has_readme:
            recs.append("Add a README to help newcomers understand the project.")
        if not ctx.has_license:
            recs.append("Add a LICENSE file to clarify how others can use this project.")
        if not ctx.has_github_actions:
            recs.append("Consider adding a GitHub Actions workflow for CI.")
        if not ctx.has_dockerfile and not ctx.has_docker_compose:
            recs.append("Consider adding a Dockerfile for easier deployment.")
        if not report.basic_dependencies:
            recs.append("No dependency manifest detected — consider adding package.json or requirements.txt.")
        if not recs:
            recs.append("No obvious gaps found at a glance — run a Deep Scan for a thorough review.")
        return recs

    def run(self) -> AnalysisReport:
        start = time.monotonic()
        report = AnalysisReport(repo_url=self.repo_url)

        # ── Step 1: Clone & metadata ──────────────────────────────────
        self._report_progress("Cloning", 10, "Cloning repository...")
        t0 = time.monotonic()
        ctx = self._step_clone(report)
        logger.warning("TIMING clone+metadata: %.2fs", time.monotonic() - t0)
        if not ctx.clone_success:
            report.errors.extend(ctx.errors)
            report.duration_seconds = round(time.monotonic() - start, 2)
            self._report_progress("Failed", 100, "Clone failed.")
            return report

        t0 = time.monotonic()
        self._populate_repo_metadata(report, ctx)
        report.file_tree = self._build_file_tree(ctx)
        logger.warning("TIMING populate_metadata+file_tree: %.2fs", time.monotonic() - t0)
        self._report_progress("Scanning", 30, "Scanning repository structure...")

        # ── Steps 2–5: Architecture / Quality / Security / Dependencies ──
        # None of these four depend on each other's output — they each only
        # read from the already-cloned `ctx` (RepoContext.all_files is built
        # once up front and shared, read-only). Running them one after
        # another was pure wasted wall-clock time: each step's file I/O and
        # regex/AST parsing was blocking the next step from starting. A
        # thread pool lets their disk reads and parsing overlap instead of
        # queueing behind each other — this is usually the single biggest
        # chunk of total analysis time, so this is where it matters most.
        self._report_progress("Scanning", 40, "Analyzing architecture, quality, security & dependencies...")
        t0 = time.monotonic()
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="analysis-step") as pool:
            arch_future  = pool.submit(self._timed_step, "architecture", self._step_architecture, ctx, report)
            qual_future  = pool.submit(self._timed_step, "quality", self._step_quality, ctx, report)
            sec_future   = pool.submit(self._timed_step, "security", self._step_security, ctx, report)
            deps_future  = pool.submit(self._timed_step, "dependencies", self._step_dependencies, ctx, report)

            arch    = arch_future.result()
            quality = qual_future.result()
            security = sec_future.result()
            deps    = deps_future.result()
        logger.warning("TIMING architecture+quality+security+dependencies (parallel, wall clock): %.2fs", time.monotonic() - t0)
        self._report_progress("AI Analysis", 75, "Running predictions...")

        # ── Step 6: Predictions ───────────────────────────────────────
        t0 = time.monotonic()
        predictions = self._step_predictions(ctx, arch, quality, security, report)
        logger.warning("TIMING predictions: %.2fs", time.monotonic() - t0)

        # ── Step 6.5: AI review (optional — no-op if no GEMINI_API_KEY) ──
        self._report_progress("AI Analysis", 82, "Running AI-powered review...")
        t0 = time.monotonic()
        ai_review = self._step_ai_review(ctx, quality, security, report)
        logger.warning("TIMING ai_review: %.2fs", time.monotonic() - t0)
        self._report_progress("Generating Report", 90, "Generating final report...")

        # ── Step 7: Assemble ──────────────────────────────────────────
        report.architecture = arch
        report.quality = quality
        report.security = security
        report.dependencies = deps
        report.predictions = predictions
        report.ai_review = ai_review
        report.composite_score, report.composite_grade = self._composite(quality, security, deps, arch, predictions)
        report.duration_seconds = round(time.monotonic() - start, 2)
        logger.warning("TIMING TOTAL: %.2fs", report.duration_seconds)
        self._report_progress("Completed", 100, "Analysis complete.")

        return report

    def _step_ai_review(self, ctx: RepoContext, quality: QualityResult,
                         security: SecurityResult, report: AnalysisReport) -> dict:
        """
        Feeds the AI a curated, size-capped context (repo metadata + the
        top hotspot files quality already identified + top security
        findings) rather than the raw repo — cheaper, faster, and gives
        the model exactly what a human reviewer would look at first
        instead of drowning it in boilerplate. Entirely optional: returns
        {} immediately if GEMINI_API_KEY isn't configured, and never lets
        an AI failure take down the rest of the analysis.
        """
        try:
            from agents.gemini_agent import GeminiAgent
            agent = GeminiAgent()
            if not agent.enabled:
                return {}

            hotspot_files = []
            for h in (quality.hotspots or [])[:5]:
                try:
                    full_path = ctx.local_path / h["file"]
                    content = full_path.read_text(encoding="utf-8", errors="ignore")
                    hotspot_files.append({"file": h["file"], "content": content, "reasons": h.get("reasons", "")})
                except Exception:
                    continue

            context = {
                "full_name": ctx.full_name,
                "description": ctx.description,
                "languages": ctx.languages,
                "composite_score": report.composite_score,
                "quality_summary": quality.summary,
                "top_security_findings": [
                    {"title": f.title, "severity": f.severity, "file": f.file, "description": f.description}
                    for f in (security.findings or [])[:10]
                ],
                "hotspot_files": hotspot_files,
            }
            return agent.review_repository(context)
        except Exception as exc:
            report.errors.append(f"AI review failed: {exc}")
            return {}

    def _timed_step(self, name: str, fn, *args):
        t0 = time.monotonic()
        result = fn(*args)
        logger.warning("TIMING   %s (inside pool): %.2fs", name, time.monotonic() - t0)
        return result

    # ------------------------------------------------------------------
    # Pipeline steps
    # ------------------------------------------------------------------

    def _step_clone(self, report: AnalysisReport) -> RepoContext:
        try:
            ctx = GitHubClient(
                self.repo_url, branch=self.branch,
                force_reclone=self.force_reclone, reuse_mode=self.reuse_mode,
            ).build()
            return ctx
        except Exception as exc:
            report.errors.append(f"Clone step failed: {exc}")
            return RepoContext(owner="", repo_name="", url=self.repo_url)

    def _step_architecture(self, ctx: RepoContext, report: AnalysisReport) -> ArchitectureResult:
        try:
            return ArchitectService(ctx).analyze()
        except Exception as exc:
            report.errors.append(f"Architecture analysis failed: {exc}")
            return ArchitectureResult()

    def _step_quality(self, ctx: RepoContext, report: AnalysisReport) -> QualityResult:
        try:
            return QualityService(ctx, deep_scan=self.deep_scan).analyze()
        except Exception as exc:
            report.errors.append(f"Quality analysis failed: {exc}")
            return QualityResult()

    def _step_security(self, ctx: RepoContext, report: AnalysisReport) -> SecurityResult:
        try:
            def on_file_progress(done: int, total: int) -> None:
                # This step shares the 40%→75% band with architecture/
                # quality/dependencies, which are typically much faster —
                # security is usually the long pole on a deep scan, so we
                # scale its own file-by-file progress across most of that
                # band rather than treating it as an all-or-nothing chunk.
                pct = 40 + int((done / total) * 33) if total else 40
                self._report_progress("Scanning", min(pct, 73),
                                       f"Security scan: {done:,}/{total:,} files checked...")
            return SecurityService(ctx, deep_scan=self.deep_scan, file_progress_callback=on_file_progress).analyze()
        except Exception as exc:
            report.errors.append(f"Security analysis failed: {exc}")
            return SecurityResult()

    def _step_dependencies(self, ctx: RepoContext, report: AnalysisReport) -> DependencyResult:
        try:
            return DependencyService(ctx).analyze()
        except Exception as exc:
            report.errors.append(f"Dependency analysis failed: {exc}")
            return DependencyResult()

    def _step_predictions(
        self,
        ctx: RepoContext,
        arch: ArchitectureResult,
        quality: QualityResult,
        security: SecurityResult,
        report: AnalysisReport,
    ) -> PredictionsResult:
        try:
            return PredictionsService(ctx, arch, quality, security).analyze()
        except Exception as exc:
            report.errors.append(f"Predictions analysis failed: {exc}")
            return PredictionsResult()

    # ------------------------------------------------------------------
    # Metadata population
    # ------------------------------------------------------------------

    def _populate_repo_metadata(self, report: AnalysisReport, ctx: RepoContext) -> None:
        import datetime
        report.owner = ctx.owner
        report.repo_name = ctx.repo_name
        report.full_name = ctx.full_name
        report.local_path = str(ctx.local_path)
        report.default_branch = ctx.default_branch
        report.analyzed_branch = ctx.requested_branch or ctx.default_branch
        report.commit_sha = ctx.commit_sha
        report.analyzed_at = datetime.datetime.utcnow().isoformat() + "Z"

        report.description = ctx.description
        report.homepage = ctx.homepage
        report.size_kb = ctx.size_kb
        report.archived = ctx.archived
        report.visibility = ctx.visibility

        report.owner_login = ctx.owner_login
        report.owner_avatar_url = ctx.owner_avatar_url
        report.owner_html_url = ctx.owner_html_url
        report.owner_type = ctx.owner_type
        report.is_organization = ctx.is_organization

        report.stars = ctx.stargazers_count
        report.forks = ctx.forks_count
        report.watchers = ctx.watchers_count
        report.open_issues = ctx.open_issues_count
        report.contributors = ctx.contributors_count
        report.license_name = ctx.license_name
        report.topics = ctx.topics
        report.languages = ctx.languages
        report.created_at = ctx.created_at
        report.updated_at = ctx.updated_at
        report.file_count = ctx.file_count
        report.dir_count = ctx.dir_count
        report.errors.extend(ctx.errors)

        # Presence flags
        report.has_readme = ctx.has_readme
        report.has_docker = ctx.has_dockerfile
        report.has_docker_compose = ctx.has_docker_compose
        report.has_requirements = ctx.has_requirements
        report.has_package_json = ctx.has_package_json
        report.has_github_actions = ctx.has_github_actions
        report.has_license = ctx.has_license

        # Primary language = highest byte count
        if ctx.languages:
            report.primary_language = max(ctx.languages, key=ctx.languages.get)  # type: ignore[arg-type]

    # ------------------------------------------------------------------
    # File tree (for the "Project Structure" flowchart view)
    # ------------------------------------------------------------------

    # These used to hard-cap the tree (15 siblings / 6 levels deep) and
    # simply *discard* everything past the cap behind a dead-end "+N more"
    # label with no way to actually see those files. The frontend now does
    # its own progressive "show more" disclosure per directory, so the
    # backend just needs a sane outer safety limit to avoid pathological
    # payload sizes on enormous monorepos — not a per-directory cap.
    _TREE_MAX_DEPTH = 40
    _TREE_MAX_CHILDREN_PER_DIR = 100_000

    def _build_file_tree(self, ctx: RepoContext) -> dict:
        if not ctx.all_files and not ctx.all_dirs:
            return {}

        # First pass: build a plain nested dict keyed by path segment, so
        # directories implied by file paths exist even if all_dirs missed
        # an edge case (e.g. an empty repo root).
        raw: dict[str, Any] = {}

        def insert(parts: tuple, is_file: bool) -> None:
            node = raw
            for i, part in enumerate(parts):
                is_last = i == len(parts) - 1
                entry = node.setdefault(part, {"__is_file__": False, "__children__": {}})
                if is_last and is_file:
                    entry["__is_file__"] = True
                node = entry["__children__"]

        for d in ctx.all_dirs:
            if d.parts:
                insert(d.parts, is_file=False)
        for f in ctx.all_files:
            if f.parts:
                insert(f.parts, is_file=True)

        # Second pass: convert to the capped {name, type, children} shape
        # the frontend renders, sorting directories before files.
        def convert(node_dict: dict, depth: int) -> list[dict]:
            items = sorted(
                node_dict.items(),
                key=lambda kv: (kv[1]["__is_file__"], kv[0].lower()),
            )
            children: list[dict] = []
            for name, meta in items[: self._TREE_MAX_CHILDREN_PER_DIR]:
                if meta["__is_file__"]:
                    children.append({"name": name, "type": "file"})
                else:
                    if depth >= self._TREE_MAX_DEPTH:
                        children.append({"name": name, "type": "dir", "children": [], "truncated": True})
                    else:
                        children.append({
                            "name": name, "type": "dir",
                            "children": convert(meta["__children__"], depth + 1),
                        })

            overflow = len(items) - self._TREE_MAX_CHILDREN_PER_DIR
            if overflow > 0:
                children.append({"name": f"{overflow} more item{'s' if overflow != 1 else ''}", "type": "more"})

            return children

        return {
            "name": ctx.repo_name or "repository",
            "type": "dir",
            "children": convert(raw, depth=1),
        }

    # ------------------------------------------------------------------
    # Composite score
    # ------------------------------------------------------------------

    def _composite(
        self,
        quality: QualityResult,
        security: SecurityResult,
        deps: DependencyResult,
        arch: ArchitectureResult,
        preds: PredictionsResult,
    ) -> tuple[float, str]:
        traj_score = {"POSITIVE": 80, "NEUTRAL": 60, "NEGATIVE": 30}.get(preds.overall_trajectory, 60)

        raw = (
            quality.overall_score               * self._COMPOSITE_WEIGHTS["quality"]
            + (100 - security.risk_score)       * self._COMPOSITE_WEIGHTS["security"]
            + deps.health_score                 * self._COMPOSITE_WEIGHTS["dependencies"]
            + arch.confidence                   * self._COMPOSITE_WEIGHTS["architecture"]
            + traj_score                        * self._COMPOSITE_WEIGHTS["predictions"]
        )
        score = round(raw, 1)

        if score >= 85: grade = "A"
        elif score >= 70: grade = "B"
        elif score >= 55: grade = "C"
        elif score >= 40: grade = "D"
        else: grade = "F"

        return score, grade


# ──────────────────────────────────────────────────────────────────────────────
# Serialisation helper
# ──────────────────────────────────────────────────────────────────────────────

def report_to_dict(report: AnalysisReport) -> dict[str, Any]:
    """
    Recursively convert the AnalysisReport dataclass tree to a JSON-safe dict.
    Suitable for Django REST Framework serialiser responses or direct json.dumps.
    """
    def _convert(obj: Any) -> Any:
        if hasattr(obj, "__dataclass_fields__"):
            return {k: _convert(v) for k, v in asdict(obj).items() if k != "local_path"}
        if isinstance(obj, list):
            return [_convert(i) for i in obj]
        if isinstance(obj, dict):
            return {k: _convert(v) for k, v in obj.items()}
        return obj

    return _convert(report)