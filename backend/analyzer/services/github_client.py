"""
github_client.py
─────────────────────────────────────────────────────────────────────────────
Unified GitHub API + local-clone utilities for the AI Engineering Studio.

Responsibilities
  • Clone / refresh a repository from a public or private GitHub URL
  • Pull rich metadata from the GitHub REST API (languages, topics, releases…)
  • Expose a RepoContext dataclass that every analysis service consumes
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import stat
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from django.core.cache import cache

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

GITHUB_API_BASE = "https://api.github.com"
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")          # optional – raises rate-limit cap
CLONE_BASE_DIR = Path(os.getenv("REPO_CLONE_DIR") or (Path(tempfile.gettempdir()) / "ai_studio_repos"))
REQUEST_TIMEOUT = 15   # seconds


def _long_path(path: Path) -> str:
    """
    On Windows, prefix a path with the `\\\\?\\` extended-length marker so
    filesystem calls bypass the 260-character MAX_PATH limit. This is what
    lets us delete (and, in _clone_or_update, check out) files at paths
    that would otherwise silently fail — Django's test suite is exactly
    the kind of repo that has paths deep enough to hit this. No-op on
    non-Windows platforms.
    """
    if os.name != "nt":
        return str(path)
    s = str(path.resolve())
    if s.startswith("\\\\?\\"):
        return s
    if s.startswith("\\\\"):  # UNC path
        return "\\\\?\\UNC\\" + s.lstrip("\\")
    return "\\\\?\\" + s


def force_rmtree(path) -> bool:
    """
    Delete a directory tree, including on Windows where git marks many
    files inside .git/ as read-only AND where deeply nested repos (e.g.
    Django's test suite) can exceed the 260-char MAX_PATH limit — a plain
    shutil.rmtree(ignore_errors=True) silently fails on both and leaves
    the folder (mostly) behind, which is exactly what was piling up clones
    in CLONE_BASE_DIR. This clears the read-only bit on any file that
    fails to delete and retries via the `\\\\?\\`-prefixed long-path form
    before giving up on it.

    Also removes the parent "owner" folder afterward if it's now empty
    (clones are namespaced as CLONE_BASE_DIR/<owner>/<repo>@<branch>, so an
    empty owner folder is just leftover clutter once its only repo clone
    is gone) — but only ever within CLONE_BASE_DIR itself, never beyond it.

    Returns True if the path no longer exists afterward, False otherwise.
    """
    path = Path(path)
    if not path.exists():
        return True

    stubborn: list[str] = []

    def _on_error(func, target_path, exc_info):
        # First retry: just clear the read-only bit.
        try:
            os.chmod(target_path, stat.S_IWRITE)
            func(target_path)
            return
        except Exception:
            pass
        # Second retry: same operation, but through the long-path-safe form
        # in case this failed because of MAX_PATH rather than permissions.
        try:
            lp = _long_path(Path(target_path))
            os.chmod(lp, stat.S_IWRITE)
            func(lp)
            return
        except Exception:
            stubborn.append(str(target_path))

    shutil.rmtree(_long_path(path) if os.name == "nt" else path, onerror=_on_error)
    ok = not path.exists()

    if stubborn:
        # One summary line instead of one log record per file — a large
        # Django-sized repo can otherwise produce thousands of near-
        # identical warnings and flood the console.
        logger.warning(
            "force_rmtree.stubborn_paths",
            extra={"path": str(path), "count": len(stubborn), "sample": stubborn[:5]},
        )

    parent = path.parent
    try:
        if (
            ok
            and parent != CLONE_BASE_DIR
            and parent.resolve().is_relative_to(CLONE_BASE_DIR.resolve())
            and parent.exists()
            and not any(parent.iterdir())
        ):
            parent.rmdir()
    except Exception:
        pass  # leftover empty owner folder is harmless — never fail the caller over it

    return ok

# How long we trust cached GitHub API responses for. Two different TTLs:
#   - commit SHA lookups are cheap & need to be fairly fresh (catch new pushes
#     quickly) so they get a short TTL.
#   - full repo metadata (stars, languages, topics, …) changes slowly, so it
#     gets a longer TTL to conserve the GitHub rate limit (60/hr unauthenticated).
COMMIT_SHA_CACHE_TTL = 60          # seconds
REPO_METADATA_CACHE_TTL = 60 * 10  # 10 minutes


# ──────────────────────────────────────────────────────────────────────────────
# Data structures
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class RepoContext:
    """
    Everything downstream analysis services need.
    Passed around instead of re-fetching / re-walking repeatedly.
    """
    # Identity
    owner: str
    repo_name: str
    url: str
    default_branch: str = "main"
    requested_branch: str = ""   # branch the caller asked for, "" = use default
    full_name: str = ""          # "owner/repo"

    # Commit identity — used for the repository cache (skip re-clone when
    # the latest commit on the analyzed branch hasn't changed).
    commit_sha: str = ""

    # Local clone
    local_path: Path = field(default_factory=Path)
    clone_success: bool = False

    # GitHub API metadata
    api_data: dict[str, Any] = field(default_factory=dict)
    languages: dict[str, int] = field(default_factory=dict)       # {"Python": 45312, …}
    topics: list[str] = field(default_factory=list)
    contributors_count: int = 0
    open_issues_count: int = 0
    stargazers_count: int = 0
    forks_count: int = 0
    watchers_count: int = 0
    subscribers_count: int = 0
    license_name: str = ""
    has_wiki: bool = False
    has_pages: bool = False
    created_at: str = ""
    updated_at: str = ""
    pushed_at: str = ""

    # Repo description / presentation
    description: str = ""
    homepage: str = ""
    size_kb: int = 0
    archived: bool = False
    disabled: bool = False
    visibility: str = "public"

    # Owner / author info — used for the "Display Author Information" UI
    owner_login: str = ""
    owner_avatar_url: str = ""
    owner_html_url: str = ""
    owner_type: str = ""          # "User" or "Organization"
    is_organization: bool = False

    # File-system walk cache (populated by _walk_repo)
    all_files: list[Path] = field(default_factory=list)
    all_dirs: list[Path] = field(default_factory=list)
    file_count: int = 0
    dir_count: int = 0

    # Quick presence flags
    has_readme: bool = False
    has_dockerfile: bool = False
    has_docker_compose: bool = False
    has_requirements: bool = False
    has_package_json: bool = False
    has_pyproject: bool = False
    has_setup_py: bool = False
    has_github_actions: bool = False
    has_pre_commit: bool = False
    has_env_example: bool = False
    has_makefile: bool = False
    has_license: bool = False

    errors: list[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _parse_github_url(url: str) -> tuple[str, str]:
    """Return (owner, repo_name) or raise ValueError."""
    url = url.strip().rstrip("/").removesuffix(".git")
    # ssh  git@github.com:owner/repo
    if url.startswith("git@"):
        match = re.match(r"git@github\.com[:/]([^/]+)/(.+)", url)
        if match:
            return match.group(1), match.group(2)
    # https
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 2 and "github.com" in (parsed.netloc or ""):
        return parts[0], parts[1]
    raise ValueError(f"Cannot parse GitHub URL: {url!r}")


def _api_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def _get(endpoint: str) -> dict | list:
    """GET from GitHub REST API; returns parsed JSON."""
    resp = requests.get(
        f"{GITHUB_API_BASE}{endpoint}",
        headers=_api_headers(),
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def _get_cached(endpoint: str, ttl: int, cache_key: str) -> dict | list | None:
    """
    Cached GET. Returns None (rather than raising) on any failure so callers
    can fall back gracefully — e.g. treat "can't reach GitHub right now" the
    same as "no cached commit info, go ahead and clone".
    """
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        data = _get(endpoint)
    except requests.exceptions.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code == 403:
            logger.warning("github_api.rate_limited", extra={"endpoint": endpoint})
        elif status_code == 404:
            logger.info("github_api.not_found", extra={"endpoint": endpoint})
        else:
            logger.warning("github_api.http_error", extra={"endpoint": endpoint, "status": status_code})
        return None
    except Exception as exc:
        logger.warning("github_api.error", extra={"endpoint": endpoint, "error": str(exc)})
        return None

    cache.set(cache_key, data, ttl)
    return data


def get_repo_summary(owner: str, repo: str) -> dict | None:
    """
    Lightweight, cached fetch of just the top-level repo object (default
    branch, stars, description, owner info, …). Used to resolve which
    branch to check before doing a commit-SHA lookup, and to power
    "repository info card" UI without requiring a clone.
    """
    cache_key = f"gh:repo:{owner}/{repo}"
    return _get_cached(f"/repos/{owner}/{repo}", REPO_METADATA_CACHE_TTL, cache_key)


FILE_CONTENT_MAX_BYTES = 1_000_000  # 1MB — plenty for source files, keeps requests fast


def fetch_file_content(owner: str, repo: str, ref: str, path: str) -> dict[str, Any]:
    """
    Fetch a single file's text content straight from GitHub's raw content
    CDN — no git clone required. This powers the in-app code viewer (the
    "click a file to view its code" feature) without ever touching the
    user's disk, keeping repos cloneless for anything short of an actual
    ZIP download.

    Returns {"content": str, "truncated": bool} on success, or
    {"error": str} on failure (not found, binary/too large, network error).
    """
    ref = ref or "HEAD"
    safe_path = "/".join(seg for seg in path.split("/") if seg not in ("..", ""))
    if not safe_path:
        return {"error": "Invalid file path."}

    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{safe_path}"
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, stream=True)
        if resp.status_code == 404:
            return {"error": "File not found at this branch/commit."}
        resp.raise_for_status()

        chunks: list[bytes] = []
        total = 0
        truncated = False
        for chunk in resp.iter_content(chunk_size=65536):
            if not chunk:
                continue
            total += len(chunk)
            if total > FILE_CONTENT_MAX_BYTES:
                truncated = True
                break
            chunks.append(chunk)
        raw = b"".join(chunks)

        if b"\x00" in raw[:8000]:
            return {"error": "This looks like a binary file and can't be displayed as text."}

        text = raw.decode("utf-8", errors="replace")
        return {"content": text, "truncated": truncated, "size": total}
    except requests.exceptions.RequestException as exc:
        logger.warning("fetch_file_content.error", extra={"owner": owner, "repo": repo, "path": path, "error": str(exc)})
        return {"error": "Could not fetch this file from GitHub."}


def get_latest_commit_sha(owner: str, repo: str, branch: str | None = None) -> str | None:
    """
    Cheap way to ask "has this repo changed?" without cloning anything.
    Returns the current HEAD commit SHA for `branch` (or the repo's default
    branch if not given), or None if it couldn't be determined (private
    repo without access, rate-limited, repo/branch doesn't exist, etc).

    Cached for COMMIT_SHA_CACHE_TTL seconds so a burst of duplicate
    "analyze this repo" requests doesn't hammer the GitHub API.
    """
    resolved_branch = branch
    if not resolved_branch:
        summary = get_repo_summary(owner, repo)
        if not summary or not isinstance(summary, dict):
            return None
        resolved_branch = summary.get("default_branch", "main")

    cache_key = f"gh:commit_sha:{owner}/{repo}:{resolved_branch}"
    data = _get_cached(
        f"/repos/{owner}/{repo}/commits/{resolved_branch}",
        COMMIT_SHA_CACHE_TTL,
        cache_key,
    )
    if not data or not isinstance(data, dict):
        return None
    return data.get("sha")


# ──────────────────────────────────────────────────────────────────────────────
# Core class
# ──────────────────────────────────────────────────────────────────────────────

class GitHubClient:
    """
    Fetches metadata + clones a GitHub repo, returns a populated RepoContext.

    Usage
    ─────
        ctx = GitHubClient("https://github.com/psf/requests").build()
    """

    def __init__(self, repo_url: str, *, branch: str = "", force_reclone: bool = False):
        self.url = repo_url
        self.force_reclone = force_reclone
        self.requested_branch = branch.strip()
        self.owner, self.repo_name = _parse_github_url(repo_url)
        self.ctx = RepoContext(
            owner=self.owner,
            repo_name=self.repo_name,
            url=repo_url,
            requested_branch=self.requested_branch,
            full_name=f"{self.owner}/{self.repo_name}",
        )

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def build(self) -> RepoContext:
        self._fetch_api_metadata()
        self._clone_or_update()
        if self.ctx.clone_success:
            self._walk_repo()
            self._set_presence_flags()
        return self.ctx

    # ------------------------------------------------------------------
    # API metadata
    # ------------------------------------------------------------------

    def _fetch_api_metadata(self) -> None:
        data = get_repo_summary(self.owner, self.repo_name)
        if data and isinstance(data, dict):
            self.ctx.api_data = data
            self.ctx.default_branch = data.get("default_branch", "main")
            self.ctx.full_name = data.get("full_name", self.ctx.full_name)
            self.ctx.description = data.get("description") or ""
            self.ctx.homepage = data.get("homepage") or ""
            self.ctx.size_kb = data.get("size", 0)
            self.ctx.archived = data.get("archived", False)
            self.ctx.disabled = data.get("disabled", False)
            self.ctx.visibility = data.get("visibility", "public")
            self.ctx.stargazers_count = data.get("stargazers_count", 0)
            self.ctx.forks_count = data.get("forks_count", 0)
            self.ctx.watchers_count = data.get("watchers_count", 0)
            self.ctx.subscribers_count = data.get("subscribers_count", 0)
            self.ctx.open_issues_count = data.get("open_issues_count", 0)
            self.ctx.has_wiki = data.get("has_wiki", False)
            self.ctx.has_pages = data.get("has_pages", False)
            self.ctx.created_at = data.get("created_at", "")
            self.ctx.updated_at = data.get("updated_at", "")
            self.ctx.pushed_at = data.get("pushed_at", "")
            self.ctx.topics = data.get("topics", [])
            lic = data.get("license") or {}
            self.ctx.license_name = lic.get("name", "")

            owner_data = data.get("owner") or {}
            self.ctx.owner_login = owner_data.get("login", self.owner)
            self.ctx.owner_avatar_url = owner_data.get("avatar_url", "")
            self.ctx.owner_html_url = owner_data.get("html_url", f"https://github.com/{self.owner}")
            self.ctx.owner_type = owner_data.get("type", "User")
            self.ctx.is_organization = self.ctx.owner_type.lower() == "organization"
        else:
            self.ctx.errors.append(
                "API metadata error: could not reach GitHub or repository not found/accessible."
            )

        try:
            langs: dict = _get(f"/repos/{self.owner}/{self.repo_name}/languages")  # type: ignore[assignment]
            self.ctx.languages = langs
        except Exception as exc:
            self.ctx.errors.append(f"Languages API error: {exc}")

        try:
            resp = requests.get(
                f"{GITHUB_API_BASE}/repos/{self.owner}/{self.repo_name}/contributors",
                headers=_api_headers(),
                params={"per_page": 1, "anon": "true"},
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            # GitHub paginates contributors; with per_page=1 the Link header's
            # "last" page number IS the total contributor count.
            link_header = resp.headers.get("Link", "")
            match = re.search(r'[?&]page=(\d+)>;\s*rel="last"', link_header)
            if match:
                self.ctx.contributors_count = int(match.group(1))
            else:
                body = resp.json()
                self.ctx.contributors_count = len(body) if isinstance(body, list) else 0
        except Exception:
            pass  # non-critical — contributor count is a nice-to-have

    # ------------------------------------------------------------------
    # Clone / update
    # ------------------------------------------------------------------

    def _clone_or_update(self) -> None:
        branch = self.requested_branch or self.ctx.default_branch or "main"
        self.ctx.default_branch = self.ctx.default_branch or branch

        CLONE_BASE_DIR.mkdir(parents=True, exist_ok=True)
        # Namespace by branch so analyzing two branches of the same repo
        # doesn't clobber each other's working copy.
        safe_branch = re.sub(r"[^A-Za-z0-9._-]", "_", branch)
        dest = CLONE_BASE_DIR / self.owner / f"{self.repo_name}@{safe_branch}"

        if dest.exists() and self.force_reclone:
            if not force_rmtree(dest) and dest.exists():
                # Windows MAX_PATH can leave a handful of deeply-nested
                # files behind even after force_rmtree's retries. Rather
                # than fail (or clone on top of stale files), clone into a
                # fresh, uniquely-named sibling directory instead. The
                # stale one is orphaned but harmless — it holds no repo
                # data users would recognize, and gets swept up by a
                # future force_rmtree pass once its long-path files age out.
                dest = CLONE_BASE_DIR / self.owner / f"{self.repo_name}@{safe_branch}__{os.getpid()}"

        self.ctx.local_path = dest

        # -c core.longpaths=true tells git for Windows to use the
        # `\\?\`-prefixed extended-length path form internally when
        # checking out files, instead of silently skipping anything past
        # the 260-char MAX_PATH limit — exactly what was truncating deep
        # test-suite paths (e.g. Django's tests/forms_tests/field_tests/...)
        # during checkout. Harmless no-op on macOS/Linux.
        GIT_LONGPATHS = ["-c", "core.longpaths=true"]

        try:
            if dest.exists():
                subprocess.run(
                    ["git", *GIT_LONGPATHS, "-C", str(dest), "fetch", "--quiet",
                     "--depth", "1", "--no-tags", "origin", branch],
                    check=True, capture_output=True, timeout=120,
                )
                subprocess.run(
                    ["git", *GIT_LONGPATHS, "-C", str(dest), "reset", "--quiet", "--hard", "origin/" + branch],
                    check=True, capture_output=True, timeout=60,
                )
            else:
                clone_url = self._build_clone_url()
                subprocess.run(
                    ["git", *GIT_LONGPATHS, "clone", "--depth", "1", "--quiet",
                     "--single-branch", "--no-tags", "--branch", branch,
                     clone_url, str(dest)],
                    check=True, capture_output=True, timeout=180,
                )
            self.ctx.clone_success = True

            # Capture the exact commit we ended up on — this is what powers
            # the repository cache (skip re-analysis when the SHA matches a
            # previously completed analysis for this repo+branch).
            sha_result = subprocess.run(
                ["git", "-C", str(dest), "rev-parse", "HEAD"],
                check=True, capture_output=True, timeout=15,
            )
            self.ctx.commit_sha = sha_result.stdout.decode().strip()

        except subprocess.CalledProcessError as exc:
            self.ctx.errors.append(f"Git error: {exc.stderr.decode()[:300]}")
        except Exception as exc:
            self.ctx.errors.append(f"Clone error: {exc}")

    def _build_clone_url(self) -> str:
        if GITHUB_TOKEN:
            return f"https://{GITHUB_TOKEN}@github.com/{self.owner}/{self.repo_name}.git"
        return f"https://github.com/{self.owner}/{self.repo_name}.git"

    # ------------------------------------------------------------------
    # File-system walk
    # ------------------------------------------------------------------

    _SKIP_DIRS = {
        ".git", "node_modules", "__pycache__", ".tox", "venv", ".venv",
        "env", ".env", "dist", "build", ".mypy_cache", ".pytest_cache",
        "htmlcov", ".eggs", "*.egg-info",
    }

    def _walk_repo(self) -> None:
        files: list[Path] = []
        dirs: list[Path] = []
        root = self.ctx.local_path

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames
                if d not in self._SKIP_DIRS and not d.startswith(".")
            ]
            rel_dir = Path(dirpath).relative_to(root)
            if str(rel_dir) != ".":
                dirs.append(rel_dir)
            for fn in filenames:
                files.append((Path(dirpath) / fn).relative_to(root))

        self.ctx.all_files = files
        self.ctx.all_dirs = dirs
        self.ctx.file_count = len(files)
        self.ctx.dir_count = len(dirs)

    # ------------------------------------------------------------------
    # Presence flags
    # ------------------------------------------------------------------

    def _set_presence_flags(self) -> None:
        names = {f.name.lower() for f in self.ctx.all_files}
        parts_set = {str(f).lower() for f in self.ctx.all_files}

        self.ctx.has_readme = any(n.startswith("readme") for n in names)
        self.ctx.has_dockerfile = "dockerfile" in names
        self.ctx.has_docker_compose = any(
            n in names for n in ("docker-compose.yml", "docker-compose.yaml")
        )
        self.ctx.has_requirements = "requirements.txt" in names
        self.ctx.has_package_json = "package.json" in names
        self.ctx.has_pyproject = "pyproject.toml" in names
        self.ctx.has_setup_py = "setup.py" in names
        self.ctx.has_github_actions = any(
            ".github/workflows" in p for p in parts_set
        )
        self.ctx.has_pre_commit = ".pre-commit-config.yaml" in names
        self.ctx.has_env_example = any(
            n in names for n in (".env.example", ".env.sample", ".env.template")
        )
        self.ctx.has_makefile = "makefile" in names
        self.ctx.has_license = any(n.startswith("license") for n in names)