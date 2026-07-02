"""
predictions_service.py
─────────────────────────────────────────────────────────────────────────────
AI-powered future predictions engine for the AI Engineering Studio.

Prediction dimensions
  1.  Tech Debt Trajectory      – will debt grow or shrink?
  2.  Scalability Ceiling       – at what load will the current architecture break?
  3.  Maintenance Burden        – effort needed to keep the project healthy
  4.  Migration Opportunities   – outdated tech that should be swapped
  5.  Growth Signals            – indicators the project is actively evolving
  6.  Framework Longevity       – community trend for detected frameworks
  7.  Security Risk Forecast    – likelihood of a breach in 12 months
  8.  Team Scalability          – how well the codebase supports multiple contributors
  9.  Cloud-Native Readiness    – how close to 12-factor / cloud-native
  10. AI/ML Integration Potential – where AI could enhance this project

Each prediction includes: title, insight, confidence (%), horizon (short/mid/long-term),
impact (HIGH/MEDIUM/LOW), actionable_steps.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from analyzer.services.github_client import RepoContext
from architect.services.architect_service import ArchitectureResult
from architect.services.quality_service import QualityResult
from architect.services.security_service import SecurityResult


# ──────────────────────────────────────────────────────────────────────────────
# Data types
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Prediction:
    title: str
    category: str
    insight: str
    confidence: int           # 0–100
    horizon: str              # "short-term (3–6 months)" | "mid-term (6–18 months)" | "long-term (2+ years)"
    impact: str               # HIGH / MEDIUM / LOW
    direction: str            # POSITIVE / NEGATIVE / NEUTRAL / WARNING
    actionable_steps: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)


@dataclass
class PredictionsResult:
    predictions: list[Prediction] = field(default_factory=list)
    overall_trajectory: str = "NEUTRAL"     # POSITIVE / NEGATIVE / NEUTRAL
    trajectory_summary: str = ""
    top_risks: list[str] = field(default_factory=list)
    top_opportunities: list[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Framework longevity knowledge base (as of 2024–2025 ecosystem data)
# ──────────────────────────────────────────────────────────────────────────────

_FRAMEWORK_LONGEVITY: dict[str, dict[str, Any]] = {
    "Django":     {"trend": "STABLE",   "score": 85, "note": "Large ecosystem, active LTS cycle; safe long-term choice."},
    "FastAPI":    {"trend": "GROWING",  "score": 95, "note": "Fastest-growing Python framework; strong async support."},
    "Flask":      {"trend": "STABLE",   "score": 72, "note": "Mature micro-framework; consider FastAPI for new async APIs."},
    "Next.js":    {"trend": "GROWING",  "score": 95, "note": "Dominant React full-stack framework; strong Vercel backing."},
    "React":      {"trend": "STABLE",   "score": 90, "note": "Still the most-used frontend library; ecosystem expanding."},
    "Vue.js":     {"trend": "STABLE",   "score": 80, "note": "Healthy community; Nuxt.js elevating adoption."},
    "Angular":    {"trend": "DECLINING","score": 65, "note": "Market share declining vs React/Vue; still dominant in enterprise."},
    "Svelte":     {"trend": "GROWING",  "score": 85, "note": "SvelteKit gaining traction as a Next.js alternative."},
    "Express.js": {"trend": "STABLE",   "score": 75, "note": "Very mature; being replaced by Fastify/Hono for new projects."},
    "NestJS":     {"trend": "GROWING",  "score": 88, "note": "Enterprise-grade Node.js; TypeScript-first."},
    "Spring Boot":{"trend": "STABLE",   "score": 82, "note": "Dominant in JVM ecosystem; strong enterprise support."},
    "Celery":     {"trend": "STABLE",   "score": 78, "note": "Still widely used; Dramatiq/Arq are emerging alternatives."},
}

_CLOUD_NATIVE_SIGNALS: list[tuple[str, int]] = [
    ("docker",          15),
    ("docker-compose",  10),
    ("kubernetes",      20),
    ("helm",            10),
    ("terraform",       10),
    ("github_actions",  10),
    ("env_example",      5),
    ("health_check",     5),
    ("prometheus",      10),
    ("opentelemetry",   10),
]


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────

class PredictionsService:

    def __init__(
        self,
        ctx: RepoContext,
        arch: ArchitectureResult,
        quality: QualityResult,
        security: SecurityResult,
    ):
        self.ctx = ctx
        self.arch = arch
        self.quality = quality
        self.security = security
        self._predictions: list[Prediction] = []

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self) -> PredictionsResult:
        self._tech_debt_trajectory()
        self._scalability_ceiling()
        self._maintenance_burden()
        self._migration_opportunities()
        self._growth_signals()
        self._framework_longevity()
        self._security_risk_forecast()
        self._team_scalability()
        self._cloud_native_readiness()
        self._ai_integration_potential()

        trajectory = self._overall_trajectory()
        return PredictionsResult(
            predictions=self._predictions,
            overall_trajectory=trajectory,
            trajectory_summary=self._trajectory_summary(trajectory),
            top_risks=self._top_risks(),
            top_opportunities=self._top_opportunities(),
        )

    # ------------------------------------------------------------------
    # 1. Tech Debt Trajectory
    # ------------------------------------------------------------------

    def _tech_debt_trajectory(self) -> None:
        score = self.quality.overall_score
        dims = {d.name: d.score for d in self.quality.dimensions}
        maint = dims.get("Maintainability", 50)
        test = dims.get("Test Coverage", 0)

        if score < 40 and test < 30:
            direction = "NEGATIVE"
            insight = (
                f"With a quality score of {score}/100 and low test coverage ({test}/100), "
                "technical debt is likely to compound rapidly. Without tests, every new feature "
                "risks regressions and the cost of each change increases exponentially."
            )
            confidence = 85
            steps = [
                "Set a team policy: no PR merges below 70% test coverage.",
                "Introduce incremental refactoring — address the worst hotspot files first.",
                "Add automated code quality gates (SonarQube, CodeClimate) to the CI pipeline.",
            ]
        elif score >= 75:
            direction = "POSITIVE"
            insight = (
                f"Quality score of {score}/100 indicates a well-maintained codebase. "
                "Technical debt is being managed proactively. Continued investment will "
                "keep velocity high as the project scales."
            )
            confidence = 78
            steps = [
                "Maintain the current quality bar with coverage thresholds in CI.",
                "Schedule quarterly tech-debt sprints for gradual improvements.",
            ]
        else:
            direction = "NEUTRAL"
            insight = (
                f"Quality score of {score}/100 is adequate but has room for improvement. "
                "Debt is accumulating slowly — addressable with focused effort."
            )
            confidence = 70
            steps = [
                "Prioritise increasing test coverage to 60%+ within the next quarter.",
                "Enforce linting in CI to prevent further style debt accumulation.",
            ]

        self._predictions.append(Prediction(
            title="Tech Debt Trajectory",
            category="Engineering Health",
            insight=insight, confidence=confidence,
            horizon="short-term (3–6 months)", impact="HIGH", direction=direction,
            actionable_steps=steps,
            evidence=[f"Quality score: {score}/100", f"Test coverage score: {test}/100"],
        ))

    # ------------------------------------------------------------------
    # 2. Scalability Ceiling
    # ------------------------------------------------------------------

    def _scalability_ceiling(self) -> None:
        has_cache = bool(self.arch.caching)
        has_async = any("FastAPI" in b or "aiohttp" in b or "Async" in b for b in self.arch.backend)
        has_queue = bool(self.arch.messaging)
        has_k8s = "Kubernetes" in self.arch.infrastructure
        has_db = bool(self.arch.databases)
        db_without_cache = has_db and not has_cache

        bottlenecks = []
        if db_without_cache:
            bottlenecks.append("No caching layer (all reads hit the database directly)")
        if not has_async:
            bottlenecks.append("Synchronous request handling limits concurrent throughput")
        if not has_queue:
            bottlenecks.append("Long-running tasks likely block the request cycle")
        if not has_k8s:
            bottlenecks.append("No container orchestration — horizontal scaling requires manual effort")

        if len(bottlenecks) >= 3:
            direction = "WARNING"
            ceiling = "low-to-medium traffic (~1k concurrent users)"
            confidence = 72
        elif len(bottlenecks) == 0:
            direction = "POSITIVE"
            ceiling = "high traffic (10k+ concurrent users with proper infra)"
            confidence = 65
        else:
            direction = "NEUTRAL"
            ceiling = "medium traffic (~5k concurrent users)"
            confidence = 68

        insight = (
            f"Current architecture is estimated to scale comfortably to {ceiling}. "
            + (f"Identified bottlenecks: {'; '.join(bottlenecks)}." if bottlenecks else
               "No major bottlenecks detected — good scalability foundation.")
        )

        steps = []
        if db_without_cache:
            steps.append("Add Redis caching for read-heavy endpoints (cache-aside pattern).")
        if not has_async:
            steps.append("Migrate long-running endpoints to async views or background tasks.")
        if not has_queue:
            steps.append("Introduce Celery + Redis for async job processing.")
        if not has_k8s:
            steps.append("Containerise and deploy to Kubernetes for horizontal auto-scaling.")

        self._predictions.append(Prediction(
            title="Scalability Ceiling Forecast",
            category="Architecture",
            insight=insight, confidence=confidence,
            horizon="mid-term (6–18 months)", impact="HIGH", direction=direction,
            actionable_steps=steps,
            evidence=[f"Caching: {bool(self.arch.caching)}", f"Messaging: {bool(self.arch.messaging)}",
                      f"Kubernetes: {has_k8s}"],
        ))

    # ------------------------------------------------------------------
    # 3. Maintenance Burden
    # ------------------------------------------------------------------

    def _maintenance_burden(self) -> None:
        dims = {d.name: d.score for d in self.quality.dimensions}
        doc_score = dims.get("Documentation", 50)
        type_score = dims.get("Type Safety", 50)
        lint_score = dims.get("Linting & Style", 50)
        avg = statistics.mean([doc_score, type_score, lint_score])

        if avg < 40:
            direction, burden, confidence = "NEGATIVE", "HIGH", 80
            insight = (
                "Low documentation, typing, and style scores suggest new contributors will spend "
                "significant time understanding and navigating the codebase. Onboarding costs are "
                "estimated to be 2–3× higher than a well-documented project."
            )
            steps = [
                "Invest 20% of sprint capacity into documentation improvements.",
                "Add type annotations incrementally — start with public API boundaries.",
                "Enforce formatting with black/ruff in CI to eliminate style discussions.",
            ]
        elif avg >= 70:
            direction, burden, confidence = "POSITIVE", "LOW", 75
            insight = (
                "Good documentation, type safety, and style consistency mean new engineers "
                "can be productive quickly. Maintenance burden is sustainable."
            )
            steps = ["Keep documentation up to date as new features land."]
        else:
            direction, burden, confidence = "NEUTRAL", "MEDIUM", 70
            insight = (
                f"Maintenance burden is moderate (avg developer-experience score: {avg:.0f}/100). "
                "Targeted improvements in documentation and typing will reduce onboarding friction."
            )
            steps = [
                "Prioritise docstrings on the 10 most-called functions/classes.",
                "Introduce mypy to CI and fix existing type errors progressively.",
            ]

        self._predictions.append(Prediction(
            title="Maintenance Burden Forecast",
            category="Engineering Health",
            insight=insight, confidence=confidence,
            horizon="short-term (3–6 months)", impact="MEDIUM", direction=direction,
            actionable_steps=steps,
            evidence=[f"Doc score: {doc_score}", f"Type score: {type_score}", f"Lint score: {lint_score}"],
        ))

    # ------------------------------------------------------------------
    # 4. Migration Opportunities
    # ------------------------------------------------------------------

    def _migration_opportunities(self) -> None:
        opportunities: list[str] = []
        steps: list[str] = []

        backend = self.arch.backend
        frontend = self.arch.frontend
        dbs = self.arch.databases

        if "Django" in backend and "FastAPI" not in backend:
            opportunities.append(
                "Consider introducing FastAPI for new high-throughput API endpoints alongside Django — "
                "a hybrid approach gives async performance without a full rewrite."
            )
            steps.append("Introduce FastAPI as a micro-service for performance-critical endpoints.")

        if "Flask" in backend:
            opportunities.append(
                "Flask projects commonly migrate to FastAPI for better async support, "
                "auto-documentation, and type-safety at the API boundary."
            )
            steps.append("Evaluate FastAPI as a Flask replacement for new services.")

        if "Angular" in frontend:
            opportunities.append(
                "Angular's market share vs React/Vue continues to decline in the SaaS space. "
                "A mid-term frontend modernisation to React + Next.js may reduce hiring friction."
            )

        if "MySQL" in dbs and "PostgreSQL" not in dbs:
            opportunities.append(
                "PostgreSQL offers superior JSON, full-text search, and extension support. "
                "Many Django projects benefit from migrating from MySQL to PostgreSQL."
            )
            steps.append("Plan a MySQL → PostgreSQL migration with pgloader or Django data migrations.")

        if "SQLite" in dbs:
            opportunities.append(
                "SQLite is not suitable for production multi-process workloads. "
                "Migrate to PostgreSQL before deploying to a production environment."
            )
            steps.append("Replace SQLite with PostgreSQL in production settings.")

        if not opportunities:
            insight = "Current technology choices are well-aligned with modern standards. No urgent migrations recommended."
            direction = "POSITIVE"
        else:
            insight = " | ".join(opportunities)
            direction = "NEUTRAL"

        self._predictions.append(Prediction(
            title="Migration & Modernisation Opportunities",
            category="Technology Strategy",
            insight=insight, confidence=75,
            horizon="mid-term (6–18 months)", impact="MEDIUM", direction=direction,
            actionable_steps=steps or ["Monitor ecosystem trends quarterly and revisit this assessment."],
            evidence=[f"Backend: {backend}", f"Frontend: {frontend}", f"Databases: {dbs}"],
        ))

    # ------------------------------------------------------------------
    # 5. Growth Signals
    # ------------------------------------------------------------------

    def _growth_signals(self) -> None:
        stars = self.ctx.stargazers_count
        forks = self.ctx.forks_count
        issues = self.ctx.open_issues_count
        has_ci = bool(self.arch.cicd)
        has_docker = self.ctx.has_dockerfile
        contributors = self.ctx.contributors_count

        score = 0
        evidence = []

        if stars > 1000:
            score += 30; evidence.append(f"{stars} GitHub stars")
        elif stars > 100:
            score += 15; evidence.append(f"{stars} GitHub stars (growing)")
        if forks > 100:
            score += 20; evidence.append(f"{forks} forks")
        if contributors > 10:
            score += 20; evidence.append(f"{contributors} contributors")
        if has_ci:
            score += 15; evidence.append("CI/CD pipeline configured")
        if has_docker:
            score += 15; evidence.append("Docker configured")
        if issues > 10:
            score += 10; evidence.append(f"{issues} open issues (active project)")

        if score >= 60:
            direction, insight = "POSITIVE", "Strong growth signals: the project is actively maintained and gaining traction."
        elif score >= 30:
            direction, insight = "NEUTRAL", "Moderate growth signals: the project is active but adoption is limited so far."
        else:
            direction, insight = "WARNING", "Weak growth signals: the project may be early-stage or under-maintained."

        self._predictions.append(Prediction(
            title="Project Growth Trajectory",
            category="Community & Adoption",
            insight=insight, confidence=70,
            horizon="long-term (2+ years)", impact="MEDIUM", direction=direction,
            actionable_steps=[
                "Publish a clear CONTRIBUTING.md to lower the barrier for contributors.",
                "Engage with the community via GitHub Discussions or Discord.",
                "Add demo GIFs/screenshots to the README to boost discoverability.",
            ],
            evidence=evidence,
        ))

    # ------------------------------------------------------------------
    # 6. Framework Longevity
    # ------------------------------------------------------------------

    def _framework_longevity(self) -> None:
        all_frameworks = self.arch.backend + self.arch.frontend
        scored: list[tuple[str, dict]] = []

        for fw in all_frameworks:
            if fw in _FRAMEWORK_LONGEVITY:
                scored.append((fw, _FRAMEWORK_LONGEVITY[fw]))

        if not scored:
            return

        declining = [fw for fw, d in scored if d["trend"] == "DECLINING"]
        growing = [fw for fw, d in scored if d["trend"] == "GROWING"]
        avg_score = statistics.mean(d["score"] for _, d in scored)

        notes = " | ".join(f"{fw}: {d['note']}" for fw, d in scored[:4])

        if declining:
            direction, confidence = "WARNING", 80
            insight = f"Declining-trend frameworks detected: {declining}. {notes}"
        elif growing:
            direction, confidence = "POSITIVE", 78
            insight = f"Growing-trend frameworks detected: {growing}. {notes}"
        else:
            direction, confidence = "NEUTRAL", 72
            insight = f"Stable framework ecosystem (avg longevity score: {avg_score:.0f}/100). {notes}"

        steps = []
        for fw in declining:
            steps.append(f"Evaluate a migration roadmap away from {fw} within 12–24 months.")

        self._predictions.append(Prediction(
            title="Framework Longevity Assessment",
            category="Technology Strategy",
            insight=insight, confidence=confidence,
            horizon="long-term (2+ years)", impact="MEDIUM", direction=direction,
            actionable_steps=steps or ["Continue monitoring framework release cadence and community sentiment."],
            evidence=[f"{fw}: {d['trend']} (score {d['score']})" for fw, d in scored],
        ))

    # ------------------------------------------------------------------
    # 7. Security Risk Forecast
    # ------------------------------------------------------------------

    def _security_risk_forecast(self) -> None:
        risk = self.security.risk_score
        critical = self.security.summary.get("CRITICAL", 0)
        high = self.security.summary.get("HIGH", 0)

        if critical > 0:
            direction = "NEGATIVE"
            confidence = 90
            insight = (
                f"{critical} CRITICAL and {high} HIGH severity vulnerabilities detected. "
                "Without immediate remediation, the probability of a successful security incident "
                "in the next 12 months is HIGH."
            )
        elif high > 2:
            direction = "WARNING"
            confidence = 80
            insight = (
                f"{high} HIGH severity vulnerabilities present. Risk of exploitation is "
                "elevated — prioritise remediation in the next sprint."
            )
        elif risk < 10:
            direction = "POSITIVE"
            confidence = 75
            insight = "Low security risk detected. Maintain current hygiene practices and conduct periodic audits."
        else:
            direction = "NEUTRAL"
            confidence = 72
            insight = f"Moderate security risk (score: {risk}/100). Address flagged issues to reduce exposure."

        steps = self.security.recommendations[:4]
        if not steps:
            steps = ["Conduct a periodic security audit (e.g. with bandit, safety, OWASP ZAP)."]

        self._predictions.append(Prediction(
            title="Security Risk Forecast (12-month)",
            category="Security",
            insight=insight, confidence=confidence,
            horizon="short-term (3–6 months)", impact="HIGH", direction=direction,
            actionable_steps=steps,
            evidence=[f"Risk score: {risk}/100", f"Critical: {critical}", f"High: {high}"],
        ))

    # ------------------------------------------------------------------
    # 8. Team Scalability
    # ------------------------------------------------------------------

    def _team_scalability(self) -> None:
        has_contributing = any("contributing" in str(f).lower() for f in self.ctx.all_files)
        has_code_owners = any("codeowners" in str(f).lower() for f in self.ctx.all_files)
        has_issue_templates = any(".github/issue_template" in str(f).lower() for f in self.ctx.all_files)
        has_pr_template = any("pull_request_template" in str(f).lower() for f in self.ctx.all_files)
        dims = {d.name: d.score for d in self.quality.dimensions}
        doc_score = dims.get("Documentation", 0)
        type_score = dims.get("Type Safety", 0)

        signals = sum([has_contributing, has_code_owners, has_issue_templates, has_pr_template, doc_score > 60, type_score > 60])

        if signals >= 5:
            direction, confidence = "POSITIVE", 78
            insight = "Strong contributor infrastructure: the project is well-prepared for team growth."
        elif signals >= 2:
            direction, confidence = "NEUTRAL", 72
            insight = "Moderate contributor infrastructure. Adding contribution guides and PR templates will ease team onboarding."
        else:
            direction, confidence = "WARNING", 75
            insight = "Minimal contributor infrastructure. Scaling the team will be painful without documentation and process guardrails."

        steps = []
        if not has_contributing:
            steps.append("Add CONTRIBUTING.md with setup steps, coding standards, and PR process.")
        if not has_code_owners:
            steps.append("Add CODEOWNERS file to auto-assign reviewers by module.")
        if not has_pr_template:
            steps.append("Add a pull_request_template.md to standardise PR descriptions.")
        if not has_issue_templates:
            steps.append("Add GitHub issue templates for bugs and feature requests.")

        self._predictions.append(Prediction(
            title="Team Scalability Readiness",
            category="Engineering Culture",
            insight=insight, confidence=confidence,
            horizon="mid-term (6–18 months)", impact="MEDIUM", direction=direction,
            actionable_steps=steps or ["Maintain current contributor infrastructure."],
            evidence=[f"CONTRIBUTING.md: {has_contributing}", f"CODEOWNERS: {has_code_owners}"],
        ))

    # ------------------------------------------------------------------
    # 9. Cloud-Native Readiness
    # ------------------------------------------------------------------

    def _cloud_native_readiness(self) -> None:
        score = 0
        evidence = []

        checks = {
            "docker":          self.ctx.has_dockerfile,
            "docker-compose":  self.ctx.has_docker_compose,
            "kubernetes":      any("kubernetes" in str(d).lower() for d in self.ctx.all_dirs),
            "helm":            any("helm" in str(d).lower() for d in self.ctx.all_dirs),
            "terraform":       any("terraform" in str(f).lower() for f in self.ctx.all_files),
            "github_actions":  self.ctx.has_github_actions,
            "env_example":     self.ctx.has_env_example,
            "prometheus":      "Prometheus" in self.arch.observability,
            "opentelemetry":   "OpenTelemetry" in self.arch.observability,
        }

        for key, present in checks.items():
            weight = dict(_CLOUD_NATIVE_SIGNALS).get(key, 5)
            if present:
                score += weight
                evidence.append(f"✓ {key}")

        score = min(score, 100)

        if score >= 70:
            direction = "POSITIVE"
            insight = f"Cloud-native readiness score: {score}/100. The project follows modern 12-factor / cloud-native principles."
        elif score >= 40:
            direction = "NEUTRAL"
            insight = f"Cloud-native readiness score: {score}/100. Several improvements needed for cloud-native deployment."
        else:
            direction = "WARNING"
            insight = f"Cloud-native readiness score: {score}/100. The project requires significant infrastructure work before cloud deployment."

        steps = []
        for key, present in checks.items():
            if not present:
                step_map = {
                    "docker": "Add a Dockerfile and build the image in CI.",
                    "docker-compose": "Add docker-compose.yml for local development.",
                    "kubernetes": "Create Kubernetes manifests (Deployment, Service, Ingress).",
                    "helm": "Package as a Helm chart for repeatable Kubernetes deployments.",
                    "terraform": "Define infrastructure as code with Terraform.",
                    "github_actions": "Set up GitHub Actions for CI/CD automation.",
                    "env_example": "Add .env.example to document required config.",
                    "prometheus": "Expose /metrics and configure Prometheus scraping.",
                    "opentelemetry": "Instrument with OpenTelemetry for distributed tracing.",
                }
                if key in step_map:
                    steps.append(step_map[key])

        self._predictions.append(Prediction(
            title="Cloud-Native Readiness Score",
            category="Infrastructure",
            insight=insight, confidence=82,
            horizon="mid-term (6–18 months)", impact="HIGH", direction=direction,
            actionable_steps=steps[:5],
            evidence=evidence,
        ))

    # ------------------------------------------------------------------
    # 10. AI/ML Integration Potential
    # ------------------------------------------------------------------

    def _ai_integration_potential(self) -> None:
        backend = " ".join(self.arch.backend).lower()
        has_api = bool(self.arch.api_types)
        has_db = bool(self.arch.databases)
        languages = list(self.ctx.languages.keys())
        is_python = any("python" in lang.lower() for lang in languages)

        opportunities: list[str] = []
        steps: list[str] = []

        if is_python and has_db:
            opportunities.append(
                "Python + a database creates a natural foundation for ML feature pipelines and model serving."
            )
            steps.append("Introduce scikit-learn or PyTorch for on-demand prediction endpoints.")

        if has_api:
            opportunities.append(
                "Existing REST/GraphQL API surface can expose AI-powered endpoints with minimal refactoring."
            )
            steps.append("Wrap a small language model (e.g. via Anthropic or OpenAI SDK) in a dedicated API endpoint.")

        if "Django" in self.arch.backend:
            opportunities.append(
                "Django's ORM makes it straightforward to add AI-driven search (pgvector + PostgreSQL vector similarity)."
            )
            steps.append("Integrate pgvector + Django to build semantic search over stored content.")

        if not opportunities:
            insight = "Limited AI integration signals — focus on stabilising current architecture before adding AI features."
            direction = "NEUTRAL"
        else:
            insight = " | ".join(opportunities)
            direction = "POSITIVE"

        self._predictions.append(Prediction(
            title="AI/ML Integration Potential",
            category="Innovation",
            insight=insight, confidence=70,
            horizon="mid-term (6–18 months)", impact="MEDIUM", direction=direction,
            actionable_steps=steps or ["Assess where prediction or recommendation features could add user value."],
            evidence=[f"Python: {is_python}", f"API: {has_api}", f"DB: {has_db}"],
        ))

    # ------------------------------------------------------------------
    # Aggregation helpers
    # ------------------------------------------------------------------

    def _overall_trajectory(self) -> str:
        counts = {"POSITIVE": 0, "NEGATIVE": 0, "WARNING": 0, "NEUTRAL": 0}
        for p in self._predictions:
            counts[p.direction] = counts.get(p.direction, 0) + 1
        if counts["NEGATIVE"] + counts["WARNING"] > counts["POSITIVE"]:
            return "NEGATIVE"
        if counts["POSITIVE"] > counts["NEGATIVE"] + counts["WARNING"]:
            return "POSITIVE"
        return "NEUTRAL"

    def _trajectory_summary(self, trajectory: str) -> str:
        q = self.quality.overall_score
        s = self.security.risk_score
        labels = {"POSITIVE": "healthy and improving", "NEGATIVE": "at risk", "NEUTRAL": "stable but with room to grow"}
        return (
            f"The project is {labels.get(trajectory, 'unclear')}. "
            f"Quality score: {q}/100. Security risk: {s}/100. "
            f"See individual predictions for targeted actions."
        )

    def _top_risks(self) -> list[str]:
        return [
            p.title for p in self._predictions
            if p.direction in ("NEGATIVE", "WARNING") and p.impact == "HIGH"
        ][:5]

    def _top_opportunities(self) -> list[str]:
        return [
            p.title for p in self._predictions
            if p.direction == "POSITIVE" and p.impact in ("HIGH", "MEDIUM")
        ][:5]