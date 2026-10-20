import http.client
import ipaddress
import json
import logging
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit
from django.conf import settings

from apps.furniture.reconstruction.base import BaseImageTo3DAdapter, ReconstructionResult
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError

logger = logging.getLogger(__name__)


def sanitize_sensitive_text(text: str, secret: str = '') -> str:
    """Strips API keys, bearer tokens, and sensitive query strings from messages."""
    sanitized = text
    if secret:
        sanitized = sanitized.replace(secret, "[REDACTED]")
    sanitized = re.sub(r'Bearer\s+[a-zA-Z0-9_\-\.]+', 'Bearer [REDACTED]', sanitized)
    sanitized = re.sub(r'(api[-_]?key|key|token|secret)\s*[:=]\s*[^\s,;]+', r'\1=[REDACTED]', sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r'https?://[^\s"]+', '[URL_REDACTED]', sanitized)
    return sanitized[:255]


def validate_and_resolve_download_url(
    model_url: str,
    allowed_hosts: list[str] | None = None,
    allow_private_ips: bool = False,
    check_dns: bool = True,
    pinned_ip_override: str | None = None
) -> tuple[str, str, str, int]:
    """
    Validates model download URLs against SSRF, unauthorized destinations, and non-HTTPS protocols,
    and resolves/pins the validated IP address to eliminate DNS TOCTOU / rebinding races.

    Returns:
        tuple of (validated_model_url, pinned_ip, server_hostname, port)
    """
    if not model_url or not isinstance(model_url, str):
        raise GLBValidationError("Model download URL must be a non-empty string.")

    try:
        parsed = urlsplit(model_url)
    except Exception as err:
        raise GLBValidationError(f"Invalid model download URL format: {err}") from err

    scheme = (parsed.scheme or '').lower()
    if scheme != 'https':
        raise GLBValidationError(
            f"Invalid model download URL scheme: '{parsed.scheme}'. Only HTTPS is permitted for 3D model downloads."
        )

    hostname = (parsed.hostname or '').lower().strip()
    if not hostname:
        raise GLBValidationError("Model download URL missing hostname.")

    if parsed.username or parsed.password:
        raise GLBValidationError("Model download URL contains disallowed user credentials.")

    port = parsed.port if parsed.port is not None else 443
    if port != 443:
        raise GLBValidationError(
            f"Disallowed port ({parsed.port}) in model download URL. Only standard HTTPS port 443 is permitted."
        )

    # 1. Check for localhost / loopback string names
    if hostname in ('localhost', 'localhost.localdomain'):
        raise GLBValidationError(f"Disallowed destination in model download URL: {hostname}")

    # 2. Check for IP literals and block private/loopback/link-local ranges
    ip_literal = None
    try:
        ip_literal = ipaddress.ip_address(hostname)
    except ValueError:
        # Hostname is a domain name, not an IP literal
        ip_literal = None

    if ip_literal is not None and not allow_private_ips:
        if (ip_literal.is_private or ip_literal.is_loopback or ip_literal.is_link_local or
            ip_literal.is_reserved or ip_literal.is_multicast or ip_literal.is_unspecified):
            raise GLBValidationError(
                f"Model download destination '{hostname}' is a disallowed private or local IP address."
            )

    # 3. Match against allowed hosts whitelist
    if allowed_hosts is None:
        configured = getattr(
            settings,
            'IMAGE_TO_3D_ALLOWED_HOSTS',
            ['tripo3d.ai', '.tripo3d.ai', 'amazonaws.com', '.amazonaws.com', 'cloudfront.net', '.cloudfront.net']
        )
        allowed_hosts = configured

    clean_allowed = [h.strip().lower() for h in allowed_hosts if h.strip()]
    matched = False
    for pattern in clean_allowed:
        if pattern.startswith('.'):
            # Suffix match, e.g. '.tripo3d.ai' matches 'tripo3d.ai' and 'api.tripo3d.ai'
            bare = pattern[1:]
            if hostname == bare or hostname.endswith(pattern):
                matched = True
                break
        else:
            # Exact or subdomain match, e.g. 'tripo3d.ai' matches 'tripo3d.ai' and 'api.tripo3d.ai'
            if hostname == pattern or hostname.endswith('.' + pattern):
                matched = True
                break

    if not matched:
        raise GLBValidationError(
            f"Model download host '{hostname}' is not in the allowed provider/CDN whitelist."
        )

    # 4. Resolve DNS and pin destination IP to eliminate TOCTOU / rebinding races
    if pinned_ip_override:
        # Validate override IP
        override_ip_obj = ipaddress.ip_address(pinned_ip_override)
        if not allow_private_ips and (
            override_ip_obj.is_private or override_ip_obj.is_loopback or override_ip_obj.is_link_local or
            override_ip_obj.is_reserved or override_ip_obj.is_multicast or override_ip_obj.is_unspecified
        ):
            raise GLBValidationError(
                f"Pinned IP override '{pinned_ip_override}' is a disallowed private or local address."
            )
        pinned_ip = pinned_ip_override
    elif ip_literal is not None:
        pinned_ip = str(ip_literal)
    elif check_dns and not allow_private_ips:
        try:
            addr_entries = socket.getaddrinfo(hostname, port, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM)
            if not addr_entries:
                raise GLBValidationError(f"Failed to resolve hostname '{hostname}' for model download.")
            validated_ips: list[str] = []
            for entry in addr_entries:
                resolved_ip_str = entry[4][0]
                resolved_ip = ipaddress.ip_address(resolved_ip_str)
                if (resolved_ip.is_private or resolved_ip.is_loopback or resolved_ip.is_link_local or
                    resolved_ip.is_reserved or resolved_ip.is_multicast or resolved_ip.is_unspecified):
                    raise GLBValidationError(
                        f"Model download destination '{hostname}' resolved to disallowed local/private address ({resolved_ip_str})."
                    )
                validated_ips.append(resolved_ip_str)
            # Pin the first validated safe public IP
            pinned_ip = validated_ips[0]
        except socket.gaierror as e:
            raise GLBValidationError(f"DNS resolution failed for model download host '{hostname}': {e}") from e
    else:
        # Fallback when DNS check is explicitly disabled (e.g. mock test environment)
        pinned_ip = hostname

    return model_url, pinned_ip, hostname, port


def validate_download_url(
    model_url: str,
    allowed_hosts: list[str] | None = None,
    allow_private_ips: bool = False,
    check_dns: bool = True
) -> str:
    """Helper that validates download URL and returns validated URL string."""
    validated_url, _, _, _ = validate_and_resolve_download_url(
        model_url,
        allowed_hosts=allowed_hosts,
        allow_private_ips=allow_private_ips,
        check_dns=check_dns
    )
    return validated_url


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """
    Subclass of HTTPRedirectHandler that intercepts 301/302/303/307 redirects and verifies
    the new target destination against the strict URL security policy before making any network request.
    Prevents SSRF redirection to localhost, cloud metadata services, and internal network IP ranges.
    """
    def __init__(
        self,
        allowed_hosts: list[str] | None = None,
        max_redirects: int = 3,
        check_dns: bool = True
    ):
        super().__init__()
        self.allowed_hosts = allowed_hosts
        self.max_redirects = max_redirects
        self.check_dns = check_dns
        self.redirect_count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.redirect_count += 1
        if self.redirect_count > self.max_redirects:
            raise GLBValidationError(
                f"Too many redirects ({self.redirect_count}) while downloading model (max allowed: {self.max_redirects})."
            )

        # Validate target redirect URL before sending any request
        validate_and_resolve_download_url(newurl, allowed_hosts=self.allowed_hosts, check_dns=self.check_dns)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class SafeHTTPSHandler(urllib.request.HTTPSHandler):
    """
    HTTPSHandler that enforces IP pinning on socket creation while preserving
    TLS Server Name Indication (SNI) and certificate validation for the original hostname.
    Eliminates DNS TOCTOU (Time-of-Check to Time-of-Use) rebinding attacks.
    """
    def __init__(
        self,
        allowed_hosts: list[str] | None = None,
        context: ssl.SSLContext | None = None,
        check_dns: bool = True,
        pinned_ip_override: str | None = None
    ):
        super().__init__(context=context)
        self.allowed_hosts = allowed_hosts
        self.check_dns = check_dns
        self.pinned_ip_override = pinned_ip_override

    def https_open(self, req):
        if not hasattr(req, 'timeout'):
            req.timeout = socket._GLOBAL_DEFAULT_TIMEOUT
        url = req.get_full_url()
        _, pinned_ip, server_hostname, port = validate_and_resolve_download_url(
            url,
            allowed_hosts=self.allowed_hosts,
            check_dns=self.check_dns,
            pinned_ip_override=self.pinned_ip_override
        )

        class PinnedConnection(http.client.HTTPSConnection):
            def connect(conn_self):
                # Connect raw socket directly to the validated pinned IP.
                # No second DNS resolution can occur.
                conn_self.sock = conn_self._create_connection(
                    (pinned_ip, port), conn_self.timeout, conn_self.source_address
                )
                try:
                    conn_self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                except OSError:
                    pass

                if conn_self._tunnel_host:
                    conn_self._tunnel()
                    sni_name = conn_self._tunnel_host
                else:
                    sni_name = server_hostname

                # Wrap with TLS verifying certificate matches server_hostname and sending SNI
                conn_self.sock = conn_self._context.wrap_socket(
                    conn_self.sock,
                    server_hostname=sni_name
                )

        return self.do_open(PinnedConnection, req, context=self._context)


def stream_download_model(
    model_url: str,
    max_size_bytes: int = 15 * 1024 * 1024,
    chunk_size: int = 64 * 1024,
    timeout: float = 30.0,
    allowed_hosts: list[str] | None = None,
    check_dns: bool = True,
    pinned_ip_override: str | None = None
) -> bytes:
    """
    Streams a 3D model from a remote URL in chunks.
    1. Validates the URL against HTTPS, allowed CDN/provider domains, and SSRF restrictions.
    2. Uses SafeHTTPSHandler to pin the connection to the validated IP, preventing DNS TOCTOU rebinding.
    3. Builds an opener with SafeRedirectHandler to validate all redirect targets.
    4. Enforces maximum size bounds during streaming without reading the entire payload into memory.
    5. Treats Content-Length as advisory and immediately terminates/closes the response if exceeded.
    """
    # Pre-validate destination before opening connection
    validate_and_resolve_download_url(
        model_url,
        allowed_hosts=allowed_hosts,
        check_dns=check_dns,
        pinned_ip_override=pinned_ip_override
    )

    req = urllib.request.Request(
        model_url,
        headers={"User-Agent": "RoomGenie-AI/1.0"}
    )
    redirect_handler = SafeRedirectHandler(allowed_hosts=allowed_hosts, check_dns=check_dns)
    https_handler = SafeHTTPSHandler(
        allowed_hosts=allowed_hosts,
        check_dns=check_dns,
        pinned_ip_override=pinned_ip_override
    )
    opener = urllib.request.build_opener(redirect_handler, https_handler)
    resp = opener.open(req, timeout=timeout)
    try:
        # 1. Advisory Content-Length header check
        content_length_header = None
        if hasattr(resp, 'headers') and hasattr(resp.headers, 'get'):
            content_length_header = resp.headers.get('Content-Length')
        elif hasattr(resp, 'getheader'):
            content_length_header = resp.getheader('Content-Length')

        if content_length_header is not None:
            declared_len = None
            try:
                declared_len = int(content_length_header)
            except (ValueError, TypeError):
                declared_len = None

            if declared_len is not None and declared_len > max_size_bytes:
                raise GLBValidationError(
                    f"Model Content-Length header ({declared_len} bytes) exceeds maximum allowed limit of {max_size_bytes} bytes."
                )

        # 2. Stream chunk-by-chunk and strictly enforce byte bounds
        chunks = bytearray()
        while True:
            chunk = resp.read(chunk_size)
            if not chunk or not isinstance(chunk, (bytes, bytearray)):
                break
            chunks.extend(chunk)
            if len(chunks) > max_size_bytes:
                raise GLBValidationError(
                    f"Model download exceeded maximum allowed limit of {max_size_bytes} bytes during streaming (received {len(chunks)} bytes)."
                )
        return bytes(chunks)
    finally:
        resp.close()


class TripoImageTo3DAdapter(BaseImageTo3DAdapter):
    """
    Image-to-3D adapter for Tripo API (model v3.1-20260211).
    External paid AI requests are STRICTLY gated by:
    1. IMAGE_TO_3D_ALLOW_PAID_REQUESTS=True in settings
    2. Valid TRIPO_API_KEY (non-empty, non-placeholder)
    
    If either is missing, falls back deterministically to MockImageTo3DAdapter,
    ensuring zero accidental external credit consumption during tests or development.
    """

    BASE_URL = "https://api.tripo3d.ai/v2/openapi"

    def __init__(
        self,
        api_key: str | None = None,
        model_name: str | None = None,
        allow_paid: bool | None = None
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, 'TRIPO_API_KEY', '')
        self.model_name = model_name or getattr(settings, 'TRIPO_MODEL', 'v3.1-20260211')
        if allow_paid is not None:
            self.allow_paid = allow_paid
        else:
            self.allow_paid = getattr(settings, 'IMAGE_TO_3D_ALLOW_PAID_REQUESTS', False)
        self.mock_fallback = MockImageTo3DAdapter()

    def generate_furniture_model(
        self,
        image_path: str,
        category: str = 'seating',
        prompt_label: str = '',
        reference_dimensions: dict[str, float] | None = None,
        context: dict[str, Any] | None = None
    ) -> ReconstructionResult:
        start_time = time.time()
        context = context or {}

        # 1. Require explicit paid provider authorization
        if not self.allow_paid:
            logger.info("Tripo paid requests disabled by policy; falling back to mock provider.")
            result = self.mock_fallback.generate_furniture_model(
                image_path=image_path,
                category=category,
                prompt_label=prompt_label,
                reference_dimensions=reference_dimensions,
                context=context
            )
            result.provider = 'mock'
            result.raw_metadata['fallback_used'] = True
            result.raw_metadata['fallback_reason'] = 'paid_requests_not_authorized'
            return result

        # 2. Check for configured live API key
        if not self.api_key or self.api_key.startswith('tsk_placeholder'):
            logger.info("Tripo API key unconfigured; falling back to mock provider.")
            result = self.mock_fallback.generate_furniture_model(
                image_path=image_path,
                category=category,
                prompt_label=prompt_label,
                reference_dimensions=reference_dimensions,
                context=context
            )
            result.provider = 'mock'
            result.raw_metadata['fallback_used'] = True
            result.raw_metadata['fallback_reason'] = 'tripo_api_key_not_configured'
            return result

        # 3. Live Tripo integration
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "RoomGenie-AI/1.0"
        }

        try:
            # Step A: Initiate Task
            create_payload = {
                "type": "image_to_model",
                "model_version": self.model_name,
                "file": {
                    "type": "jpg",
                    "file_token": context.get("file_token", "")
                }
            }

            req = urllib.request.Request(
                f"{self.BASE_URL}/task",
                data=json.dumps(create_payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )

            # Enforce 15-second network timeout on task creation
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                task_data = json.loads(resp.read().decode('utf-8'))

            if task_data.get('code') != 0 or 'data' not in task_data:
                raise RuntimeError(f"Tripo task initiation failed: {task_data.get('message', 'Unknown error')}")

            task_id = task_data['data']['task_id']

            # Step B: Poll task status with hard timeout (max 60 seconds)
            poll_timeout = float(getattr(settings, 'IMAGE_TO_3D_TIMEOUT_SECONDS', 60))
            poll_start = time.time()
            model_url = None

            while time.time() - poll_start < poll_timeout:
                poll_req = urllib.request.Request(
                    f"{self.BASE_URL}/task/{task_id}",
                    headers=headers,
                    method='GET'
                )
                with urllib.request.urlopen(poll_req, timeout=15.0) as poll_resp:
                    status_data = json.loads(poll_resp.read().decode('utf-8'))

                t_status = status_data.get('data', {}).get('status')
                if t_status == 'success':
                    model_url = status_data['data'].get('output', {}).get('model')
                    break
                elif t_status in ('failed', 'cancelled'):
                    raise RuntimeError(f"Tripo task {task_id} failed with status: {t_status}")

                time.sleep(2.0)

            if not model_url:
                raise TimeoutError(f"Tripo 3D model reconstruction timed out after {poll_timeout:.0f} seconds.")

            # Step C: Stream output model download with bounded byte limits
            max_size = int(getattr(settings, 'IMAGE_TO_3D_MAX_OUTPUT_SIZE', 15 * 1024 * 1024))
            raw_glb_bytes = stream_download_model(model_url, max_size_bytes=max_size, timeout=30.0)

            # Step D: Strict glTF 2.0 Binary validation
            validation = GLBValidator.validate(raw_glb_bytes, max_size_bytes=max_size)

            latency = int((time.time() - start_time) * 1000)
            dims = validation.get('approximate_dimensions') or reference_dimensions or {'width_m': 1.0, 'height_m': 1.0, 'depth_m': 1.0}

            return ReconstructionResult(
                model_bytes=raw_glb_bytes,
                format='glb',
                approximate_dimensions=dims,
                provider='tripo',
                model_name=self.model_name,
                latency_ms=latency,
                suggested_catalogue_fallback_id=self.mock_fallback.CATALOGUE_FALLBACKS.get(category, 'sofa-modern-3seater'),
                raw_metadata={'task_id': task_id, 'model_version': self.model_name}
            )

        except Exception as exc:
            # Redact secrets, auth tokens, and sensitive URLs
            safe_err = sanitize_sensitive_text(str(exc), secret=self.api_key)
            logger.warning("Tripo reconstruction failed, falling back to mock: %s", safe_err)

            fallback_res = self.mock_fallback.generate_furniture_model(
                image_path=image_path,
                category=category,
                prompt_label=prompt_label,
                reference_dimensions=reference_dimensions,
                context=context
            )
            fallback_res.provider = 'mock'
            fallback_res.raw_metadata['fallback_used'] = True
            fallback_res.raw_metadata['fallback_reason'] = f"tripo_error: {safe_err[:120]}"
            return fallback_res
