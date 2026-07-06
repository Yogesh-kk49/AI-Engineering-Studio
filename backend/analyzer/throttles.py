from rest_framework.throttling import UserRateThrottle


class BasicScanRateThrottle(UserRateThrottle):
    """Rate limit for Basic Scan requests (GitHub-API-only, no clone).

    Scope rate is configured via REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    in settings.py under the "basic_scan" key.
    """
    scope = "basic_scan"


class DeepScanRateThrottle(UserRateThrottle):
    """Rate limit for Deep Scan requests (full clone + analysis pipeline).

    Deep scans are far more expensive than Basic scans, so they get a
    tighter budget. Configured under the "deep_scan" key.
    """
    scope = "deep_scan"