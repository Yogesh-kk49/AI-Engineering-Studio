"""
badge_view.py
─────────────────────────────────────────────────────────────────────────────
Public, read-only "shields.io style" SVG badge for a completed analysis —
e.g. for embedding in a repo's own README as:

    ![Code Health](https://your-domain.com/api/analysis/42/badge.svg)

Deliberately the ONE endpoint in this app that's unauthenticated (AllowAny)
by design, not by mistake — see accounts/views.py's note on the old
GuestTokenView for what an *accidental* unauthenticated endpoint looked
like. This one:
  • Only ever returns a tiny SVG (grade + score), nothing else from the
    analysis (no repo path, no file contents, no user info).
  • Is heavily throttled (see "badge" scope in settings.py) since it has
    no auth to rate-limit per-user.
  • 404s (same shape as "not found") for analyses that aren't Completed,
    so an in-progress/failed job's state is never leaked either.
─────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

from django.http import HttpResponse
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import RepositoryAnalysis

GRADE_COLORS = {
    "A": "#059669",  # green
    "B": "#2563eb",  # blue
    "C": "#d97706",  # amber
    "D": "#ea580c",  # orange
    "F": "#dc2626",  # red
}
DEFAULT_COLOR = "#6b7280"  # gray — used when there's no score yet


class BadgeRateThrottle(AnonRateThrottle):
    """Public endpoint, so this throttles by IP rather than by user.
    Rate configured under the "badge" key in settings.py."""
    scope = "badge"


def _grade_for_score(score: float | None) -> str | None:
    if score is None:
        return None
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 55:
        return "C"
    if score >= 35:
        return "D"
    return "F"


def _build_svg(label: str, message: str, color: str) -> str:
    # Simple two-segment flat badge, sized to fit the text (rough
    # character-width estimate — good enough for a badge, not meant to be
    # pixel-perfect typography).
    label_w = 8 * len(label) + 20
    message_w = 8 * len(message) + 20
    total_w = label_w + message_w

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="20" role="img" aria-label="{label}: {message}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="{total_w}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_w}" height="20" fill="#555"/>
    <rect x="{label_w}" width="{message_w}" height="20" fill="{color}"/>
    <rect width="{total_w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
    <text x="{label_w / 2}" y="14">{label}</text>
    <text x="{label_w + message_w / 2}" y="14">{message}</text>
  </g>
</svg>"""


class RepositoryBadgeView(APIView):
    """
    GET /api/analysis/<id>/badge.svg

    Returns an SVG badge showing the composite health grade + score for
    a completed analysis. Anyone with the URL can view it (that's the
    point — it's meant to be embedded in a public README), but no other
    analysis data is exposed here.
    """
    permission_classes = [AllowAny]
    throttle_classes = [BadgeRateThrottle]

    def get(self, request, pk):
        try:
            analysis = RepositoryAnalysis.objects.only(
                "id", "status", "metadata",
            ).get(pk=pk)
        except RepositoryAnalysis.DoesNotExist:
            svg = _build_svg("code health", "not found", DEFAULT_COLOR)
            return HttpResponse(svg, content_type="image/svg+xml", status=404)

        if analysis.status != "Completed":
            svg = _build_svg("code health", "pending", DEFAULT_COLOR)
            resp = HttpResponse(svg, content_type="image/svg+xml")
        else:
            meta = analysis.metadata or {}
            score = meta.get("composite_score")
            grade = _grade_for_score(score)
            message = f"{grade} ({round(score)})" if grade and score is not None else "n/a"
            color = GRADE_COLORS.get(grade, DEFAULT_COLOR)
            svg = _build_svg("code health", message, color)
            resp = HttpResponse(svg, content_type="image/svg+xml")

        # Badges get embedded and re-fetched by GitHub's own camo proxy /
        # browsers on every README view — a short cache avoids this
        # cheap-but-frequent endpoint getting hit on every single page
        # load of someone's README.
        resp["Cache-Control"] = "public, max-age=600"
        return resp