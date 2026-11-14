"""
RoomGenie AI — Correlation and Request Tracking Middleware (Phase 8.3 & 8.3.1).
Provides async-safe per-request correlation IDs using contextvars.ContextVar across HTTP lifecycle and structured logging.
"""
import contextvars
import uuid
from typing import Callable, Optional
from django.http import HttpRequest, HttpResponse

# ContextVar for async-safe request correlation tracking across concurrent coroutines and threads
_correlation_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar('correlation_id', default='')


def get_current_request_id() -> str:
    """Returns the correlation request ID for the current context, or empty string."""
    return _correlation_id_ctx.get()


# Convenient alias
get_correlation_id = get_current_request_id


def set_current_request_id(request_id: str) -> contextvars.Token:
    """Sets the correlation request ID for the current context and returns the contextvars Token."""
    return _correlation_id_ctx.set(request_id)


def clear_current_request_id(token: Optional[contextvars.Token] = None) -> None:
    """Cleans up the context-local request ID using reset token if provided, or resets to default."""
    if token is not None:
        try:
            _correlation_id_ctx.reset(token)
            return
        except (ValueError, RuntimeError):
            pass
    _correlation_id_ctx.set('')


class CorrelationIdMiddleware:
    """
    Middleware that captures or generates a unique correlation request ID for every HTTP request.
    Injects request_id into contextvars storage for log formatters, attaches request.request_id,
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
        token = set_current_request_id(request_id)

        try:
            response = self.get_response(request)
        finally:
            clear_current_request_id(token)

        # Attach to outgoing response headers
        response['X-Request-ID'] = request_id
        return response
