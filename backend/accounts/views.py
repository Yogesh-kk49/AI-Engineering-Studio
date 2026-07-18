import logging

import requests
from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EmailOTP
from .throttles import OTPRequestThrottle, OTPVerifyThrottle

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def _send_via_resend(subject: str, message: str, to_email: str) -> None:
    """
    Send through Resend's HTTP API (port 443) instead of raw SMTP.
    Raises on any non-2xx response or network error — caller is
    responsible for catching and turning that into a user-facing error.

    This exists because Render's free tier blocks outbound SMTP ports
    (587/465) entirely, so django.core.mail's SMTP backend can never
    connect from there no matter what credentials/timeout are set.
    Resend sends over plain HTTPS, so it isn't affected.
    """
    resp = requests.post(
        RESEND_API_URL,
        headers={
            "Authorization": f"Bearer {settings.RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "from": settings.RESEND_FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "text": message,
        },
        timeout=getattr(settings, "EMAIL_TIMEOUT", 10),
    )
    resp.raise_for_status()

# Minimum gap between two OTP emails to the same address. Independent of
# the IP-based OTPRequestThrottle — this stops "click resend" spam to one
# inbox even from a single well-behaved client.
RESEND_COOLDOWN_SECONDS = 30

# NOTE: GuestTokenView has been removed. It was an AllowAny endpoint that
# handed out a valid API token to a shared "guest" account with zero
# authentication, which bypassed every OTP throttle in this file and let
# anyone mint a working token for free. If you need an anonymous/demo
# mode, build it as a dedicated read-only, heavily-throttled endpoint
# (see analyzer/badge_view.py for the pattern) rather than a real token.


class RequestOTPView(APIView):
    """
    POST /api/accounts/otp/request/
    Body: {"email": "someone@gmail.com"}

    Sends a 6-digit one-time login code to the given address and returns
    204/200 either way. Doesn't require the address to have signed in
    before — the account is implicitly created on first successful
    verification, same as any "magic code" login flow.

    Sending goes through Django's SMTP backend, configured in
    settings.py to talk to Gmail (smtp.gmail.com) using a Gmail account +
    App Password. If EMAIL_HOST_USER/EMAIL_HOST_PASSWORD aren't set,
    settings.py swaps in the console backend instead, so codes print to
    the backend's terminal for local dev rather than failing outright.
    """
    permission_classes = [AllowAny]
    throttle_classes = [OTPRequestThrottle]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return Response({"error": "email is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(email)
        except ValidationError:
            return Response({"error": "Enter a valid email address."}, status=status.HTTP_400_BAD_REQUEST)

        recent = EmailOTP.objects.filter(email=email).order_by("-created_at").first()
        if recent:
            elapsed = (timezone.now() - recent.created_at).total_seconds()
            if elapsed < RESEND_COOLDOWN_SECONDS:
                wait = int(RESEND_COOLDOWN_SECONDS - elapsed)
                return Response(
                    {"error": f"Please wait {wait}s before requesting another code."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )

        otp, raw_code = EmailOTP.issue(email)

        expiry_minutes = getattr(settings, "OTP_EXPIRY_MINUTES", EmailOTP.DEFAULT_EXPIRY_MINUTES)
        subject = "Your AI Engineering Studio verification code"
        message = (
            f"Your one-time login code is: {raw_code}\n\n"
            f"This code expires in {expiry_minutes} minutes and can only be used once.\n\n"
            "If you didn't request this, you can safely ignore this email."
        )
        try:
            if getattr(settings, "RESEND_API_KEY", ""):
                _send_via_resend(subject, message, email)
            else:
                send_mail(
                    subject,
                    message,
                    settings.DEFAULT_FROM_EMAIL,
                    [email],
                    fail_silently=False,
                )
        except Exception:
            # Don't leave an unusable, un-sendable code sitting in the DB —
            # a retry should be able to issue a fresh one immediately
            # rather than tripping the resend cooldown for a code the user
            # never received.
            otp.delete()
            logger.error("otp.email_send_failed", extra={"email": email}, exc_info=True)
            return Response(
                {"error": "Could not send the verification email. Please try again shortly."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        logger.info("otp.issued", extra={"email": email})
        response_data = {
            "success": True,
            "message": "Verification code sent. Check your inbox.",
            "expires_in_minutes": expiry_minutes,
        }
        # Neither Resend nor Gmail credentials are configured (see
        # settings.py) — nothing actually left the server, it was just
        # printed to this process's console. Surfacing the code here too
        # means local/dev testing doesn't require watching backend logs.
        # Unreachable once RESEND_API_KEY or EMAIL_HOST_USER/PASSWORD are
        # set to real credentials — real deployments never hit this.
        used_console = (
            not getattr(settings, "RESEND_API_KEY", "")
            and settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend"
        )
        if used_console:
            response_data["debug_otp"] = raw_code
            response_data["debug_note"] = (
                "EMAIL_HOST_USER/EMAIL_HOST_PASSWORD aren't set, so no real "
                "email was sent — this code is only shown because the "
                "server is in console-email fallback mode."
            )
        return Response(response_data, status=status.HTTP_200_OK)


class VerifyOTPView(APIView):
    """
    POST /api/accounts/otp/verify/
    Body: {"email": "someone@gmail.com", "otp": "123456"}

    Validates the most recent unused code issued for that email. On
    success, gets-or-creates a Django User keyed on the email address and
    returns a DRF auth token — the frontend attaches this to every
    subsequent request (see services/api.js), which is what scopes each
    analysis to the person who ran it (RepositoryAnalysis.user).
    """
    permission_classes = [AllowAny]
    throttle_classes = [OTPVerifyThrottle]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        code = (request.data.get("otp") or "").strip()
        if not email or not code:
            return Response({"error": "email and otp are required."}, status=status.HTTP_400_BAD_REQUEST)

        otp = EmailOTP.objects.filter(email=email, is_used=False).order_by("-created_at").first()
        if not otp:
            return Response(
                {"error": "No pending code for this email. Request a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if otp.is_expired:
            return Response({"error": "This code has expired. Request a new one."}, status=status.HTTP_400_BAD_REQUEST)

        if otp.is_locked:
            return Response(
                {"error": "Too many incorrect attempts for this code. Request a new one."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if not otp.check_code(code):
            otp.attempts += 1
            otp.save(update_fields=["attempts"])
            remaining = EmailOTP.MAX_ATTEMPTS - otp.attempts
            if remaining <= 0:
                return Response(
                    {"error": "Too many incorrect attempts. Request a new code."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            return Response(
                {"error": f"Incorrect code. {remaining} attempt(s) left."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        otp.is_used = True
        otp.save(update_fields=["is_used"])

        # username == email keeps this simple and unique; Django's User
        # model doesn't require email uniqueness on its own.
        user, created = User.objects.get_or_create(
            username=email, defaults={"email": email, "is_active": True},
        )
        if not user.email:
            user.email = email
            user.save(update_fields=["email"])

        token, _ = Token.objects.get_or_create(user=user)
        logger.info("otp.verified", extra={"email": email, "new_user": created})
        return Response({
            "success": True,
            "token": token.key,
            "email": email,
            "is_new_user": created,
        })


class MeView(APIView):
    """GET /api/accounts/me/ — resolves the current auth token to a user.
    Used by the frontend on load to restore a session from a saved token
    without asking for a fresh OTP every page refresh."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "email": request.user.email or request.user.username,
            "username": request.user.username,
        })


class LogoutView(APIView):
    """POST /api/accounts/logout/ — invalidates the current auth token so
    a stolen/stale token stops working immediately, rather than relying
    on the frontend simply forgetting it."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)