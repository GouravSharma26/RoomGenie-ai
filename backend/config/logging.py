"""
RoomGenie AI — Structured Logging & Observability Framework (Phase 8.3 & 8.3.1).
Provides post-interpolation sanitized, correlation-tracked logging across application modules.
"""
import logging
import re
from typing import Any
from config.middleware import get_current_request_id

# Common patterns for credentials/tokens/PII to redact from log output
SENSITIVE_PATTERNS = [
    # Google API Key (AIza...)
    (re.compile(r'\bAIza[0-9A-Za-z\-_]{20,45}\b', re.IGNORECASE), '[REDACTED_GOOGLE_KEY]'),
    # OAuth Access / Refresh Tokens (ya29.*)
    (re.compile(r'\bya29\.[0-9A-Za-z\-_]+\b', re.IGNORECASE), '[REDACTED_OAUTH_TOKEN]'),
    # Tripo API keys (tsk_...)
    (re.compile(r'\btsk_[A-Za-z0-9_\-]+\b', re.IGNORECASE), '[REDACTED_TRIPO_KEY]'),
    # Authorization header tokens: Bearer or Token
    (re.compile(r'(Authorization["\']?\s*[:=]\s*["\']?(?:Token|Bearer)\s+)(?!\[REDACTED)[^"\'\s,]+', re.IGNORECASE), r'\1[REDACTED_TOKEN]'),
    (re.compile(r'(\b(?:Bearer|Token)\s+)(?!\[REDACTED)[A-Za-z0-9\-_.+/=~]{8,}', re.IGNORECASE), r'\1[REDACTED_TOKEN]'),
    # x-goog-api-key header
    (re.compile(r'(x-goog-api-key["\']?\s*[:=]\s*["\']?)(?!\[REDACTED)[^"\'\s,]+', re.IGNORECASE), r'\1[REDACTED]'),
    # URL parameters or assignments key=, api_key=, token=, secret=
    (re.compile(r'([?&]?\b(?:api[_-]?key|key|token|secret)\s*=\s*)(?!\[REDACTED)[^&\s,]+', re.IGNORECASE), r'\1[REDACTED]'),
    # Key-value / JSON pairs: password, secret, token, api_key
    (re.compile(r'(["\']?(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)["\']?\s*[:=]\s*["\']?)(?!\[REDACTED)[^"\'\s,}\]]+(["\']?)', re.IGNORECASE), r'\1[REDACTED]\2'),
    # Database URLs with passwords (e.g. postgresql://user:pass@host/db)
    (re.compile(r'(https?|postgres|postgresql|mysql)://([^:\s]+):([^@\s]+)@', re.IGNORECASE), r'\1://\2:[REDACTED]@'),
]


def sanitize_log_message(msg: Any) -> str:
    """Sanitizes sensitive tokens, API keys, passwords, and credentials from log strings."""
    if not isinstance(msg, str):
        msg = str(msg)
    for pattern, replacement in SENSITIVE_PATTERNS:
        msg = pattern.sub(replacement, msg)
    return msg


class CorrelationIdFilter(logging.Filter):
    """
    Logging filter that injects the current request correlation ID into every LogRecord.
    Also defensively sanitizes record.msg if it is a string without mutating record.args.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, 'request_id') or not record.request_id:
            record.request_id = get_current_request_id() or 'system'
        if isinstance(record.msg, str):
            record.msg = sanitize_log_message(record.msg)
        return True


DEFAULT_LOG_FORMAT = '%(asctime)s [%(levelname)s] [req=%(request_id)s] [%(name)s]: %(message)s'


class StructuredLogFormatter(logging.Formatter):
    """
    Structured formatter including timestamp, log level, request_id, logger name, and message.
    Ensures complete post-interpolation, traceback, and exception sanitization (Phase 8.3.1).
    """

    def __init__(self, fmt=None, datefmt=None, style='%', validate=True):
        fmt = fmt or DEFAULT_LOG_FORMAT
        super().__init__(fmt=fmt, datefmt=datefmt, style=style, validate=validate)

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, 'request_id') or not record.request_id:
            record.request_id = get_current_request_id() or 'system'

        try:
            rendered = super().format(record)
        except Exception as e:
            rendered = (
                f"{record.levelname} [{getattr(record, 'request_id', 'system')}] "
                f"{record.name}: [LOG_FORMAT_ERROR: {e}] {str(record.msg)}"
            )

        return sanitize_log_message(rendered)

    def formatException(self, ei) -> str:
        """Format an exception traceback and sanitize all sensitive data."""
        formatted = super().formatException(ei)
        return sanitize_log_message(formatted)

    def formatStack(self, stack_info) -> str:
        """Format a stack trace and sanitize all sensitive data."""
        formatted = super().formatStack(stack_info)
        return sanitize_log_message(formatted)
