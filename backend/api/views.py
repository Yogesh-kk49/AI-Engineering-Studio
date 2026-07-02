from django.http import JsonResponse

def status(request):
    return JsonResponse({
        "status": "online",
        "message": "AI Engineer Studio Backend Running",
        "version": "1.0.0"
    })