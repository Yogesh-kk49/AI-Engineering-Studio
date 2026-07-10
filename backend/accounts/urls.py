from django.urls import path

from .views import (
    LogoutView,
    MeView,
    RequestOTPView,
    VerifyOTPView,
)

urlpatterns = [
    path("otp/request/", RequestOTPView.as_view(), name="otp-request"),
    path("otp/verify/", VerifyOTPView.as_view(), name="otp-verify"),
    path("me/", MeView.as_view(), name="me"),
    path("logout/", LogoutView.as_view(), name="logout"),
    # guest-token/ intentionally removed — see accounts/views.py note.
]