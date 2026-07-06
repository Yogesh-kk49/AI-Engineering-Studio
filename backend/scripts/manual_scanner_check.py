"""
Manual, ad-hoc sanity check for the scanner service — NOT a Django test.

This used to live at backend/test_scanner.py, where its `test_*.py` name
made Django's test runner (`python manage.py test`) try to import it as a
test module on every CI run. It has no assertions (just a print), does a
live network call to GitHub, and its import path was wrong for how
manage.py actually runs (there is no top-level `backend` package — this
file already lives inside the `backend/` working directory, so the
correct import is `analyzer.services.scanner`, not
`backend.analyzer.services.scanner`).

Run manually with:
    python scripts/manual_scanner_check.py
"""
from analyzer.services.scanner import scan_repository

if __name__ == "__main__":
    print(scan_repository("https://github.com/octocat/Hello-World.git"))