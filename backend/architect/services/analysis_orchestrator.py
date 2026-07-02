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

    # Composite scores
    composite_score: float = 0.0       # 0–100 weighted aggregate
    composite_grade: str = "F"

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
        progress_callback: "Callable[[str, int, str], None] | None" = None,
    ):
        self.repo_url = repo_url
        self.branch = branch
        self.force_reclone = force_reclone
        self.deep_scan = deep_scan
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

    def run(self) -> AnalysisReport:
        start = time.monotonic()
        report = AnalysisReport(repo_url=self.repo_url)

        # ── Step 1: Clone & metadata ──────────────────────────────────
        self._report_progress("Cloning", 10, "Cloning repository...")
        ctx = self._step_clone(report)
        if not ctx.clone_success:
            report.errors.extend(ctx.errors)
            report.duration_seconds = round(time.monotonic() - start, 2)
            self._report_progress("Failed", 100, "Clone failed.")
            return report

        self._populate_repo_metadata(report, ctx)
        report.file_tree = self._build_file_tree(ctx)
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
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="analysis-step") as pool:
            arch_future  = pool.submit(self._step_architecture, ctx, report)
            qual_future  = pool.submit(self._step_quality, ctx, report)
            sec_future   = pool.submit(self._step_security, ctx, report)
            deps_future  = pool.submit(self._step_dependencies, ctx, report)

            arch    = arch_future.result()
            quality = qual_future.result()
            security = sec_future.result()
            deps    = deps_future.result()
        self._report_progress("AI Analysis", 75, "Running predictions...")

        # ── Step 6: Predictions ───────────────────────────────────────
        predictions = self._step_predictions(ctx, arch, quality, security, report)
        self._report_progress("Generating Report", 90, "Generating final report...")

        # ── Step 7: Assemble ──────────────────────────────────────────
        report.architecture = arch
        report.quality = quality
        report.security = security
        report.dependencies = deps
        report.predictions = predictions
        report.composite_score, report.composite_grade = self._composite(quality, security, deps, arch, predictions)
        report.duration_seconds = round(time.monotonic() - start, 2)
        self._report_progress("Completed", 100, "Analysis complete.")

        return report

    # ------------------------------------------------------------------
    # Pipeline steps
    # ------------------------------------------------------------------

    def _step_clone(self, report: AnalysisReport) -> RepoContext:
        try:
            ctx = GitHubClient(self.repo_url, branch=self.branch, force_reclone=self.force_reclone).build()
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
            return SecurityService(ctx, deep_scan=self.deep_scan).analyze()
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