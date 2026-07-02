"""
celery.py
─────────────────────────────────────────────────────────────────────────────
Celery application instance for the AI Engineering Studio project.

This wires Celery into Django so that long-running repository analysis jobs
(cloning, scanning, AI analysis, report generation) run on background workers
instead of blocking the HTTP request/response cycle.

Start a worker with:
    celery -A config worker -l info --pool=solo      # Windows / dev
    celery -A config worker -l info                  # Linux / prod

Start the periodic-task beat scheduler (optional, used for cache cleanup):
    celery -A config beat -l info
─────────────────────────────────────────────────────────────────────────────
"""

import os

from celery import Celery

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("ai_engineering_studio")

# Read config from Django settings, using a CELERY_ namespace so all
# celery-related settings start with CELERY_ in settings.py.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Discover tasks.py modules in every installed app.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Simple task to verify the worker is alive: celery -A config call config.celery.debug_task"""
    print(f"Request: {self.request!r}")