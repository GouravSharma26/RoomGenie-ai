"""
RoomGenie AI — Structured Logging & Observability Framework (Phase 8.3).
Provides sanitized, correlation-tracked logging across application modules.
"""
import logging
import re
from typing import Any
from config.middleware import get_current_request_id

# Common patterns for credentials/tokens to redact from log output
SENSITIVE_PATTERNS = [
    (re.compile(r'([?&]?\bkey=)[^&\s,]+', re.IGNORECASE), r'\1[REDACTED]'),
    (re.compile(r'(x-goog-api-key["\']?\s*[:=]\s*["\']?)[^"\'\s,]+', re.IGNORECASE), r'\1[REDACTED]'),
    (re.compile(r'(Authorization["\']?\s*[:=]\s*["\']?(?:Token|Bearer)\s+)[^"\'\s,]+', re.IGNORECASE), r'\1[REDACTED]'),
    (re.compile(r'(password["\']?\s*[:=]\s*["\']?)[^"\'\s,]+(["\']?)', re.IGNORECASE), r'\1[REDACTED]\2'),
    (re.compile(r'(tsk_[A-Za-z0-9_]+)', re.IGNORECASE), r'[REDACTED_TRIPO_KEY]'),
]


def sanitize_log_message(msg: str) -> str:
    """Sanitizes sensitive tokens, API keys, passwords from log strings."""
    if not isinstance(msg, str):
        msg = str(msg)
    for pattern, replacement in SENSITIVE_PATTERNS:
        msg = pattern.sub(replacement, msg)
    return msg


class CorrelationIdFilter(logging.Filter):
    """
    Logging filter that injects the current request correlation ID into every LogRecord.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_current_request_id() or 'system'
        # Sanitize msg if it's a string
        if isinstance(record.msg, str):
            record.msg = sanitize_log_message(record.msg)
        return True


DEFAULT_LOG_FORMAT = '%(asctime)s [%(levelname)s] [req=%(request_id)s] [%(name)s]: %(message)s'


class StructuredLogFormatter(logging.Formatter):
    """
    Structured formatter including timestamp, log level, request_id, logger name, and message.
    """

    def __init__(self, fmt=None, datefmt=None, style='%', validate=True):
        fmt = fmt or DEFAULT_LOG_FORMAT
        super().__init__(fmt=fmt, datefmt=datefmt, style=style, validate=validate)

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, 'request_id'):
            record.request_id = get_current_request_id() or 'system'
        return super().format(record)
