from django.contrib import admin

from .models import EmailOTP


@admin.register(EmailOTP)
class EmailOTPAdmin(admin.ModelAdmin):
    # code_hash is intentionally not shown/editable — there's nothing
    # useful an admin can do with a hash, and it shouldn't be easy to
    # mistake it for something safe to copy/paste around.
    list_display = ("email", "created_at", "expires_at", "is_used", "attempts")
    list_filter = ("is_used",)
    search_fields = ("email",)
    readonly_fields = ("email", "created_at", "expires_at", "is_used", "attempts")

    def has_add_permission(self, request):
        # OTPs are only ever created by the login flow itself.
        return False