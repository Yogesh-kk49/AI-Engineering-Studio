from rest_framework.throttling import AnonRateThrottle


class OTPRequestThrottle(AnonRateThrottle):
    """Caps how many OTP emails a single IP can trigger.

    Keyed by IP (AnonRateThrottle default) rather than by email, since the
    endpoint is unauthenticated and a per-email limit alone wouldn't stop
    someone from spamming inboxes across many different addresses. The
    per-email resend cooldown in RequestOTPView handles the "one address,
    hammered repeatedly" case; this handles the "one IP, many addresses"
    case. Rate configured under "otp_request" in settings.py.
    """
    scope = "otp_request"


class OTPVerifyThrottle(AnonRateThrottle):
    """Caps guess attempts against the verify endpoint per IP, on top of
    the per-code MAX_ATTEMPTS lockout in EmailOTP itself. Configured under
    "otp_verify" in settings.py.
    """
    scope = "otp_verify"