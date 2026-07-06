from django.urls import path

from .views import status
from analyzer.views import (
    AnalyzeRepositoryView,
    RepositoryAnalysisListView,
    RepositoryAnalysisDetailView,
    RepositoryAnalysisProgressView,
    RepositoryTrendView,
    DownloadRepositoryZipView,
    ExportMarkdownView,
    ExportPdfView,
    AnalysisFileContentView,
    RepositoryChatView,
)

urlpatterns = [
    path("system/status/", status),
    path("analyze/", AnalyzeRepositoryView.as_view(), name="analyze"),
    path("analysis/", RepositoryAnalysisListView.as_view(), name="analysis-list"),
    path("analysis/trend/", RepositoryTrendView.as_view(), name="analysis-trend"),
    path("analysis/<int:pk>/", RepositoryAnalysisDetailView.as_view(), name="analysis-detail"),
    path("analysis/<int:pk>/progress/", RepositoryAnalysisProgressView.as_view(), name="analysis-progress"),
    path("analysis/<int:pk>/download/", DownloadRepositoryZipView.as_view(), name="analysis-download"),
    path("analysis/<int:pk>/export/markdown/", ExportMarkdownView.as_view(), name="analysis-export-markdown"),
    path("analysis/<int:pk>/export/pdf/", ExportPdfView.as_view(), name="analysis-export-pdf"),
    path("analysis/<int:pk>/file/", AnalysisFileContentView.as_view(), name="analysis-file-content"),
    path("analysis/<int:pk>/chat/", RepositoryChatView.as_view(), name="analysis-chat"),
]