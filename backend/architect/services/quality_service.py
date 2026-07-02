"""
quality_service.py
─────────────────────────────────────────────────────────────────────────────
Advanced code-quality analyser for the AI Engineering Studio.

Dimensions scored (each 0–100)
  1.  Maintainability   – complexity, file lengths, naming conventions
  2.  Test Coverage     – presence & depth of test suite
  3.  Documentation     – docstrings, README, inline comments ratio
  4.  Type Safety       – type annotations, mypy / pyright configs
  5.  Linting & Style   – linter configs, formatter presence
  6.  Security Hygiene  – hardcoded secrets scan, .env discipline
  7.  Dependency Health – pinned deps, lock files, known vulnerable patterns
  8.  CI Maturity       – stages detected in workflow files
  9.  Modularity        – avg file size, import coupling signals
  10. Dead Code Risk    – unused import patterns (heuristic)

Overall quality score = weighted average of the above.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import ast
import re
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from analyzer.services.github_client import RepoContext


# ──────────────────────────────────────────────────────────────────────────────
# Result
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class QualityDimension:
    name: str
    score: float          # 0–100
    grade: str            # A / B / C / D / F
    weight: float         # used for weighted avg
    findings: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


@dataclass
class QualityResult:
    overall_score: float = 0.0
    overall_grade: str = "F"
    dimensions: list[QualityDimension] = field(default_factory=list)
    hotspots: list[dict[str, Any]] = field(default_factory=list)   # files needing attention
    summary: str = ""


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _grade(score: float) -> str:
    if score >= 90: return "A"
    if score >= 75: return "B"
    if score >= 55: return "C"
    if score >= 35: return "D"
    return "F"


_SECRET_RE = re.compile(
    r"""(?xi)
    (password|secret|api_key|apikey|access_token|auth_token|private_key|passwd|pwd)
    \s*[=:]\s*
    ['"](?!{{)[^'"]{6,}['"]
    """,
    re.IGNORECASE,
)

_HARDCODED_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────

class QualityService:

    _WEIGHTS = {
        "Maintainability": 0.18,
        "Test Coverage":   0.16,
        "Documentation":   0.12,
        "Type Safety":     0.10,
        "Linting & Style": 0.10,
        "Security Hygiene":0.14,
        "Dependency Health":0.08,
        "CI Maturity":     0.07,
        "Modularity":      0.03,
        "Dead Code Risk":  0.02,
    }

    def __init__(self, ctx: RepoContext, *, deep_scan: bool = False):
        self.ctx = ctx
        self.root = ctx.local_path
        self.deep_scan = deep_scan
        self._py_files: list[Path] = []
        self._ts_files: list[Path] = []
        self._js_files: list[Path] = []
        self._all_src: list[Path] = []

    def _capped(self, items: list, limit: int) -> list:
        """Sample cap for expensive per-file reads. In deep-scan mode,
        every matching file is read instead of a bounded sample — slower,
        but exhaustive rather than representative."""
        return items if self.deep_scan else items[:limit]

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self) -> QualityResult:
        self._categorise_files()
        dimensions = [
            self._maintainability(),
            self._test_coverage(),
            self._documentation(),
            self._type_safety(),
            self._linting_style(),
            self._security_hygiene(),
            self._dependency_health(),
            self._ci_maturity(),
            self._modularity(),
            self._dead_code_risk(),
        ]
        overall = round(
            sum(d.score * self._WEIGHTS[d.name] for d in dimensions), 1
        )
        result = QualityResult(
            overall_score=overall,
            overall_grade=_grade(overall),
            dimensions=dimensions,
            hotspots=self._find_hotspots(),
            summary=self._build_summary(overall, dimensions),
        )
        return result

    # ------------------------------------------------------------------
    # File categorisation
    # ------------------------------------------------------------------

    def _categorise_files(self) -> None:
        for f in self.ctx.all_files:
            s = f.suffix.lower()
            full = self.root / f
            if s == ".py":
                self._py_files.append(full)
            elif s == ".ts" or s == ".tsx":
                self._ts_files.append(full)
            elif s == ".js" or s == ".jsx":
                self._js_files.append(full)
        self._all_src = self._py_files + self._ts_files + self._js_files

    # ------------------------------------------------------------------
    # 1. Maintainability
    # ------------------------------------------------------------------

    def _maintainability(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 100.0

        line_counts = []
        complex_files = []

        for path in self._capped(self._py_files, 300):          # sample cap
            try:
                source = path.read_text(encoding="utf-8", errors="ignore")
                lines = source.splitlines()
                line_counts.append(len(lines))

                if len(lines) > 500:
                    complex_files.append((str(path.relative_to(self.root)), len(lines)))
                    score -= 2

                # cyclomatic complexity heuristic: count branches
                branch_count = sum(
                    1 for ln in lines
                    if re.match(r"\s*(if|elif|for|while|except|with|case)\b", ln)
                )
                if branch_count > 60:
                    score -= 3
                    complex_files.append((str(path.relative_to(self.root)), branch_count))

            except Exception:
                pass

        if line_counts:
            avg = statistics.mean(line_counts)
            if avg > 250:
                findings.append(f"Average Python file length is {avg:.0f} lines (ideal < 200).")
                suggestions.append("Break large modules into smaller, single-responsibility files.")
                score -= 10

        if complex_files:
            findings.append(f"{len(complex_files)} files exceed complexity thresholds.")
            suggestions.append("Refactor complex files; aim for < 400 lines per file.")

        # Naming: detect classes/functions without CamelCase or snake_case
        bad_names = 0
        for path in self._capped(self._py_files, 100):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
                for node in ast.walk(tree):
                    if isinstance(node, ast.FunctionDef):
                        if re.search(r"[A-Z]", node.name) and not node.name.startswith("__"):
                            bad_names += 1
            except Exception:
                pass

        if bad_names > 5:
            findings.append(f"{bad_names} function names may violate snake_case convention.")
            suggestions.append("Follow PEP 8: use snake_case for functions, CamelCase for classes.")
            score -= min(bad_names, 15)

        return QualityDimension(
            "Maintainability", max(score, 0), _grade(max(score, 0)),
            self._WEIGHTS["Maintainability"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 2. Test Coverage
    # ------------------------------------------------------------------

    def _test_coverage(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 0.0

        file_names = {f.name.lower() for f in self.ctx.all_files}
        file_paths_str = {str(f).lower() for f in self.ctx.all_files}

        has_test_dir = any("test" in p or "spec" in p for p in {str(d).lower() for d in self.ctx.all_dirs})
        test_files = [
            f for f in self.ctx.all_files
            if f.name.startswith("test_") or f.name.endswith("_test.py")
            or "spec" in f.name or "test" in str(f).lower()
        ]

        if test_files:
            score += 30
            findings.append(f"Found {len(test_files)} test files.")

        # coverage config
        for cfg in ("pytest.ini", "setup.cfg", "pyproject.toml", ".coveragerc"):
            if cfg in file_names:
                score += 15
                findings.append(f"Coverage/test config found: {cfg}")
                break

        # pytest / unittest / jest
        req_text = self._read_text("requirements.txt") + self._read_text("pyproject.toml")
        pkg_text = self._read_text("package.json")

        if "pytest" in req_text:
            score += 15; findings.append("pytest detected.")
        if "unittest" in req_text or "unittest" in self._scan_imports():
            score += 10; findings.append("unittest detected.")
        if "coverage" in req_text:
            score += 10; findings.append("coverage.py detected.")

        for js_test in ("jest", "vitest", "mocha", "jasmine", "@testing-library"):
            if js_test in pkg_text.lower():
                score += 10; findings.append(f"{js_test} (JS test framework) detected.")

        ratio = len(test_files) / max(len(self._py_files), 1)
        if ratio < 0.1:
            suggestions.append("Test file ratio is low. Aim for at least 1 test file per 5 source files.")
        if score < 30:
            suggestions.append("No test suite detected. Add pytest with coverage reporting.")

        return QualityDimension(
            "Test Coverage", min(score, 100), _grade(min(score, 100)),
            self._WEIGHTS["Test Coverage"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 3. Documentation
    # ------------------------------------------------------------------

    def _documentation(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 0.0

        if self.ctx.has_readme:
            score += 25; findings.append("README found.")
        if self.ctx.has_license:
            score += 10; findings.append("LICENSE found.")

        # docstring ratio in Python files
        total_funcs = docstringed = 0
        for path in self._capped(self._py_files, 200):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        total_funcs += 1
                        if (
                            node.body
                            and isinstance(node.body[0], ast.Expr)
                            and isinstance(node.body[0].value, ast.Constant)
                        ):
                            docstringed += 1
            except Exception:
                pass

        if total_funcs > 0:
            ratio = docstringed / total_funcs
            score += round(ratio * 50, 1)
            findings.append(f"Docstring coverage: {ratio*100:.1f}% ({docstringed}/{total_funcs} items).")
            if ratio < 0.4:
                suggestions.append("Add docstrings to at least 50% of public functions and classes.")

        # Inline comment density
        inline_comments = 0
        total_lines = 0
        for path in self._capped(self._py_files, 100):
            try:
                lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
                total_lines += len(lines)
                inline_comments += sum(1 for ln in lines if ln.strip().startswith("#"))
            except Exception:
                pass

        if total_lines > 0:
            comment_ratio = inline_comments / total_lines
            if comment_ratio < 0.03:
                suggestions.append("Low inline comment density. Explain complex logic with comments.")
            else:
                score += 15
                findings.append(f"Comment density: {comment_ratio*100:.1f}%.")

        if not self.ctx.has_readme:
            suggestions.append("Add a README.md explaining the project, setup steps, and usage.")

        return QualityDimension(
            "Documentation", min(score, 100), _grade(min(score, 100)),
            self._WEIGHTS["Documentation"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 4. Type Safety
    # ------------------------------------------------------------------

    def _type_safety(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 0.0

        file_names = {f.name.lower() for f in self.ctx.all_files}

        if "mypy.ini" in file_names or "pyrightconfig.json" in file_names:
            score += 30; findings.append("Type checker config (mypy/pyright) found.")
        if self.ctx.has_pyproject:
            pyproject = self._read_text("pyproject.toml")
            if "[tool.mypy]" in pyproject or "[tool.pyright]" in pyproject:
                score += 20; findings.append("mypy/pyright configured in pyproject.toml.")

        # Count typed vs untyped functions
        typed = untyped = 0
        for path in self._capped(self._py_files, 150):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        has_ann = node.returns is not None or any(
                            a.annotation for a in node.args.args
                        )
                        if has_ann:
                            typed += 1
                        else:
                            untyped += 1
            except Exception:
                pass

        total = typed + untyped
        if total > 0:
            ratio = typed / total
            score += round(ratio * 50, 1)
            findings.append(f"Type annotation coverage: {ratio*100:.1f}% ({typed}/{total} functions).")
            if ratio < 0.3:
                suggestions.append("Increase type annotation coverage — target 80%+ with mypy strict mode.")
        else:
            suggestions.append("No Python functions found to assess; check non-Python type tooling.")

        if "typescript" in {t.lower() for t in self.ctx.languages.keys()}:
            score = min(score + 20, 100)
            findings.append("TypeScript detected — inherent type safety.")
            tsconfig = {f.name.lower() for f in self.ctx.all_files}
            if "tsconfig.json" in tsconfig:
                score = min(score + 10, 100)
                findings.append("tsconfig.json present.")

        return QualityDimension(
            "Type Safety", min(score, 100), _grade(min(score, 100)),
            self._WEIGHTS["Type Safety"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 5. Linting & Style
    # ------------------------------------------------------------------

    def _linting_style(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 0.0

        file_names = {f.name.lower() for f in self.ctx.all_files}
        pyproject = self._read_text("pyproject.toml").lower()
        setup_cfg = self._read_text("setup.cfg").lower()

        linters = {
            "ruff": (".ruff.toml" in file_names or "[tool.ruff]" in pyproject),
            "flake8": (".flake8" in file_names or "[flake8]" in setup_cfg),
            "pylint": (".pylintrc" in file_names or "pylintrc" in file_names),
            "black": ("[tool.black]" in pyproject or "black" in self._read_text("requirements.txt").lower()),
            "isort": ("[tool.isort]" in pyproject or ".isort.cfg" in file_names),
            "bandit": ("bandit" in self._read_text("requirements.txt").lower()),
            "eslint": (".eslintrc" in file_names or ".eslintrc.js" in file_names or ".eslintrc.json" in file_names),
            "prettier": (".prettierrc" in file_names or ".prettierrc.json" in file_names),
            "biome": ("biome.json" in file_names),
        }

        for name, detected in linters.items():
            if detected:
                score += 12
                findings.append(f"{name} configured.")

        if self.ctx.has_pre_commit:
            score += 15; findings.append(".pre-commit-config.yaml found.")

        if score < 24:
            suggestions.append("Configure a linter (ruff or flake8) and formatter (black/ruff format).")
        if not self.ctx.has_pre_commit:
            suggestions.append("Add pre-commit hooks to enforce style on every commit.")

        return QualityDimension(
            "Linting & Style", min(score, 100), _grade(min(score, 100)),
            self._WEIGHTS["Linting & Style"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 6. Security Hygiene
    # ------------------------------------------------------------------

    def _security_hygiene(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 100.0

        # .env discipline
        file_names = {f.name.lower() for f in self.ctx.all_files}
        if ".env" in file_names:
            score -= 25
            findings.append("⚠ .env file committed to repository — may expose secrets.")
            suggestions.append("Add .env to .gitignore immediately and rotate any leaked credentials.")
        if self.ctx.has_env_example:
            score += 5
            findings.append(".env.example found — good practice.")

        # Scan source files for hardcoded secrets (sample)
        secret_hits: list[str] = []
        for path in self._capped(self._all_src, 200):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
                if _SECRET_RE.search(text):
                    secret_hits.append(str(path.relative_to(self.root)))
            except Exception:
                pass

        if secret_hits:
            score -= min(len(secret_hits) * 8, 40)
            findings.append(f"⚠ Potential hardcoded secrets in {len(secret_hits)} file(s): {secret_hits[:3]}")
            suggestions.append("Use environment variables or a secrets manager (Vault, AWS Secrets Manager).")

        # DEBUG = True in settings
        settings_text = self._read_text("settings.py") + self._read_text("config.py")
        if re.search(r"DEBUG\s*=\s*True", settings_text):
            score -= 15
            findings.append("⚠ DEBUG = True found in settings — dangerous in production.")
            suggestions.append("Set DEBUG via environment variable; default to False.")

        # ALLOWED_HOSTS wildcard
        if "allowed_hosts = ['*']" in settings_text.lower() or 'allowed_hosts = ["*"]' in settings_text.lower():
            score -= 10
            findings.append("⚠ ALLOWED_HOSTS = ['*'] — opens host header injection risk.")

        # Security headers check (Django)
        security_headers = [
            "SECURE_SSL_REDIRECT", "SESSION_COOKIE_SECURE",
            "CSRF_COOKIE_SECURE", "X_FRAME_OPTIONS", "SECURE_HSTS_SECONDS",
        ]
        missing_headers = [h for h in security_headers if h not in settings_text]
        if missing_headers and settings_text:
            score -= len(missing_headers) * 2
            findings.append(f"Missing Django security settings: {missing_headers}")
            suggestions.append("Enable Django security middleware settings for production.")

        return QualityDimension(
            "Security Hygiene", max(score, 0), _grade(max(score, 0)),
            self._WEIGHTS["Security Hygiene"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 7. Dependency Health
    # ------------------------------------------------------------------

    def _dependency_health(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 50.0

        file_names = {f.name.lower() for f in self.ctx.all_files}

        # Lock files = pinned deps = reproducible builds
        lock_files = {
            "poetry.lock": "Poetry lock",
            "pipfile.lock": "Pipfile lock",
            "pdm.lock": "PDM lock",
            "package-lock.json": "npm lock",
            "yarn.lock": "Yarn lock",
            "pnpm-lock.yaml": "pnpm lock",
            "cargo.lock": "Cargo lock",
            "go.sum": "Go sum",
        }
        for fname, label in lock_files.items():
            if fname in file_names:
                score += 12
                findings.append(f"{label} found — reproducible builds ensured.")

        # Unpinned deps in requirements.txt
        req_text = self._read_text("requirements.txt")
        if req_text:
            unpinned = [
                ln.strip() for ln in req_text.splitlines()
                if ln.strip() and not ln.startswith("#") and "==" not in ln and ">=" not in ln
            ]
            if unpinned:
                penalty = min(len(unpinned) * 3, 30)
                score -= penalty
                findings.append(f"{len(unpinned)} unpinned dependency lines in requirements.txt.")
                suggestions.append("Pin all dependencies with exact versions (==) or use a lock file.")

        # Known vulnerable package patterns (very basic heuristic)
        old_markers = {
            "django==1.": "Django 1.x (EOL — multiple CVEs)",
            "django==2.0": "Django 2.0 (EOL)",
            "flask==0.": "Flask 0.x (EOL)",
            "pyyaml==3.": "PyYAML 3.x (CVE-2017-18342 arbitrary code exec)",
            "pillow==6.": "Pillow 6.x (multiple CVEs)",
            "requests==2.6": "requests 2.6 (old — update recommended)",
        }
        req_lower = req_text.lower()
        for marker, label in old_markers.items():
            if marker in req_lower:
                score -= 15
                findings.append(f"⚠ Vulnerable/EOL package detected: {label}")
                suggestions.append(f"Upgrade {label.split(' ')[0]} immediately.")

        if score < 40:
            suggestions.append("Use Dependabot or Renovate Bot to automate dependency updates.")

        return QualityDimension(
            "Dependency Health", max(min(score, 100), 0), _grade(max(min(score, 100), 0)),
            self._WEIGHTS["Dependency Health"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 8. CI Maturity
    # ------------------------------------------------------------------

    def _ci_maturity(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 0.0

        if not self.ctx.has_github_actions:
            suggestions.append("Add GitHub Actions workflows for automated testing and deployment.")
            return QualityDimension(
                "CI Maturity", 0, "F", self._WEIGHTS["CI Maturity"], findings, suggestions,
            )

        # Read all workflow YAML files
        workflow_dir = self.ctx.local_path / ".github" / "workflows"
        workflow_texts: list[str] = []
        if workflow_dir.exists():
            for wf in workflow_dir.glob("*.yml"):
                try:
                    workflow_texts.append(wf.read_text(encoding="utf-8", errors="ignore").lower())
                except Exception:
                    pass
            for wf in workflow_dir.glob("*.yaml"):
                try:
                    workflow_texts.append(wf.read_text(encoding="utf-8", errors="ignore").lower())
                except Exception:
                    pass

        combined = "\n".join(workflow_texts)

        stages = {
            "test":     ("pytest" in combined or "unittest" in combined or "jest" in combined, "Testing stage"),
            "lint":     ("flake8" in combined or "ruff" in combined or "pylint" in combined or "eslint" in combined, "Linting stage"),
            "build":    ("docker build" in combined or "npm run build" in combined, "Build stage"),
            "deploy":   ("deploy" in combined, "Deployment stage"),
            "security": ("bandit" in combined or "trivy" in combined or "snyk" in combined or "safety" in combined, "Security scan"),
            "coverage": ("coverage" in combined or "codecov" in combined or "coveralls" in combined, "Coverage reporting"),
            "type":     ("mypy" in combined or "pyright" in combined, "Type checking"),
        }

        for key, (detected, label) in stages.items():
            if detected:
                score += 14
                findings.append(f"CI: {label} detected.")
            else:
                suggestions.append(f"Add a {label.lower()} to your CI pipeline.")

        score = min(score, 100)
        return QualityDimension(
            "CI Maturity", score, _grade(score),
            self._WEIGHTS["CI Maturity"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 9. Modularity
    # ------------------------------------------------------------------

    def _modularity(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 80.0  # assume good, deduct

        if not self._py_files:
            return QualityDimension(
                "Modularity", score, _grade(score),
                self._WEIGHTS["Modularity"], ["No Python source files found."], suggestions,
            )

        sizes = []
        for path in self._py_files:
            try:
                sizes.append(path.stat().st_size)
            except Exception:
                pass

        if sizes:
            avg_kb = statistics.mean(sizes) / 1024
            findings.append(f"Average Python file size: {avg_kb:.1f} KB.")
            if avg_kb > 30:
                score -= 20
                suggestions.append("Files are large — split into smaller, focused modules.")
            elif avg_kb > 15:
                score -= 10

        # Check for circular import patterns (heuristic: same-module cross-imports)
        module_names = {p.stem for p in self._py_files}
        cross_imports = 0
        for path in self._capped(self._py_files, 100):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
                for node in ast.walk(tree):
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        names = [n.name for n in getattr(node, "names", [])]
                        mod = getattr(node, "module", "") or ""
                        if any(n in module_names for n in names) or mod.split(".")[0] in module_names:
                            cross_imports += 1
            except Exception:
                pass

        if cross_imports > 20:
            score -= 15
            findings.append(f"High intra-module coupling detected ({cross_imports} cross-imports).")
            suggestions.append("Reduce coupling using dependency injection or service abstractions.")

        return QualityDimension(
            "Modularity", max(score, 0), _grade(max(score, 0)),
            self._WEIGHTS["Modularity"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # 10. Dead Code Risk
    # ------------------------------------------------------------------

    def _dead_code_risk(self) -> QualityDimension:
        findings, suggestions = [], []
        score = 85.0

        unused_imports_count = 0
        for path in self._capped(self._py_files, 150):
            try:
                source = path.read_text(encoding="utf-8", errors="ignore")
                tree = ast.parse(source)
                imported_names: set[str] = set()
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            imported_names.add(alias.asname or alias.name.split(".")[0])
                    elif isinstance(node, ast.ImportFrom):
                        for alias in node.names:
                            if alias.name != "*":
                                imported_names.add(alias.asname or alias.name)

                all_names_used = re.findall(r"\b([A-Za-z_]\w*)\b", source)
                used_set = set(all_names_used)
                truly_unused = imported_names - used_set - {"__all__"}
                unused_imports_count += len(truly_unused)
            except Exception:
                pass

        if unused_imports_count > 10:
            score -= min(unused_imports_count, 40)
            findings.append(f"~{unused_imports_count} potentially unused imports detected.")
            suggestions.append("Run `ruff check --select F401` or `autoflake` to remove unused imports.")
        else:
            findings.append("Low unused import signal — good code hygiene.")

        return QualityDimension(
            "Dead Code Risk", max(score, 0), _grade(max(score, 0)),
            self._WEIGHTS["Dead Code Risk"], findings, suggestions,
        )

    # ------------------------------------------------------------------
    # Hotspots
    # ------------------------------------------------------------------

    def _find_hotspots(self) -> list[dict[str, Any]]:
        """Return top 5 files that need the most attention."""
        scored: list[tuple[float, str, str]] = []

        for path in self._capped(self._py_files, 300):
            try:
                source = path.read_text(encoding="utf-8", errors="ignore")
                lines = source.splitlines()
                risk = 0.0
                reasons: list[str] = []

                if len(lines) > 400:
                    risk += 30; reasons.append(f"{len(lines)} lines")
                if _SECRET_RE.search(source):
                    risk += 50; reasons.append("possible hardcoded secret")
                branch_count = sum(
                    1 for ln in lines
                    if re.match(r"\s*(if|elif|for|while|except)\b", ln)
                )
                if branch_count > 50:
                    risk += 20; reasons.append(f"high complexity ({branch_count} branches)")

                if risk > 0:
                    scored.append((risk, str(path.relative_to(self.root)), ", ".join(reasons)))
            except Exception:
                pass

        scored.sort(reverse=True)
        return [
            {"file": f, "risk_score": round(r, 1), "reasons": rs}
            for r, f, rs in scored[:5]
        ]

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def _build_summary(self, overall: float, dimensions: list[QualityDimension]) -> str:
        grade = _grade(overall)
        best = max(dimensions, key=lambda d: d.score)
        worst = min(dimensions, key=lambda d: d.score)
        return (
            f"Overall code quality grade: {grade} ({overall}/100). "
            f"Strongest dimension: {best.name} ({best.score:.0f}/100). "
            f"Needs most attention: {worst.name} ({worst.score:.0f}/100)."
        )

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def _scan_imports(self) -> str:
        result = []
        for path in self._capped(self._py_files, 50):
            try:
                result.append(path.read_text(encoding="utf-8", errors="ignore")[:2000])
            except Exception:
                pass
        return " ".join(result)

    def _find_file(self, filename: str) -> Path | None:
        for f in self.ctx.all_files:
            if f.name.lower() == filename.lower():
                return self.ctx.local_path / f
        return None

    def _read_text(self, filename: str, max_bytes: int = 60_000) -> str:
        path = self._find_file(filename)
        if not path or not path.exists():
            return ""
        try:
            return path.read_text(encoding="utf-8", errors="ignore")[:max_bytes]
        except Exception:
            return ""