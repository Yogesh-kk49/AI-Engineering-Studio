from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class GuestTokenView(APIView):
    """
    POST /api/accounts/guest-token/

    The analyzer API now requires an auth token on every request (each
    analysis is scoped to the user that created it). This app doesn't
    have a login screen yet, so rather than breaking the existing
    single-user workflow, this endpoint transparently provisions (or
    reuses) one stable local "guest" account and hands back its token.
    Idempotent — repeated calls return the same guest user's token.

    This is a stopgap for local/self-hosted use, not real multi-tenant
    auth. Swap it out for a proper login/registration flow if this ever
    needs to support more than one real user per deployment.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        user, _ = User.objects.get_or_create(
            username="guest",
            defaults={"is_active": True},
        )
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "username": user.username})