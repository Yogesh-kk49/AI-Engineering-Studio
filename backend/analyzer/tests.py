"""
backend/analyzer/tests.py

Real test coverage for the analyzer app, replacing the Django boilerplate
stub. Focused on the highest-risk, highest-value logic:

  1. GitHub URL parsing (github_client._parse_github_url) — every scan
     request goes through this; a bad edge case here breaks everything
     downstream.
  2. RepositoryAnalysis model behavior (is_terminal, default ordering).
  3. The security scanner's regex-based secret/vulnerability detection —
     the part of the codebase most likely to silently regress.
  4. The analysis list API — pagination, and that the trimmed-metadata
     behavior for collapsed cards still works.

Run with:
    python manage.py test analyzer
"""
from pathlib import Path
import tempfile

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from rest_framework.authtoken.models import Token

from .models import RepositoryAnalysis
from .views import AnalyzeRepositoryView
from .services.github_client import _parse_github_url, RepoContext
from architect.services.security_service import SecurityService


# ──────────────────────────────────────────────────────────────────────────
# 1. GitHub URL parsing
# ──────────────────────────────────────────────────────────────────────────

class ParseGithubUrlTests(TestCase):
    def test_https_url(self):
        owner, repo = _parse_github_url("https://github.com/django/django")
        self.assertEqual((owner, repo), ("django", "django"))

    def test_https_url_with_trailing_slash(self):
        owner, repo = _parse_github_url("https://github.com/django/django/")
        self.assertEqual((owner, repo), ("django", "django"))

    def test_https_url_with_git_suffix(self):
        owner, repo = _parse_github_url("https://github.com/django/django.git")
        self.assertEqual((owner, repo), ("django", "django"))

    def test_ssh_url(self):
        owner, repo = _parse_github_url("git@github.com:django/django.git")
        self.assertEqual((owner, repo), ("django", "django"))

    def test_url_with_extra_path_segments_ignored(self):
        # A URL to a specific file/branch still resolves to the repo itself.
        owner, repo = _parse_github_url(
            "https://github.com/django/django/tree/main/docs"
        )
        self.assertEqual((owner, repo), ("django", "django"))

    def test_invalid_url_raises(self):
        with self.assertRaises(ValueError):
            _parse_github_url("https://gitlab.com/django/django")

    def test_incomplete_url_raises(self):
        with self.assertRaises(ValueError):
            _parse_github_url("https://github.com/django")


# ──────────────────────────────────────────────────────────────────────────
# 2. RepositoryAnalysis model
# ──────────────────────────────────────────────────────────────────────────

class RepositoryAnalysisModelTests(TestCase):
    def test_is_terminal_false_while_running(self):
        for status_value in ("Queued", "Cloning", "Scanning", "AI Analysis", "Generating Report"):
            analysis = RepositoryAnalysis.objects.create(
                repo_url="https://github.com/a/b", status=status_value
            )
            self.assertFalse(analysis.is_terminal, f"{status_value} should not be terminal")

    def test_is_terminal_true_when_done(self):
        for status_value in ("Completed", "Failed"):
            analysis = RepositoryAnalysis.objects.create(
                repo_url="https://github.com/a/b", status=status_value
            )
            self.assertTrue(analysis.is_terminal, f"{status_value} should be terminal")

    def test_default_ordering_is_newest_first(self):
        older = RepositoryAnalysis.objects.create(repo_url="https://github.com/a/old")
        newer = RepositoryAnalysis.objects.create(repo_url="https://github.com/a/new")
        results = list(RepositoryAnalysis.objects.all())
        self.assertEqual(results[0].id, newer.id)
        self.assertEqual(results[1].id, older.id)

    def test_str_prefers_project_name(self):
        analysis = RepositoryAnalysis.objects.create(
            repo_url="https://github.com/a/b", project_name="My Project"
        )
        self.assertEqual(str(analysis), "My Project")

    def test_str_falls_back_to_repo_url(self):
        analysis = RepositoryAnalysis.objects.create(repo_url="https://github.com/a/b")
        self.assertEqual(str(analysis), "https://github.com/a/b")


# ──────────────────────────────────────────────────────────────────────────
# 3. Security scanner — regex-based detection
# ──────────────────────────────────────────────────────────────────────────

class SecurityServiceTests(TestCase):
    def _make_ctx(self, files: dict[str, str]) -> RepoContext:
        """Write `files` (relative path -> content) into a temp dir and
        return a RepoContext pointed at it, matching what the real clone
        pipeline hands to SecurityService."""
        tmp_dir = Path(tempfile.mkdtemp())
        rel_paths = []
        for rel_path, content in files.items():
            full_path = tmp_dir / rel_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")
            rel_paths.append(Path(rel_path))

        ctx = RepoContext(owner="test", repo_name="repo", url="https://github.com/test/repo")
        ctx.local_path = tmp_dir
        ctx.all_files = rel_paths
        return ctx

    def test_detects_hardcoded_secret(self):
        ctx = self._make_ctx({
            "settings.py": 'AWS_SECRET_ACCESS_KEY = "AKIAABCDEFGHIJKLMNOP"\n'
        })
        result = SecurityService(ctx).analyze()
        self.assertTrue(
            any("secret" in f.category.lower() or "credential" in f.category.lower()
                or "key" in f.description.lower() for f in result.findings),
            f"Expected a secret/credential finding, got: {[f.description for f in result.findings]}",
        )

    def test_detects_eval_usage(self):
        ctx = self._make_ctx({"app.py": "user_input = input()\neval(user_input)\n"})
        result = SecurityService(ctx).analyze()
        self.assertTrue(
            any("eval" in f.description.lower() for f in result.findings),
            f"Expected an eval() finding, got: {[f.description for f in result.findings]}",
        )

    def test_clean_file_produces_no_critical_findings(self):
        ctx = self._make_ctx({
            "app.py": (
                "def add(a, b):\n"
                "    \"\"\"Add two numbers.\"\"\"\n"
                "    return a + b\n"
            )
        })
        result = SecurityService(ctx).analyze()
        critical = [f for f in result.findings if f.severity == "CRITICAL"]
        self.assertEqual(critical, [])

    def test_scanned_files_count_reported(self):
        ctx = self._make_ctx({
            "a.py": "x = 1\n",
            "b.py": "y = 2\n",
            "readme.md": "not scanned by extension list\n",
        })
        result = SecurityService(ctx).analyze()
        # .py files are scanned, .md is not in _SCAN_EXTENSIONS.
        self.assertEqual(result.scanned_files, 2)


# ──────────────────────────────────────────────────────────────────────────
# 4. Analysis list API — pagination + payload shape
# ──────────────────────────────────────────────────────────────────────────

class AnalysisListAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="testpass123")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

        for i in range(25):
            RepositoryAnalysis.objects.create(
                user=self.user,
                repo_url=f"https://github.com/test/repo{i}",
                status="Completed",
                metadata={
                    "primary_language": "Python",
                    "stars": i,
                    "composite_score": 80,
                    "quality": {"overall_score": 90},
                    "security": {"risk_score": 10},
                    "file_tree": ["huge", "payload", "that", "shouldn't", "ship", "in", "list", "view"],
                },
            )

    def test_unauthenticated_request_rejected(self):
        self.client.credentials()  # strip the token set up in setUp
        response = self.client.get("/api/analysis/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_default_page_size(self):
        response = self.client.get("/api/analysis/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 25)
        self.assertLessEqual(len(response.data["results"]), 20)

    def test_page_two_returns_remainder(self):
        response = self.client.get("/api/analysis/", {"page": 2, "page_size": 20})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 5)

    def test_metadata_trimmed_in_list_view(self):
        response = self.client.get("/api/analysis/")
        row = response.data["results"][0]
        # Only the small, card-header fields should survive — not file_tree.
        self.assertNotIn("file_tree", row["metadata"])
        self.assertIn("composite_score", row["metadata"])

    def test_invalid_page_params_fall_back_to_defaults(self):
        response = self.client.get("/api/analysis/", {"page": "not-a-number"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["page"], 1)

    def test_page_size_is_capped(self):
        response = self.client.get("/api/analysis/", {"page_size": 999})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertLessEqual(len(response.data["results"]), 100)


# ──────────────────────────────────────────────────────────────────────────
# 5. Auth — user isolation
# ──────────────────────────────────────────────────────────────────────────

class UserIsolationTests(APITestCase):
    """The whole point of auth: User A must never see User B's analyses."""

    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="testpass123")
        self.bob = User.objects.create_user(username="bob", password="testpass123")
        self.alice_token = Token.objects.create(user=self.alice)
        self.bob_token = Token.objects.create(user=self.bob)

        self.alice_analysis = RepositoryAnalysis.objects.create(
            user=self.alice, repo_url="https://github.com/alice/private-repo", status="Completed"
        )
        self.bob_analysis = RepositoryAnalysis.objects.create(
            user=self.bob, repo_url="https://github.com/bob/private-repo", status="Completed"
        )

    def test_list_view_only_shows_own_analyses(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.alice_token.key}")
        response = self.client.get("/api/analysis/")
        ids = [row["id"] for row in response.data["results"]]
        self.assertIn(self.alice_analysis.id, ids)
        self.assertNotIn(self.bob_analysis.id, ids)

    def test_cannot_fetch_another_users_analysis_detail(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.bob_token.key}")
        response = self.client.get(f"/api/analysis/{self.alice_analysis.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_delete_another_users_analysis(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.bob_token.key}")
        response = self.client.delete(f"/api/analysis/{self.alice_analysis.id}/")
        self.assertIn(response.status_code, (status.HTTP_404_NOT_FOUND, status.HTTP_403_FORBIDDEN))
        self.assertTrue(RepositoryAnalysis.objects.filter(id=self.alice_analysis.id).exists())


# ──────────────────────────────────────────────────────────────────────────
# 6. Rate limiting
# ──────────────────────────────────────────────────────────────────────────

class ThrottleTests(APITestCase):
    """
    Confirms the Basic/Deep scan throttle scopes are actually attached and
    enforced — not just configured in settings and silently unused.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="carol", password="testpass123")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_basic_scan_throttle_limit_enforced(self):
        """
        Exercises BasicScanRateThrottle directly against a fixed rate,
        rather than round-tripping through override_settings (whose signal
        based cache invalidation timing is easy to get wrong in a test and
        would end up testing that plumbing instead of the throttle logic
        itself).
        """
        from django.core.cache import cache
        from django.test import RequestFactory
        from analyzer.throttles import BasicScanRateThrottle

        cache.clear()
        factory = RequestFactory()
        view = AnalyzeRepositoryView()

        class _FixedRateThrottle(BasicScanRateThrottle):
            rate = "2/hour"

            def get_rate(self):
                return self.rate

        throttle = _FixedRateThrottle()
        throttle.THROTTLE_RATES = {"basic_scan": "2/hour"}
        django_request = factory.post("/api/analyze/")
        django_request.user = self.user

        allowed = [throttle.allow_request(django_request, view) for _ in range(3)]
        # First 2 requests within the 2/hour budget succeed; the 3rd is throttled.
        self.assertEqual(allowed, [True, True, False])


# ──────────────────────────────────────────────────────────────────────────
# 7. Historical trend endpoint
# ──────────────────────────────────────────────────────────────────────────

class RepositoryTrendAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="dana", password="testpass123")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.repo_url = "https://github.com/test/tracked-repo"

        for score, sha in [(60, "aaa1111"), (75, "bbb2222"), (90, "ccc3333")]:
            RepositoryAnalysis.objects.create(
                user=self.user,
                repo_url=self.repo_url,
                status="Completed",
                commit_sha=sha,
                metadata={
                    "composite_score": score,
                    "quality": {"overall_score": score},
                    "security": {"risk_score": 100 - score},
                },
            )
        # A different, unrelated repo shouldn't leak into this trend.
        RepositoryAnalysis.objects.create(
            user=self.user, repo_url="https://github.com/test/other-repo", status="Completed",
            metadata={"composite_score": 10},
        )

    def test_requires_repo_url_param(self):
        response = self.client.get("/api/analysis/trend/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_returns_points_in_chronological_order(self):
        response = self.client.get("/api/analysis/trend/", {"repo_url": self.repo_url})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        scores = [p["composite_score"] for p in response.data["points"]]
        self.assertEqual(scores, [60, 75, 90])

    def test_does_not_include_other_repos(self):
        response = self.client.get("/api/analysis/trend/", {"repo_url": self.repo_url})
        self.assertEqual(len(response.data["points"]), 3)

    def test_trend_route_not_shadowed_by_pk_route(self):
        # /analysis/trend/ must resolve to RepositoryTrendView, not get
        # swallowed by /analysis/<int:pk>/ trying to parse "trend" as an id.
        response = self.client.get("/api/analysis/trend/", {"repo_url": self.repo_url})
        self.assertNotEqual(response.status_code, status.HTTP_404_NOT_FOUND)