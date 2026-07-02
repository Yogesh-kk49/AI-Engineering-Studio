"""
security_service.py
─────────────────────────────────────────────────────────────────────────────
Advanced security vulnerability scanner for the AI Engineering Studio.

Scan categories
  • Secrets & credential leaks   (regex-based pattern matching)
  • Injection flaws               (SQL, command, path traversal, SSTI)
  • Insecure deserialization      (pickle, yaml.load, marshal)
  • Dangerous function usage      (eval, exec, os.system, subprocess shell=True)
  • Cryptographic weaknesses      (MD5, SHA1, DES, static IVs)
  • Django-specific misconfigs    (DEBUG, ALLOWED_HOSTS, CSRF, cookies)
  • Dependency CVEs               (version-based known-bad list)
  • CORS / Header misconfigs
  • File-upload / path-traversal risks
  • XSS vectors in templates

Each finding has: severity (CRITICAL / HIGH / MEDIUM / LOW / INFO),
category, file, line (where available), description, recommendation.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from analyzer.services.github_client import RepoContext


# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

SEVERITY_ORDER = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}


# ──────────────────────────────────────────────────────────────────────────────
# Result types
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class SecurityFinding:
    severity: str                    # CRITICAL / HIGH / MEDIUM / LOW / INFO
    category: str
    title: str
    description: str
    file: str = ""
    line: int = 0
    snippet: str = ""
    recommendation: str = ""
    cwe: str = ""                   # e.g. "CWE-89"
    owasp: str = ""                 # e.g. "A03:2021"
    # A single rule (e.g. "exec() Usage") can legitimately match dozens or
    # hundreds of lines across a repo — especially in test suites. Rather
    # than emitting one near-duplicate finding per line, matches are
    # grouped by (category, title) and reported once with an occurrence
    # count plus a capped sample of locations.
    occurrences: int = 1
    locations: list[dict] = field(default_factory=list)


@dataclass
class SecurityResult:
    findings: list[SecurityFinding] = field(default_factory=list)
    risk_score: float = 0.0          # 0–100 (100 = most dangerous)
    risk_grade: str = "A"
    summary: dict[str, int] = field(default_factory=dict)   # severity → count
    scanned_files: int = 0
    recommendations: list[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Pattern definitions
# ──────────────────────────────────────────────────────────────────────────────

# (regex, severity, category, title, description, recommendation, CWE, OWASP)
_LINE_PATTERNS: list[tuple] = [
    # ── Secrets ──────────────────────────────────────────────────────────────
    (
        re.compile(r"""(?xi)
            (password|passwd|secret|api_key|apikey|auth_token|access_token|private_key|client_secret)
            \s*[=:]\s*['"](?!{{)[^'"]{8,}['"]
        """, re.I),
        "CRITICAL", "Secrets", "Hardcoded Credential",
        "A credential or secret value is hardcoded in source code.",
        "Move secrets to environment variables or a secrets manager (Vault, AWS Secrets Manager).",
        "CWE-798", "A07:2021",
    ),
    (
        re.compile(r"AKIA[0-9A-Z]{16}", re.I),
        "CRITICAL", "Secrets", "AWS Access Key ID",
        "An AWS Access Key ID pattern was detected.",
        "Revoke immediately and use IAM roles / AWS Secrets Manager.",
        "CWE-798", "A07:2021",
    ),
    (
        re.compile(r"(?i)ghp_[0-9a-zA-Z]{36}"),
        "CRITICAL", "Secrets", "GitHub Personal Access Token",
        "A GitHub PAT was found in source code.",
        "Revoke the token immediately on GitHub and never commit tokens.",
        "CWE-798", "A07:2021",
    ),
    (
        re.compile(r"(?i)sk-[a-zA-Z0-9]{20,}"),
        "HIGH", "Secrets", "Possible API Key (sk- prefix)",
        "A string matching common API key formats (sk-…) was found.",
        "Rotate the key and store it in an environment variable.",
        "CWE-798", "A07:2021",
    ),
    # ── Injection ─────────────────────────────────────────────────────────────
    (
        re.compile(r"""(?xi)
            \.raw\s*\(|\.execute\s*\(\s*[f"'][^)]*%s|
            cursor\.execute\s*\(\s*[f"'].*\+|
            \.extra\s*\(\s*where\s*=\s*\[.*%
        """),
        "HIGH", "Injection", "SQL Injection Risk",
        "String concatenation or format strings used in a raw SQL query.",
        "Use parameterised queries or ORM methods exclusively.",
        "CWE-89", "A03:2021",
    ),
    (
        re.compile(r"subprocess\.(call|run|Popen|check_output)\s*\([^)]*shell\s*=\s*True"),
        "HIGH", "Injection", "Shell Injection Risk",
        "subprocess called with shell=True — user-controlled input can execute arbitrary commands.",
        "Use shell=False and pass arguments as a list.",
        "CWE-78", "A03:2021",
    ),
    (
        re.compile(r"\bos\.system\s*\("),
        "MEDIUM", "Injection", "os.system Usage",
        "os.system passes commands to the shell and is susceptible to injection.",
        "Replace with subprocess.run(…, shell=False).",
        "CWE-78", "A03:2021",
    ),
    (
        re.compile(r"\bos\.popen\s*\("),
        "MEDIUM", "Injection", "os.popen Usage",
        "os.popen is a legacy shell-invocation function prone to injection.",
        "Replace with subprocess.run.",
        "CWE-78", "A03:2021",
    ),
    # ── Dangerous Functions ───────────────────────────────────────────────────
    (
        re.compile(r"\beval\s*\("),
        "HIGH", "Code Execution", "eval() Usage",
        "eval() executes arbitrary Python expressions — extremely dangerous with any external input.",
        "Remove eval(); use ast.literal_eval() for safe expression parsing.",
        "CWE-95", "A03:2021",
    ),
    (
        re.compile(r"\bexec\s*\("),
        "HIGH", "Code Execution", "exec() Usage",
        "exec() can execute arbitrary code.",
        "Avoid exec() — refactor to use importlib or structured dispatch.",
        "CWE-95", "A03:2021",
    ),
    (
        re.compile(r"\bcompile\s*\(.*exec"),
        "MEDIUM", "Code Execution", "compile() with exec mode",
        "Compiling code at runtime for exec is a code-injection vector.",
        "Avoid dynamic code compilation.",
        "CWE-95", "A03:2021",
    ),
    # ── Insecure Deserialization ───────────────────────────────────────────────
    (
        re.compile(r"\bpickle\.(loads?|Unpickler)\s*\("),
        "HIGH", "Deserialization", "Insecure pickle Deserialization",
        "pickle.load/loads can execute arbitrary code when deserialising untrusted data.",
        "Use JSON or another safe serialisation format for untrusted data.",
        "CWE-502", "A08:2021",
    ),
    (
        re.compile(r"\byaml\.load\s*\([^)]*\)(?!\s*,\s*Loader)"),
        "HIGH", "Deserialization", "Unsafe yaml.load()",
        "yaml.load() without Loader=yaml.SafeLoader can execute arbitrary code.",
        "Use yaml.safe_load() instead.",
        "CWE-502", "A08:2021",
    ),
    (
        re.compile(r"\bmarshal\.loads?\s*\("),
        "HIGH", "Deserialization", "marshal Deserialization",
        "marshal is not safe for deserialising untrusted data.",
        "Use JSON for data exchange with external sources.",
        "CWE-502", "A08:2021",
    ),
    # ── Cryptography ──────────────────────────────────────────────────────────
    (
        re.compile(r"hashlib\.(md5|sha1)\s*\(", re.I),
        "MEDIUM", "Cryptography", "Weak Hash Algorithm",
        "MD5 / SHA-1 are cryptographically broken and should not be used for security purposes.",
        "Use SHA-256 or SHA-3 via hashlib.sha256() / hashlib.sha3_256().",
        "CWE-328", "A02:2021",
    ),
    (
        re.compile(r"Cipher\.new\s*\(.*DES|DES\.new\s*\(", re.I),
        "HIGH", "Cryptography", "DES Encryption",
        "DES is a broken cipher (56-bit key). Never use for new code.",
        "Use AES-256-GCM via the cryptography library.",
        "CWE-327", "A02:2021",
    ),
    (
        re.compile(r"AES\.new\s*\([^)]*MODE_ECB", re.I),
        "HIGH", "Cryptography", "AES-ECB Mode",
        "AES in ECB mode does not provide semantic security — patterns are preserved.",
        "Use AES-GCM or AES-CBC with a random IV.",
        "CWE-327", "A02:2021",
    ),
    (
        re.compile(r"random\.(random|randint|choice|randrange)\s*\("),
        "LOW", "Cryptography", "Non-cryptographic Random",
        "random module is not cryptographically secure.",
        "Use secrets module for security-sensitive randomness (tokens, passwords).",
        "CWE-338", "A02:2021",
    ),
    # ── Path Traversal ────────────────────────────────────────────────────────
    (
        re.compile(r"open\s*\(\s*request\.(GET|POST|data|FILES|args|form)"),
        "HIGH", "Path Traversal", "Unvalidated File Open from Request",
        "Opening a file with a path taken directly from user input.",
        "Validate and sanitise file paths; use pathlib.Path.resolve() and check against a whitelist.",
        "CWE-22", "A01:2021",
    ),
    # ── CORS / Headers ────────────────────────────────────────────────────────
    (
        re.compile(r"CORS_ORIGIN_ALLOW_ALL\s*=\s*True", re.I),
        "MEDIUM", "Configuration", "CORS Allow All Origins",
        "CORS_ORIGIN_ALLOW_ALL=True permits any origin — dangerous for credentialed requests.",
        "Explicitly whitelist trusted origins in CORS_ALLOWED_ORIGINS.",
        "CWE-942", "A05:2021",
    ),
    # ── XSS ──────────────────────────────────────────────────────────────────
    (
        re.compile(r"\|\s*safe\b"),
        "MEDIUM", "XSS", "Django/Jinja |safe Filter",
        "The |safe template filter bypasses HTML escaping — XSS risk if content is user-controlled.",
        "Remove |safe or sanitise the value using bleach before marking safe.",
        "CWE-79", "A03:2021",
    ),
    (
        re.compile(r"mark_safe\s*\("),
        "MEDIUM", "XSS", "mark_safe() Usage",
        "mark_safe() bypasses Django's auto-escaping.",
        "Only call mark_safe() on developer-controlled strings, never on user input.",
        "CWE-79", "A03:2021",
    ),
]


# Django settings-level checks (applied to full settings.py text)
_SETTINGS_CHECKS: list[tuple[re.Pattern, str, str, str, str, str, str, str]] = [
    (
        re.compile(r"DEBUG\s*=\s*True"),
        "HIGH", "Configuration", "DEBUG=True in Settings",
        "Django debug mode leaks stack traces and internal paths to end users.",
        "Set DEBUG via an environment variable; default to False.",
        "CWE-215", "A05:2021",
    ),
    (
        re.compile(r"ALLOWED_HOSTS\s*=\s*\[[\s'\"\*]+\]"),
        "HIGH", "Configuration", "ALLOWED_HOSTS Wildcard",
        "ALLOWED_HOSTS=['*'] permits host header injection.",
        "List only your actual domain names in ALLOWED_HOSTS.",
        "CWE-116", "A05:2021",
    ),
    (
        re.compile(r"SECRET_KEY\s*=\s*['\"][^'\"]{10,}['\"]"),
        "MEDIUM", "Secrets", "Hardcoded Django SECRET_KEY",
        "The Django SECRET_KEY is committed in plain text.",
        "Load SECRET_KEY from an environment variable in production.",
        "CWE-798", "A07:2021",
    ),
    (
        re.compile(r"SESSION_COOKIE_SECURE\s*=\s*False"),
        "MEDIUM", "Configuration", "Session Cookie Not Secure",
        "SESSION_COOKIE_SECURE=False allows cookies over HTTP.",
        "Set SESSION_COOKIE_SECURE=True in production.",
        "CWE-614", "A02:2021",
    ),
    (
        re.compile(r"CSRF_COOKIE_SECURE\s*=\s*False"),
        "MEDIUM", "Configuration", "CSRF Cookie Not Secure",
        "CSRF_COOKIE_SECURE=False allows CSRF cookie over HTTP.",
        "Set CSRF_COOKIE_SECURE=True in production.",
        "CWE-352", "A01:2021",
    ),
]


# Known vulnerable package versions: (package_substring, severity, description)
_KNOWN_VULN_DEPS: list[tuple[str, str, str]] = [
    ("django==1.", "CRITICAL", "Django 1.x is end-of-life with multiple unfixed CVEs."),
    ("django==2.0", "CRITICAL", "Django 2.0 is end-of-life."),
    ("django==2.1", "HIGH", "Django 2.1 is end-of-life."),
    ("django==2.2", "MEDIUM", "Django 2.2 LTS reached EOL April 2024."),
    ("flask==0.", "HIGH", "Flask 0.x is unmaintained."),
    ("pillow==5.", "HIGH", "Pillow 5.x has critical CVEs (arbitrary code exec)."),
    ("pillow==6.", "HIGH", "Pillow 6.x has multiple CVEs."),
    ("pyyaml==3.", "HIGH", "PyYAML 3.x — CVE-2017-18342 arbitrary code execution."),
    ("pyyaml==5.3", "MEDIUM", "PyYAML 5.3 — CVE-2020-14343."),
    ("requests==2.6.", "MEDIUM", "requests 2.6.x is outdated."),
    ("cryptography==2.", "HIGH", "cryptography 2.x has known CVEs."),
    ("paramiko==1.", "HIGH", "paramiko 1.x has critical auth-bypass CVEs."),
    ("jinja2==2.10.", "HIGH", "Jinja2 2.10 — SSTI CVE-2019-10906."),
    ("sqlalchemy==1.3.", "MEDIUM", "SQLAlchemy 1.3 — update to 2.x for security fixes."),
    ("celery==4.", "MEDIUM", "Celery 4.x has known command-execution vulnerabilities."),
]


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────

class SecurityService:

    _SCAN_EXTENSIONS = {
        ".py", ".js", ".ts", ".jsx", ".tsx",
        ".html", ".jinja", ".jinja2", ".j2",
        ".yml", ".yaml", ".env", ".cfg", ".ini",
        ".sh", ".bash",
    }

    # How many example (file, line) locations to keep per grouped finding.
    # The true total is preserved in `occurrences` regardless of this cap.
    _MAX_LOCATIONS_PER_GROUP = 5

    def __init__(self, ctx: RepoContext):
        self.ctx = ctx
        self.root = ctx.local_path
        self._findings: list[SecurityFinding] = []

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self) -> SecurityResult:
        scanned = 0

        for rel_path in self.ctx.all_files:
            if rel_path.suffix.lower() not in self._SCAN_EXTENSIONS:
                continue
            full_path = self.root / rel_path
            try:
                text = full_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            scanned += 1
            self._scan_lines(text, str(rel_path))

        # Settings-level checks
        self._scan_settings()

        # Dependency CVE check
        self._scan_dependencies()

        # Infrastructure checks
        self._scan_infrastructure()

        # Collapse repeated matches of the same rule (e.g. exec() used on
        # 200 different lines) into a single grouped finding with an
        # occurrence count, instead of flooding the report with near-
        # identical entries.
        self._findings = self._group_findings(self._findings)

        # Sort by severity, then by how widespread the issue is.
        self._findings.sort(
            key=lambda f: (SEVERITY_ORDER.get(f.severity, 0), f.occurrences),
            reverse=True,
        )

        risk = self._compute_risk()
        grade = self._risk_grade(risk)
        summary = {
            sev: sum(1 for f in self._findings if f.severity == sev)
            for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO")
        }
        recs = self._top_recommendations()

        return SecurityResult(
            findings=self._findings,
            risk_score=risk,
            risk_grade=grade,
            summary=summary,
            scanned_files=scanned,
            recommendations=recs,
        )

    # ------------------------------------------------------------------
    # Grouping
    # ------------------------------------------------------------------

    def _group_findings(self, raw: list[SecurityFinding]) -> list[SecurityFinding]:
        """Collapse findings that share the same (category, title) — i.e.
        the same underlying rule — into one entry with an occurrence count
        and a capped sample of locations, preserving the first match's
        severity/description/recommendation/CWE/OWASP metadata."""
        groups: dict[tuple[str, str], SecurityFinding] = {}
        order: list[tuple[str, str]] = []

        for f in raw:
            key = (f.category, f.title)
            if key not in groups:
                groups[key] = SecurityFinding(
                    severity=f.severity, category=f.category, title=f.title,
                    description=f.description, recommendation=f.recommendation,
                    cwe=f.cwe, owasp=f.owasp,
                    file=f.file, line=f.line, snippet=f.snippet,
                    occurrences=0, locations=[],
                )
                order.append(key)

            g = groups[key]
            g.occurrences += 1
            if len(g.locations) < self._MAX_LOCATIONS_PER_GROUP and f.file:
                g.locations.append({"file": f.file, "line": f.line, "snippet": f.snippet})

        return [groups[k] for k in order]

    # ------------------------------------------------------------------
    # Line-by-line scan
    # ------------------------------------------------------------------

    def _scan_lines(self, text: str, rel_path: str) -> None:
        lines = text.splitlines()
        for lineno, line in enumerate(lines, start=1):
            for pattern, severity, category, title, description, recommendation, cwe, owasp in _LINE_PATTERNS:
                if pattern.search(line):
                    snippet = line.strip()[:120]
                    self._findings.append(SecurityFinding(
                        severity=severity, category=category, title=title,
                        description=description, file=rel_path, line=lineno,
                        snippet=snippet, recommendation=recommendation,
                        cwe=cwe, owasp=owasp,
                    ))
                    break   # one finding per line per file

    # ------------------------------------------------------------------
    # Django settings checks
    # ------------------------------------------------------------------

    def _scan_settings(self) -> None:
        for rel in self.ctx.all_files:
            if rel.name.lower() not in ("settings.py", "settings_prod.py", "base.py"):
                continue
            try:
                text = (self.root / rel).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for pattern, severity, category, title, description, recommendation, cwe, owasp in _SETTINGS_CHECKS:
                m = pattern.search(text)
                if m:
                    lineno = text[:m.start()].count("\n") + 1
                    self._findings.append(SecurityFinding(
                        severity=severity, category=category, title=title,
                        description=description, file=str(rel), line=lineno,
                        snippet=m.group()[:100], recommendation=recommendation,
                        cwe=cwe, owasp=owasp,
                    ))

    # ------------------------------------------------------------------
    # Dependency CVE scan
    # ------------------------------------------------------------------

    def _scan_dependencies(self) -> None:
        req_files = [
            f for f in self.ctx.all_files
            if f.name.lower() in ("requirements.txt", "requirements-base.txt",
                                   "requirements-prod.txt", "requirements/base.txt")
        ]
        text = ""
        for rel in req_files:
            try:
                text += (self.root / rel).read_text(encoding="utf-8", errors="ignore").lower()
            except Exception:
                pass

        for pkg_substr, severity, description in _KNOWN_VULN_DEPS:
            if pkg_substr.lower() in text:
                self._findings.append(SecurityFinding(
                    severity=severity, category="Dependency CVE",
                    title=f"Vulnerable Dependency: {pkg_substr.split('==')[0]}",
                    description=description,
                    recommendation="Upgrade to the latest stable version immediately.",
                    cwe="CWE-1104", owasp="A06:2021",
                ))

    # ------------------------------------------------------------------
    # Infrastructure / Docker checks
    # ------------------------------------------------------------------

    def _scan_infrastructure(self) -> None:
        for rel in self.ctx.all_files:
            if rel.name.lower() not in ("dockerfile", "docker-compose.yml", "docker-compose.yaml"):
                continue
            try:
                text = (self.root / rel).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            if "USER root" in text or (rel.name.lower() == "dockerfile" and "USER " not in text):
                self._findings.append(SecurityFinding(
                    severity="MEDIUM", category="Container Security",
                    title="Container Running as Root",
                    description="The Docker image may run as root, increasing blast radius on compromise.",
                    file=str(rel),
                    recommendation="Add 'USER nonroot' or a named non-root user to the Dockerfile.",
                    cwe="CWE-269", owasp="A05:2021",
                ))

            if ":latest" in text:
                self._findings.append(SecurityFinding(
                    severity="LOW", category="Container Security",
                    title="Unpinned Docker :latest Tag",
                    description="Using :latest makes builds non-reproducible and may pull vulnerable images.",
                    file=str(rel),
                    recommendation="Pin image versions (e.g. python:3.12.4-slim-bookworm).",
                    cwe="CWE-1104", owasp="A06:2021",
                ))

            if re.search(r"ports:\s*\n\s*-\s*[\"']?0\.0\.0\.0:\d+", text):
                self._findings.append(SecurityFinding(
                    severity="MEDIUM", category="Network Exposure",
                    title="Service Bound to 0.0.0.0",
                    description="Binding to 0.0.0.0 exposes the service on all interfaces.",
                    file=str(rel),
                    recommendation="Bind internal services to 127.0.0.1 in development.",
                    cwe="CWE-605", owasp="A05:2021",
                ))

    # ------------------------------------------------------------------
    # Risk score
    # ------------------------------------------------------------------

    _WEIGHTS = {"CRITICAL": 25, "HIGH": 12, "MEDIUM": 5, "LOW": 2, "INFO": 0.5}

    def _compute_risk(self) -> float:
        raw = 0.0
        for f in self._findings:
            base = self._WEIGHTS.get(f.severity, 0)
            if f.occurrences > 1:
                # Diminishing returns: 10 occurrences ~2x base weight,
                # 100 occurrences ~3x — widespread issues still matter
                # more than a single instance, but don't dominate the
                # score the way a naive per-line sum would.
                base *= 1 + math.log10(f.occurrences)
            raw += base
        return min(round(raw, 1), 100.0)

    @staticmethod
    def _risk_grade(score: float) -> str:
        if score == 0: return "A+"
        if score < 10: return "A"
        if score < 25: return "B"
        if score < 50: return "C"
        if score < 75: return "D"
        return "F"

    # ------------------------------------------------------------------
    # Top recommendations
    # ------------------------------------------------------------------

    def _top_recommendations(self) -> list[str]:
        seen: set[str] = set()
        recs: list[str] = []
        for f in self._findings:
            if f.recommendation and f.recommendation not in seen:
                seen.add(f.recommendation)
                recs.append(f.recommendation)
            if len(recs) >= 10:
                break
        return recs