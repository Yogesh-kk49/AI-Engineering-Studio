import os
from pathlib import Path

from git import Repo


def scan_repository(repo_url):
    BASE_DIR = Path(__file__).resolve().parent.parent

    REPO_ROOT = BASE_DIR / "repositories"
    REPO_ROOT.mkdir(exist_ok=True)

    project_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")
    repo_path = REPO_ROOT / project_name

    print("📥 Cloning repository...")

    if not repo_path.exists():
        Repo.clone_from(
            repo_url,
            repo_path,
            depth=1,
            single_branch=True,
        )

    print("✅ Clone completed!")
    print("📂 Scanning files...")

    languages = set()
    frameworks = set()
    frontend = set()
    package_managers = set()
    has_readme = False
    has_docker = False
    has_docker_compose = False
    has_requirements = False
    has_package_json = False
    has_gitignore = False
    has_license = False
    has_github_actions = False

    total_files = 0
    total_folders = 0

    for root, dirs, files in os.walk(repo_path):

        total_folders += len(dirs)
        total_files += len(files)

        if ".github" in root and "workflows" in root:
            has_github_actions = True

        for file in files:

            name = file.lower()
            ext = os.path.splitext(name)[1]

            # ---------- Common Files ----------

            if name.startswith("readme"):
                has_readme = True

            elif name == "dockerfile":
                has_docker = True

            elif name in ("docker-compose.yml", "docker-compose.yaml"):
                has_docker_compose = True

            elif name == "requirements.txt":
                has_requirements = True
                package_managers.add("pip")

            elif name == "package.json":
                has_package_json = True
                package_managers.add("npm")

            elif name == "package-lock.json":
                package_managers.add("npm")

            elif name == "yarn.lock":
                package_managers.add("yarn")

            elif name == "pnpm-lock.yaml":
                package_managers.add("pnpm")

            elif name == "pom.xml":
                frameworks.add("Spring")
                package_managers.add("Maven")

            elif name == "build.gradle":
                package_managers.add("Gradle")

            elif name == "go.mod":
                languages.add("Go")

            elif name == "cargo.toml":
                languages.add("Rust")

            elif name == "composer.json":
                languages.add("PHP")
                package_managers.add("Composer")

            elif name == ".gitignore":
                has_gitignore = True

            elif name.startswith("license"):
                has_license = True

            # ---------- Framework Detection ----------

            elif name == "manage.py":
                frameworks.add("Django")
                languages.add("Python")

            elif name == "angular.json":
                frontend.add("Angular")

            elif name in ("vite.config.js", "vite.config.ts"):
                frontend.add("Vite")

            elif name in ("next.config.js", "next.config.mjs"):
                frontend.add("Next.js")

            elif name in ("tailwind.config.js", "tailwind.config.ts"):
                frontend.add("TailwindCSS")

            # ---------- Languages ----------

            if ext == ".py":
                languages.add("Python")

            elif ext == ".js":
                languages.add("JavaScript")

            elif ext == ".ts":
                languages.add("TypeScript")

            elif ext == ".java":
                languages.add("Java")

            elif ext == ".go":
                languages.add("Go")

            elif ext == ".php":
                languages.add("PHP")

            elif ext == ".rs":
                languages.add("Rust")

            elif ext == ".cs":
                languages.add("C#")

            elif ext == ".cpp":
                languages.add("C++")

            elif ext == ".c":
                languages.add("C")

            elif ext == ".swift":
                languages.add("Swift")

    print("✅ Scan complete!")

    return {
        "files": total_files,
        "folders": total_folders,

        "languages": sorted(languages),
        "frameworks": sorted(frameworks),
        "frontend": sorted(frontend),
        "package_managers": sorted(package_managers),

        "readme": has_readme,
        "docker": has_docker,
        "docker_compose": has_docker_compose,
        "requirements": has_requirements,
        "package_json": has_package_json,
        "gitignore": has_gitignore,
        "license": has_license,
        "github_actions": has_github_actions,
    }



