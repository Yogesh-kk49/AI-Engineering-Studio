class SummaryService:

    @staticmethod
    def generate(repository):

        metadata = repository.metadata or {}

        languages = metadata.get("languages", {})
        frameworks = metadata.get("frameworks", [])
        package_managers = metadata.get("package_managers", [])
        databases = metadata.get("database", [])
        testing = metadata.get("testing", [])

        # Primary Language
        if languages:
            primary_language = max(
                languages,
                key=languages.get
            )
        else:
            primary_language = "Unknown"

        # Project Type
        if "Django" in frameworks:
            project_type = "Backend Web Application"

        elif "React" in frameworks:
            project_type = "Frontend Web Application"

        else:
            project_type = "Software Project"

        # Complexity

        total = repository.file_count

        if total > 5000:
            complexity = "Very High"

        elif total > 1000:
            complexity = "High"

        elif total > 300:
            complexity = "Medium"

        else:
            complexity = "Low"

        # Production Score

        score = 0

        if repository.has_readme:
            score += 15

        if repository.has_docker:
            score += 20

        if repository.has_requirements:
            score += 15

        if repository.has_package_json:
            score += 15

        if frameworks:
            score += 15

        if testing:
            score += 10

        if metadata.get("github_actions"):
            score += 10

        return {

            "project_name": repository.project_name,

            "project_type": project_type,

            "primary_language": primary_language,

            "frameworks": frameworks,

            "package_managers": package_managers,

            "database": databases,

            "testing": testing,

            "complexity": complexity,

            "production_score": score,

            "health_score": round(score / 10, 1),

            "file_count": repository.file_count,

            "folder_count": repository.folder_count,

            "recommendations": SummaryService.get_recommendations(
                repository,
                metadata
            )
        }

    @staticmethod
    def get_recommendations(repository, metadata):

        recommendations = []

        if not repository.has_readme:
            recommendations.append(
                "Add a README.md"
            )

        if not repository.has_docker:
            recommendations.append(
                "Containerize the application using Docker."
            )

        if not metadata.get("github_actions"):
            recommendations.append(
                "Configure GitHub Actions CI/CD."
            )

        if not metadata.get("testing"):
            recommendations.append(
                "Add automated unit tests."
            )

        if not metadata.get("license"):
            recommendations.append(
                "Include an open-source license."
            )

        return recommendations