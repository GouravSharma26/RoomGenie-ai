from django.db import connection
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

def check_database_connection() -> str:
    """Check if the default database is connected and responsive."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1;')
            row = cursor.fetchone()
            if row and row[0] == 1:
                return 'connected'
    except Exception:
        return 'disconnected'
    return 'disconnected'

@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """
    Minimal health check endpoint for RoomGenie AI backend.
    Returns service info, current timestamp, and database connectivity status.
    """
    payload = {
        'status': 'ok',
        'service': 'RoomGenie AI Backend',
        'version': '0.1.0',
        'database': check_database_connection(),
        'timestamp': timezone.now().isoformat(),
    }
    return Response(payload, status=status.HTTP_200_OK)
