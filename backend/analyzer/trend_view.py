"""
trend_view.py
─────────────────────────────────────────────────────────────────────────────
Replaces the RepositoryTrendView that used to live in analyzer/views.py.

Two bugs fixed here:

1. It used to filter with `repo_url=repo_url` — an exact string match. Two
   analyses of "the same" repo submitted as
   "https://github.com/django/django" and "github.com/django/django.git"
   (or with/without a trailing slash, or different casing) were treated as
   two different repositories, so trend/compare silently found nothing to
   compare even when history genuinely existed. Matching now normalizes
   both sides the same way the frontend's normalizeRepoUrl() already does
   for its own duplicate-repo detection, so this endpoint agrees with it.

2. This was moot before because Dashboard.jsx deleted the previous scan's
   row every time a rescan produced a new one — see the Dashboard.jsx fix
   alongside this file. With that fixed too, there's now actually more
   than one row per repo for this endpoint to find.
─────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import re

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RepositoryAnalysis


def normalize_repo_url(url: str) -> str:
    """Mirrors frontend/src/utils/helpers.js's normalizeRepoUrl() exactly —
    keep the two in sync if either changes."""
    if not url:
        return ""
    u = url.strip().lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    u = re.sub(r"\.git$", "", u)
    u = re.sub(r"/+$", "", u)
    return u


class RepositoryTrendView(APIView):
    """
    GET /api/analysis/trend/?repo_url=<url>

    Returns the historical composite/quality/security scores for every
    completed analysis of one repository (matched by normalized URL, not
    exact string), oldest first, so the frontend can chart how a repo has
    trended over successive scans and diff the two most recent ones.
    """

    def get(self, request):
        repo_url = (request.query_params.get("repo_url") or "").strip()
        if not repo_url:
            return Response(
                {"error": "repo_url query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target = normalize_repo_url(repo_url)

        # Filtering in Python rather than in SQL here — a case/format-
        # insensitive match on a handful of URL variants isn't something a
        # plain `.filter()` expresses well, and a single user's total
        # analysis count is small enough (even in the hundreds) that this
        # is a non-issue. If this ever needs to scale further, storing a
        # normalized_repo_url column (populated on save) and indexing that
        # would be the next step.
        candidates = RepositoryAnalysis.objects.filter(
            user=request.user, status="Completed",
        ).order_by("created_at")

        points = []
        for analysis in candidates:
            if normalize_repo_url(analysis.repo_url) != target:
                continue
            meta = analysis.metadata or {}
            quality = meta.get("quality") or {}
            security = meta.get("security") or {}
            points.append({
                "id": analysis.pk,
                "commit_sha": analysis.commit_sha,
                "created_at": analysis.created_at,
                "composite_score": meta.get("composite_score"),
                "quality_score": quality.get("overall_score"),
                "security_risk_score": security.get("risk_score"),
            })

        return Response({"repo_url": repo_url, "points": points})