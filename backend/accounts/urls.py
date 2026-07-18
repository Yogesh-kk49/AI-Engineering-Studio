from django.urls import path

from .views import (
    GoogleLoginView,
    LogoutView,
    MeView,
)

urlpatterns = [
    path("google/", GoogleLoginView.as_view(), name="google-login"),
    path("me/", MeView.as_view(), name="me"),
    path("logout/", LogoutView.as_view(), name="logout"),
    # otp/request/ and otp/verify/ removed — Google Sign-In is now the
    # only login method. RequestOTPView/VerifyOTPView are left in
    # views.py (harmless, unused) rather than deleted, in case OTP login
    # needs to come back later; nothing currently routes to them.
    # guest-token/ intentionally removed — see accounts/views.py note.
]