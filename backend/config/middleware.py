"""
RoomGenie AI — Correlation and Request Tracking Middleware (Phase 8.3).
Provides per-request correlation IDs across HTTP lifecycle and structured logging.
"""
import threading
import uuid
from typing import Callable
from django.http import HttpRequest, HttpResponse

_thread_locals = threading.local()


def get_current_request_id() -> str:
    """Returns the correlation request ID for the current thread, or empty string."""
    return getattr(_thread_locals, 'request_id', '')


# Convenient alias
get_correlation_id = get_current_request_id


def set_current_request_id(request_id: str) -> None:
    """Sets the correlation request ID for the current thread."""
    _thread_locals.request_id = request_id


def clear_current_request_id() -> None:
    """Cleans up the thread-local request ID."""
    if hasattr(_thread_locals, 'request_id'):
        delattr(_thread_locals, 'request_id')


class CorrelationIdMiddleware:
    """
    Middleware that captures or generates a unique correlation request ID for every HTTP request.
    Injects request_id into thread-local storage for log formatters, attaches request.request_id,
    and returns X-Request-ID in HTTP response headers.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        # Check if caller supplied an X-Request-ID or X-Correlation-ID header
        incoming_id = (
            request.headers.get('X-Request-ID')
            or request.headers.get('X-Correlation-ID')
            or request.META.get('HTTP_X_REQUEST_ID')
            or ''
        ).strip()

        # Validate format or generate clean UUID4
        if incoming_id and len(incoming_id) <= 64:
            # Sanitize to alphanumeric + hyphens
            request_id = ''.join(c for c in incoming_id if c.isalnum() or c == '-')
            if not request_id:
                request_id = str(uuid.uuid4())
        else:
            request_id = str(uuid.uuid4())

        request.request_id = request_id
        request.correlation_id = request_id
        set_current_request_id(request_id)

        try:
            response = self.get_response(request)
        finally:
            clear_current_request_id()

        # Attach to outgoing response headers
        response['X-Request-ID'] = request_id
        return response
