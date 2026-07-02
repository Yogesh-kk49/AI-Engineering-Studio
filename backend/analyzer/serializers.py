from rest_framework import serializers
from .models import RepositoryAnalysis

class RepositoryAnalysisSerializer(serializers.ModelSerializer):
    class Meta:
        model = RepositoryAnalysis
        fields = "__all__"
        read_only_fields = ("id", "created_at", "last_scanned")