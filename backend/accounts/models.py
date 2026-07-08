import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone


def _generate_code() -> str:
    """6-digit numeric code, zero-padded. `secrets` (not `random`) because
    this is a credential, not a UI detail."""
    return f"{secrets.randbelow(10 ** 6):06d}"


class EmailOTP(models.Model):
    """
    One row per one-time login code sent to an email address.

    The flow: RequestOTPView creates a row + emails the plaintext code to
    the user. VerifyOTPView looks up the most recent unused row for that
    email and checks the submitted code against the stored hash. Codes
    are single-use, short-lived, and locked out after a handful of wrong
    guesses so a leaked/guessed 6-digit code has a narrow window to be
    useful.

    Only the hash is ever stored — same reasoning as password storage:
    the plaintext code should exist only in the one email it was sent in.
    """

    MAX_ATTEMPTS = 5
    DEFAULT_EXPIRY_MINUTES = 10

    email = models.EmailField(db_index=True)
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["email", "is_used", "-created_at"]),
        ]

    def __str__(self):
        return f"OTP for {self.email} (used={self.is_used})"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def is_locked(self) -> bool:
        return self.attempts >= self.MAX_ATTEMPTS

    def check_code(self, raw_code: str) -> bool:
        return check_password(raw_code, self.code_hash)

    @classmethod
    def issue(cls, email: str, expiry_minutes=None):
        """Create a new OTP row for `email` and return (row, plaintext_code).
        The caller is responsible for emailing the plaintext code — it is
        never stored anywhere, including here."""
        minutes = expiry_minutes or getattr(
            settings, "OTP_EXPIRY_MINUTES", cls.DEFAULT_EXPIRY_MINUTES
        )
        raw_code = _generate_code()
        otp = cls.objects.create(
            email=email,
            code_hash=make_password(raw_code),
            expires_at=timezone.now() + timedelta(minutes=minutes),
        )
        return otp, raw_code