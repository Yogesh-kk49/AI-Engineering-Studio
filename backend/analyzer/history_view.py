"""
history_view.py
─────────────────────────────────────────────────────────────────────────────
Bulk-delete endpoint backing the frontend's History page "Clear history"
button. Kept in its own file rather than added to views.py so it's a
clean drop-in alongside the existing single-row delete in
RepositoryAnalysisDetailView.delete(), which this intentionally mirrors
(same user-scoping, same plain .delete(), no extra file-cleanup logic
since RepositoryAnalysis has no custom delete()/signals to preserve).
─────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RepositoryAnalysis


class ClearHistoryView(APIView):
    """
    DELETE /api/analysis/clear/
    Optional body/query param: {"status": "Completed"} to only clear
    terminal (Completed/Failed) rows and leave any in-progress scan
    running — otherwise clears everything for the current user.

    Scoped to request.user exactly like every other analyzer endpoint;
    there is no "clear everyone's history" variant of this.
    """

    def delete(self, request):
        queryset = RepositoryAnalysis.objects.filter(user=request.user)

        only_terminal = str(
            request.query_params.get("only_terminal", "")
        ).lower() in ("1", "true", "yes")
        if only_terminal:
            queryset = queryset.filter(status__in=["Completed", "Failed"])

        deleted_count, _ = queryset.delete()
        return Response(
            {"success": True, "deleted": deleted_count},
            status=status.HTTP_200_OK,
        )