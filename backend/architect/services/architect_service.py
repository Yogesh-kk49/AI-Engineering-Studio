"""
architect_service.py
─────────────────────────────────────────────────────────────────────────────
Advanced architecture analyser for the AI Engineering Studio.

Detects
  • Architecture pattern  (MVC / Layered / Microservices / Serverless /
                           Event-Driven / Monolith / Hexagonal / CQRS / …)
  • Frontend framework stack
  • Backend framework stack
  • Database drivers & likely engines
  • Authentication strategies
  • API surface (REST / GraphQL / gRPC / WebSocket)
  • Infrastructure-as-Code tools
  • Observability tooling
  • Message-queue / event-bus usage
  • Caching layer
  • CI/CD pipelines
  • Modules / apps breakdown
  • Confidence score per finding
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from analyzer.services.github_client import RepoContext


# ──────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ArchitectureResult:
    architecture_patterns: list[dict[str, Any]] = field(default_factory=list)
    frontend: list[str] = field(default_factory=list)
    backend: list[str] = field(default_factory=list)
    databases: list[str] = field(default_factory=list)
    authentication: list[str] = field(default_factory=list)
    api_types: list[str] = field(default_factory=list)
    infrastructure: list[str] = field(default_factory=list)
    observability: list[str] = field(default_factory=list)
    messaging: list[str] = field(default_factory=list)
    caching: list[str] = field(default_factory=list)
    cicd: list[str] = field(default_factory=list)
    technologies: list[str] = field(default_factory=list)
    modules: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    confidence: float = 0.0          # 0–100
    evidence: list[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────

class ArchitectService:
    """
    Stateless: call ArchitectService(ctx).analyze() → ArchitectureResult
    """

    def __init__(self, ctx: RepoContext):
        self.ctx = ctx
        self.root = ctx.local_path
        self.result = ArchitectureResult()
        self._evidence: list[str] = []
        self._score_pool: list[float] = []

        # Derived lookups (populated in analyze)
        self._file_names: set[str] = set()
        self._file_paths: set[str] = set()
        self._dir_names: set[str] = set()

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self) -> ArchitectureResult:
        self._build_lookups()

        self._detect_frontend()
        self._detect_backend()
        self._detect_databases()
        self._detect_auth()
        self._detect_api_types()
        self._detect_infrastructure()
        self._detect_observability()
        self._detect_messaging()
        self._detect_caching()
        self._detect_cicd()
        self._detect_modules()
        self._detect_architecture_patterns()
        self._build_recommendations()

        self.result.evidence = self._evidence
        self.result.confidence = self._compute_confidence()
        return self.result

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def _build_lookups(self) -> None:
        self._file_names = {f.name.lower() for f in self.ctx.all_files}
        self._file_paths = {str(f).lower() for f in self.ctx.all_files}
        self._dir_names = {str(d).lower() for d in self.ctx.all_dirs}

    # ------------------------------------------------------------------
    # Frontend
    # ------------------------------------------------------------------

    _FRONTEND_DEPS: dict[str, str] = {
        "react": "React",
        "react-dom": "React",
        "next": "Next.js",
        "nuxt": "Nuxt.js",
        "vue": "Vue.js",
        "@angular/core": "Angular",
        "svelte": "Svelte",
        "@sveltejs/kit": "SvelteKit",
        "solid-js": "SolidJS",
        "gatsby": "Gatsby",
        "remix": "Remix",
        "astro": "Astro",
        "ember-cli": "Ember.js",
        "backbone": "Backbone.js",
        "jquery": "jQuery",
    }

    _UI_DEPS: dict[str, str] = {
        "tailwindcss": "Tailwind CSS",
        "@mui/material": "Material UI",
        "antd": "Ant Design",
        "@chakra-ui/react": "Chakra UI",
        "bootstrap": "Bootstrap",
        "styled-components": "Styled Components",
        "@emotion/react": "Emotion",
        "shadcn": "shadcn/ui",
    }

    _BUILD_DEPS: dict[str, str] = {
        "vite": "Vite",
        "webpack": "Webpack",
        "turbopack": "Turbopack",
        "parcel": "Parcel",
        "rollup": "Rollup",
        "esbuild": "esbuild",
    }

    def _detect_frontend(self) -> None:
        pkg = self._read_json("package.json")
        if not pkg:
            return
        all_deps: set[str] = set()
        for key in ("dependencies", "devDependencies", "peerDependencies"):
            all_deps.update(pkg.get(key, {}).keys())
        all_deps_lower = {d.lower() for d in all_deps}

        for dep, label in self._FRONTEND_DEPS.items():
            if dep.lower() in all_deps_lower:
                self._add_unique("frontend", label)
                self._evidence.append(f"package.json → {dep}")

        for dep, label in self._UI_DEPS.items():
            if dep.lower() in all_deps_lower:
                self._add_unique("technologies", label)

        for dep, label in self._BUILD_DEPS.items():
            if dep.lower() in all_deps_lower:
                self._add_unique("technologies", label)

        if "typescript" in all_deps_lower:
            self._add_unique("technologies", "TypeScript")

        if "graphql" in all_deps_lower or "@apollo/client" in all_deps_lower:
            self._add_unique("api_types", "GraphQL (client)")

    # ------------------------------------------------------------------
    # Backend
    # ------------------------------------------------------------------

    _PYTHON_FRAMEWORKS: list[tuple[str, str]] = [
        ("django", "Django"),
        ("fastapi", "FastAPI"),
        ("flask", "Flask"),
        ("tornado", "Tornado"),
        ("aiohttp", "aiohttp"),
        ("starlette", "Starlette"),
        ("litestar", "Litestar"),
        ("sanic", "Sanic"),
        ("falcon", "Falcon"),
    ]

    _JVM_MARKERS: list[tuple[str, str]] = [
        ("spring-boot", "Spring Boot"),
        ("quarkus", "Quarkus"),
        ("micronaut", "Micronaut"),
        ("ktor", "Ktor"),
        ("vertx", "Vert.x"),
    ]

    _NODE_FRAMEWORKS: list[tuple[str, str]] = [
        ("express", "Express.js"),
        ("fastify", "Fastify"),
        ("nestjs", "NestJS"),
        ("hapi", "Hapi.js"),
        ("koa", "Koa"),
        ("@hono/node-server", "Hono"),
    ]

    _RUBY_MARKERS = ["rails", "sinatra"]
    _PHP_MARKERS = ["laravel", "symfony", "slim"]
    _GO_MARKERS: list[tuple[str, str]] = [
        ("gin-gonic", "Gin"),
        ("echo", "Echo"),
        ("fiber", "Fiber"),
        ("chi", "Chi"),
    ]
    _RUST_MARKERS: list[tuple[str, str]] = [
        ("actix-web", "Actix-web"),
        ("axum", "Axum"),
        ("rocket", "Rocket"),
    ]

    def _detect_backend(self) -> None:
        # Python
        py_text = self._read_text("requirements.txt") + self._read_text("pyproject.toml")
        if self.ctx.has_setup_py:
            py_text += self._read_text("setup.py")

        for marker, label in self._PYTHON_FRAMEWORKS:
            if marker in py_text.lower():
                self._add_unique("backend", label)
                self._evidence.append(f"requirements/pyproject → {marker}")

        if "manage.py" in self._file_names:
            self._add_unique("backend", "Django")

        # Node.js
        pkg = self._read_json("package.json")
        if pkg:
            all_deps: set[str] = set()
            for k in ("dependencies", "devDependencies"):
                all_deps.update(d.lower() for d in pkg.get(k, {}).keys())
            for marker, label in self._NODE_FRAMEWORKS:
                if marker.lower() in all_deps:
                    self._add_unique("backend", label)
                    self._evidence.append(f"package.json → {marker}")

        # JVM
        pom = self._read_text("pom.xml")
        gradle = self._read_text("build.gradle") + self._read_text("build.gradle.kts")
        jvm_src = (pom + gradle).lower()
        for marker, label in self._JVM_MARKERS:
            if marker in jvm_src:
                self._add_unique("backend", label)
                self._evidence.append(f"pom.xml/build.gradle → {marker}")

        # Go
        go_mod = self._read_text("go.mod").lower()
        for marker, label in self._GO_MARKERS:
            if marker in go_mod:
                self._add_unique("backend", label)
                self._evidence.append(f"go.mod → {marker}")

        # Rust
        cargo = self._read_text("Cargo.toml").lower()
        for marker, label in self._RUST_MARKERS:
            if marker in cargo:
                self._add_unique("backend", label)
                self._evidence.append(f"Cargo.toml → {marker}")

        # Ruby
        gemfile = self._read_text("Gemfile").lower()
        for marker in self._RUBY_MARKERS:
            if marker in gemfile:
                self._add_unique("backend", marker.capitalize())
                self._evidence.append(f"Gemfile → {marker}")

        # PHP
        composer = self._read_text("composer.json").lower()
        for marker in self._PHP_MARKERS:
            if marker in composer:
                self._add_unique("backend", marker.capitalize())

    # ------------------------------------------------------------------
    # Databases
    # ------------------------------------------------------------------

    _DB_MARKERS: list[tuple[str, str]] = [
        # Python drivers
        ("psycopg2", "PostgreSQL"), ("asyncpg", "PostgreSQL"),
        ("mysqlclient", "MySQL"), ("aiomysql", "MySQL"), ("pymysql", "MySQL"),
        ("pymongo", "MongoDB"), ("motor", "MongoDB"),
        ("redis", "Redis"), ("aioredis", "Redis"),
        ("elasticsearch", "Elasticsearch"),
        ("cassandra-driver", "Cassandra"),
        ("neo4j", "Neo4j"),
        ("influxdb", "InfluxDB"),
        ("clickhouse-driver", "ClickHouse"),
        ("sqlite3", "SQLite"),
        ("tortoise-orm", "Tortoise ORM"), ("sqlalchemy", "SQLAlchemy"),
        ("alembic", "Alembic (migrations)"),
        ("django.db", "Django ORM"),
        # Node drivers
        ("pg", "PostgreSQL"), ("mysql2", "MySQL"),
        ("mongoose", "MongoDB"), ("mongodb", "MongoDB"),
        ("ioredis", "Redis"), ("redis", "Redis"),
        ("sequelize", "Sequelize ORM"), ("typeorm", "TypeORM"),
        ("prisma", "Prisma"),
        # JVM
        ("spring-data", "Spring Data"),
        ("hibernate", "Hibernate"),
        # Config files
        ("database_url", "PostgreSQL"),
    ]

    def _detect_databases(self) -> None:
        combined = (
            self._read_text("requirements.txt")
            + self._read_text("pyproject.toml")
            + self._read_text("package.json")
            + self._read_text("pom.xml")
            + self._read_text("docker-compose.yml")
            + self._read_text("docker-compose.yaml")
        ).lower()

        for marker, label in self._DB_MARKERS:
            if marker in combined:
                self._add_unique("databases", label)
                self._evidence.append(f"deps/config → {marker}")

        # Docker Compose image names
        compose = (
            self._read_text("docker-compose.yml")
            + self._read_text("docker-compose.yaml")
        ).lower()
        for img, label in [
            ("postgres", "PostgreSQL"), ("mysql", "MySQL"),
            ("mongo", "MongoDB"), ("redis", "Redis"),
            ("elasticsearch", "Elasticsearch"), ("cassandra", "Cassandra"),
            ("neo4j", "Neo4j"), ("clickhouse", "ClickHouse"),
        ]:
            if f"image: {img}" in compose or f"image: bitnami/{img}" in compose:
                self._add_unique("databases", label)

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    _AUTH_MARKERS: list[tuple[str, str]] = [
        ("djangorestframework-simplejwt", "JWT (SimpleJWT)"),
        ("dj-rest-auth", "dj-rest-auth"),
        ("django-allauth", "django-allauth"),
        ("passportjs", "Passport.js"), ("passport", "Passport.js"),
        ("jsonwebtoken", "JWT"),
        ("@auth0/nextjs-auth0", "Auth0"),
        ("next-auth", "NextAuth.js"),
        ("firebase/auth", "Firebase Auth"), ("firebase-admin", "Firebase Admin"),
        ("python-jose", "JOSE/JWT"),
        ("authlib", "Authlib (OAuth2/OIDC)"),
        ("oauth2", "OAuth2"),
        ("keycloak", "Keycloak"),
        ("okta", "Okta"),
        ("cognito", "AWS Cognito"),
        ("supabase", "Supabase Auth"),
    ]

    def _detect_auth(self) -> None:
        combined = (
            self._read_text("requirements.txt")
            + self._read_text("pyproject.toml")
            + self._read_text("package.json")
        ).lower()

        for marker, label in self._AUTH_MARKERS:
            if marker.lower() in combined:
                self._add_unique("authentication", label)

        # scan settings/config files for auth hints
        settings = self._read_text("settings.py") + self._read_text("config.py")
        if "jwt" in settings.lower():
            self._add_unique("authentication", "JWT")
        if "oauth" in settings.lower():
            self._add_unique("authentication", "OAuth2")
        if "session_cookie" in settings.lower() or "sessionmiddleware" in settings.lower():
            self._add_unique("authentication", "Session-based Auth")

    # ------------------------------------------------------------------
    # API types
    # ------------------------------------------------------------------

    def _detect_api_types(self) -> None:
        combined = (
            self._read_text("requirements.txt")
            + self._read_text("package.json")
            + self._read_text("pyproject.toml")
        ).lower()

        if "graphene" in combined or "strawberry" in combined or "ariadne" in combined:
            self._add_unique("api_types", "GraphQL (server)")
        if "graphql" in combined or "@apollo/server" in combined:
            self._add_unique("api_types", "GraphQL")
        if "grpc" in combined or "grpcio" in combined:
            self._add_unique("api_types", "gRPC")
        if "websocket" in combined or "channels" in combined or "socket.io" in combined:
            self._add_unique("api_types", "WebSocket")
        if "celery" in combined or "dramatiq" in combined:
            self._add_unique("api_types", "Async Task Queue API")

        # REST is the default if backend detected
        if self.result.backend and "GraphQL" not in " ".join(self.result.api_types):
            self._add_unique("api_types", "REST")

        # OpenAPI spec files
        for name in self._file_names:
            if name in ("openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"):
                self._add_unique("api_types", "OpenAPI / Swagger documented")
                self._evidence.append(f"Found {name}")

    # ------------------------------------------------------------------
    # Infrastructure
    # ------------------------------------------------------------------

    _IAC_MARKERS: list[tuple[str, str]] = [
        ("terraform", "Terraform"),
        ("pulumi", "Pulumi"),
        ("cdk", "AWS CDK"),
        ("ansible", "Ansible"),
        ("helm", "Helm (Kubernetes)"),
        ("serverless.yml", "Serverless Framework"),
        ("sam-template", "AWS SAM"),
        ("cloudformation", "AWS CloudFormation"),
    ]

    def _detect_infrastructure(self) -> None:
        for marker, label in self._IAC_MARKERS:
            if marker in self._file_names or any(marker in p for p in self._file_paths):
                self._add_unique("infrastructure", label)
                self._evidence.append(f"Found {marker}")

        if self.ctx.has_dockerfile:
            self._add_unique("infrastructure", "Docker")
        if self.ctx.has_docker_compose:
            self._add_unique("infrastructure", "Docker Compose")
        if any("kubernetes" in p or "k8s" in p for p in self._dir_names):
            self._add_unique("infrastructure", "Kubernetes")
        if any("nginx" in n for n in self._file_names):
            self._add_unique("infrastructure", "Nginx")
        if any("caddy" in n for n in self._file_names):
            self._add_unique("infrastructure", "Caddy")

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------

    _OBS_MARKERS: list[tuple[str, str]] = [
        ("sentry", "Sentry"), ("sentry-sdk", "Sentry"),
        ("opentelemetry", "OpenTelemetry"), ("otel", "OpenTelemetry"),
        ("datadog", "Datadog"), ("ddtrace", "Datadog"),
        ("newrelic", "New Relic"),
        ("prometheus", "Prometheus"), ("prometheus_client", "Prometheus"),
        ("grafana", "Grafana"),
        ("elastic-apm", "Elastic APM"),
        ("loguru", "Loguru"), ("structlog", "structlog"),
        ("jaeger", "Jaeger"),
    ]

    def _detect_observability(self) -> None:
        combined = (
            self._read_text("requirements.txt")
            + self._read_text("package.json")
            + self._read_text("pyproject.toml")
            + self._read_text("docker-compose.yml")
        ).lower()

        for marker, label in self._OBS_MARKERS:
            if marker in combined:
                self._add_unique("observability", label)

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    _MSG_MARKERS: list[tuple[str, str]] = [
        ("celery", "Celery"), ("dramatiq", "Dramatiq"),
        ("kombu", "Kombu"), ("rq", "RQ (Redis Queue)"),
        ("pika", "RabbitMQ (pika)"), ("aio-pika", "RabbitMQ (aio-pika)"),
        ("kafka-python", "Apache Kafka"), ("confluent-kafka", "Apache Kafka"),
        ("aiokafka", "Apache Kafka"),
        ("nats", "NATS"),
        ("bull", "Bull (Redis Queue)"), ("bullmq", "BullMQ"),
        ("aws-sdk", "AWS SQS/SNS"),
        ("google-cloud-pubsub", "Google Pub/Sub"),
    ]

    def _detect_messaging(self) -> None:
        combined = (
            self._read_text("requirements.txt")
            + self._read_text("package.json")
        ).lower()

        for marker, label in self._MSG_MARKERS:
            if marker in combined:
                self._add_unique("messaging", label)

    # ------------------------------------------------------------------
    # Caching
    # ------------------------------------------------------------------

    def _detect_caching(self) -> None:
        combined = (
            self._read_text("requirements.txt")
            + self._read_text("package.json")
            + self._read_text("settings.py")
            + self._read_text("docker-compose.yml")
        ).lower()

        cache_map = {
            "redis": "Redis",
            "memcached": "Memcached",
            "pylibmc": "Memcached",
            "cachetools": "In-process Cache (cachetools)",
            "django.core.cache": "Django Cache Framework",
            "node-cache": "node-cache",
            "lru-cache": "LRU Cache",
        }
        for marker, label in cache_map.items():
            if marker in combined:
                self._add_unique("caching", label)

    # ------------------------------------------------------------------
    # CI/CD
    # ------------------------------------------------------------------

    def _detect_cicd(self) -> None:
        if self.ctx.has_github_actions:
            self._add_unique("cicd", "GitHub Actions")
            self._evidence.append("Found .github/workflows/")

        cicd_files = {
            ".travis.yml": "Travis CI",
            "circle.yml": "CircleCI", ".circleci": "CircleCI",
            "Jenkinsfile": "Jenkins",
            "gitlab-ci.yml": "GitLab CI",
            "azure-pipelines.yml": "Azure Pipelines",
            "bitbucket-pipelines.yml": "Bitbucket Pipelines",
            ".drone.yml": "Drone CI",
            "woodpecker.yml": "Woodpecker CI",
        }
        for fname, label in cicd_files.items():
            if fname.lower() in self._file_names or any(fname.lower() in p for p in self._file_paths):
                self._add_unique("cicd", label)

    # ------------------------------------------------------------------
    # Modules / Django apps
    # ------------------------------------------------------------------

    def _detect_modules(self) -> None:
        """
        For Django: each sub-directory with an apps.py or models.py is a module.
        For Node: each directory with its own package.json is a package/module.
        """
        for f in self.ctx.all_files:
            if f.name in ("apps.py", "models.py") and f.parent != Path("."):
                module_name = f.parent.name
                self._add_unique("modules", module_name)

        # Lerna / yarn workspaces monorepo
        root_pkg = self._read_json("package.json")
        if root_pkg and "workspaces" in root_pkg:
            self._add_unique("technologies", "Monorepo (workspaces)")

    # ------------------------------------------------------------------
    # Architecture pattern detection
    # ------------------------------------------------------------------

    def _detect_architecture_patterns(self) -> None:
        patterns: list[dict] = []

        def _add_pattern(name: str, confidence: float, evidence: str) -> None:
            patterns.append({"pattern": name, "confidence": round(confidence, 1), "evidence": evidence})

        dir_set = self._dir_names

        # MVC / MVT
        if "manage.py" in self._file_names or (
            "models.py" in self._file_names
            and "views.py" in self._file_names
        ):
            _add_pattern("MVC / MVT (Django)", 90.0, "manage.py / models.py+views.py")

        # Layered / N-Tier
        tier_score = sum([
            any("controller" in d for d in dir_set),
            any("service" in d for d in dir_set),
            any("repository" in d for d in dir_set),
            any("dao" in d for d in dir_set),
        ])
        if tier_score >= 2:
            _add_pattern("Layered / N-Tier", 60.0 + tier_score * 10, "controller/service/repository dirs")

        # Microservices
        micro_score = sum([
            self.ctx.has_docker_compose,
            any("kubernetes" in d or "k8s" in d for d in dir_set),
            len(self.result.modules) > 4,
            "api-gateway" in dir_set or any("gateway" in d for d in dir_set),
        ])
        if micro_score >= 2:
            _add_pattern("Microservices", 50.0 + micro_score * 10, "docker-compose / k8s / multiple services")

        # Serverless
        if any("serverless" in n for n in self._file_names) or any("lambda" in p for p in self._file_paths):
            _add_pattern("Serverless", 80.0, "serverless.yml / Lambda functions")

        # Event-Driven
        if self.result.messaging:
            _add_pattern("Event-Driven", 70.0, f"Messaging: {', '.join(self.result.messaging[:2])}")

        # Hexagonal / Ports & Adapters
        hexa_score = sum([
            any("adapters" in d for d in dir_set),
            any("ports" in d for d in dir_set),
            any("domain" in d for d in dir_set),
            any("application" in d for d in dir_set),
            any("infrastructure" in d for d in dir_set),
        ])
        if hexa_score >= 3:
            _add_pattern("Hexagonal (Ports & Adapters)", 65.0 + hexa_score * 5, "domain/ports/adapters structure")

        # CQRS
        if any("command" in d for d in dir_set) and any("query" in d for d in dir_set):
            _add_pattern("CQRS", 75.0, "command/ and query/ directories")

        # Monolith fallback
        if not patterns:
            _add_pattern("Monolith", 60.0, "No clear pattern directories found")

        self.result.architecture_patterns = patterns

    # ------------------------------------------------------------------
    # Recommendations
    # ------------------------------------------------------------------

    def _build_recommendations(self) -> None:
        r = self.result
        recs = self.result.recommendations

        if not self.ctx.has_dockerfile:
            recs.append("Add a Dockerfile to containerise the application.")
        if not self.ctx.has_docker_compose and r.databases:
            recs.append("Add docker-compose.yml to orchestrate app + database locally.")
        if not self.ctx.has_readme:
            recs.append("Add a README.md with setup, usage, and contributing guide.")
        if not self.ctx.has_github_actions and not r.cicd:
            recs.append("Set up a CI/CD pipeline (GitHub Actions recommended).")
        if not self.ctx.has_pre_commit:
            recs.append("Add .pre-commit-config.yaml to enforce code-quality hooks.")
        if not self.ctx.has_env_example:
            recs.append("Add a .env.example to document required environment variables.")
        if not self.ctx.has_license:
            recs.append("Include an open-source license file.")
        if not r.observability:
            recs.append("Integrate error tracking (e.g. Sentry) and structured logging.")
        if not r.caching and r.databases:
            recs.append("Consider adding a caching layer (Redis) for read-heavy endpoints.")
        if not r.authentication:
            recs.append("No auth library detected — ensure authentication is handled.")

    # ------------------------------------------------------------------
    # Confidence
    # ------------------------------------------------------------------

    def _compute_confidence(self) -> float:
        """
        Heuristic: the more signals we found, the higher our confidence.
        """
        signals = (
            len(self.result.backend)
            + len(self.result.frontend)
            + len(self.result.databases)
            + len(self.result.api_types)
            + len(self.result.infrastructure)
            + len(self._evidence)
        )
        return min(round(signals * 4.5, 1), 99.0)

    # ------------------------------------------------------------------
    # File helpers
    # ------------------------------------------------------------------

    def _find_file(self, filename: str) -> Path | None:
        for f in self.ctx.all_files:
            if f.name.lower() == filename.lower():
                return self.ctx.local_path / f
        return None

    def _read_text(self, filename: str, max_bytes: int = 50_000) -> str:
        path = self._find_file(filename)
        if not path or not path.exists():
            return ""
        try:
            return path.read_text(encoding="utf-8", errors="ignore")[:max_bytes]
        except Exception:
            return ""

    def _read_json(self, filename: str) -> dict:
        text = self._read_text(filename)
        if not text:
            return {}
        try:
            return json.loads(text)
        except Exception:
            return {}

    def _add_unique(self, key: str, value: str) -> None:
        lst: list = getattr(self.result, key)
        if value not in lst:
            lst.append(value)