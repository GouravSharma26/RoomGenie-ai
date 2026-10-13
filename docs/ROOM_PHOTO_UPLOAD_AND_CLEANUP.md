# RoomGenie AI — Room Photo Upload Security & Ephemeral Cleanup Guide

This document details the security architecture, resource-protection layers, orphaned-file prevention, and automated cleanup mechanisms implemented for RoomGenie AI room-photo uploads (`POST /api/v1/rooms/upload-photo/`).

---

## 1. Multi-Layer Request-Body Size & Resource Protection

Processing multi-megabyte image uploads requires defense-in-depth across the infrastructure stack. No single layer can protect both the application process and upstream network bandwidth.

```
+---------------------------------------------------------------------------------------+
| LAYER 1: Reverse Proxy / Ingress (Nginx, Caddy, AWS ALB, Cloudflare)                  |
| - Inspects HTTP headers and streams before backend connection.                        |
| - Closes TCP connection immediately on oversized payload (prevents bandwidth abuse).  |
+---------------------------------------------------------------------------------------+
                                        │
                                        ▼
+---------------------------------------------------------------------------------------+
| LAYER 2: Early Django Header Check (RoomPhotoUploadView.post)                         |
| - Inspects CONTENT_LENGTH before DRF parses multipart streams or buffers bytes.        |
| - Returns HTTP 413 Request Entity Too Large immediately.                              |
+---------------------------------------------------------------------------------------+
                                        │
                                        ▼
+---------------------------------------------------------------------------------------+
| LAYER 3: Django Upload Handlers & Core Settings                                       |
| - DATA_UPLOAD_MAX_MEMORY_SIZE (12MB): Prevents excessive memory exhaustion in parser.  |
| - FILE_UPLOAD_MAX_MEMORY_SIZE (10MB): Caps in-memory buffers before temporary disk.   |
| - ROOM_PHOTO_MAX_UPLOAD_SIZE (10MB): Enforced in serializer file validation.          |
+---------------------------------------------------------------------------------------+
```

### 1.1 Reverse Proxy Configuration (Deployment Layer)

The reverse proxy MUST be configured in production to drop oversized bodies before they reach Gunicorn/Django worker processes.

#### Nginx
In `/etc/nginx/conf.d/roomgenie.conf` or the relevant `server`/`location` block:
```nginx
server {
    server_name api.roomgenie.local;

    # Allow 12MB body (10MB photo + multipart envelope & metadata overhead)
    client_max_body_size 12M;

    location /api/v1/rooms/upload-photo/ {
        client_max_body_size 12M;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddy
```caddy
api.roomgenie.local {
    request_body {
        max_size 12MB
    }
    reverse_proxy localhost:8000
}
```

#### AWS Application Load Balancer / Cloudflare
- **AWS ALB**: Enforce default 10MB/12MB HTTP body limits and attach AWS WAF body inspection rules.
- **Cloudflare**: Standard Free/Pro plan limits max body to 100MB; set custom WAF Rule on `/api/v1/rooms/upload-photo/` to reject requests where `http.request.body.size > 12582912` with HTTP 413.

### 1.2 Django Protections Configured in Application Code

The application enforces the following protections in `backend/config/settings.py` and `apps/rooms/views.py`:

| Setting / Check | Configured Value | Purpose |
| :--- | :--- | :--- |
| `ROOM_PHOTO_MAX_UPLOAD_SIZE` | `10 * 1024 * 1024` (10MB) | Application-level upload ceiling for room photos. |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | `12 * 1024 * 1024` (12MB) | Rejects request bodies before Django parses malformed or huge payloads into memory. |
| `FILE_UPLOAD_MAX_MEMORY_SIZE` | `10 * 1024 * 1024` (10MB) | Restricts in-memory uploaded file chunks before spooling. |
| `Early CONTENT_LENGTH Check` | `max_upload_size + 65536` | `RoomPhotoUploadView.post()` reads header immediately and returns HTTP 413 before DRF reads multipart data. |

---

## 2. Image Validation, Pixel Limits, and Decompression Bomb Protection

To prevent image-based Denial of Service (Decompression Bomb attacks) where a tiny compressed file (e.g. 500KB) decompresses into tens of gigabytes in RAM, the validation pipeline enforces strict raster constraints.

### 2.1 Enforced Constraints
1. **Magic Bytes Verification**: Header bytes validated against JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), and WebP (`52 49 46 46...57 45 42 50`). Client-supplied file extensions and MIME headers are ignored.
2. **Dimension Constraints**:
   - Minimum resolution: 100x100px (rejects thumbnail or empty placeholders).
   - Maximum resolution: 8192x8192px (`ROOM_PHOTO_MAX_DIMENSION`).
3. **Total Pixel Limit**:
   - `ROOM_PHOTO_MAX_PIXELS = 25,000,000` (configurable via environment variable).
   - Pillow's internal `Image.MAX_IMAGE_PIXELS` is synchronized to this limit.
   - An explicit check `total_pixels = width * height <= ROOM_PHOTO_MAX_PIXELS` is enforced.
4. **Pillow Decompression Bomb Escalation**:
   - Wrapped under `warnings.catch_warnings()` with `warnings.filterwarnings("error", category=Image.DecompressionBombWarning)`.
   - Both `Image.DecompressionBombWarning` and `Image.DecompressionBombError` are caught and converted into a rejected upload (HTTP 400 Bad Request) with clear error details.

---

## 3. Orphaned File Prevention Guarantee

When handling uploads, network interruptions, database constraints, disk quotas, or unhandled runtime exceptions can leave leftover files on the local filesystem.

In `apps.rooms.services.save_temporary_room_photo`:
```python
file_created = False
try:
    with open(dest_path, 'wb') as dest_file:
        for chunk in uploaded_file.chunks():
            dest_file.write(chunk)
    file_created = True

    with transaction.atomic():
        record = RoomPhotoUpload.objects.create(...)
        return record
except Exception:
    if file_created or dest_path.exists():
        try:
            if dest_path.is_file():
                dest_path.unlink()
        except OSError as cleanup_err:
            logger.warning(f"Failed to remove orphaned file {dest_path}: {cleanup_err}")
    raise
```

**Guarantees**:
- If chunk streaming fails midway on disk, partial files are unlinked.
- If the database transaction fails (e.g., deadlock, foreign key error, connection drop), `dest_path.unlink()` executes before raising the error.
- Verified in automated tests via `test_failed_database_operation_leaves_no_orphaned_file` and `test_failed_disk_write_leaves_no_orphaned_file`.

---

## 4. Ephemeral Storage & Automatic Cleanup

Uploaded room photos are strictly ephemeral: they are saved with an expiration timestamp (`expires_at = now + 3600s`) in a user-isolated folder (`media/temp_room_photos/<user_id>/<uuid>.<ext>`).

### 4.1 Django Management Command

Run cleanup via:
```bash
python manage.py cleanup_expired_photos [--dry-run] [--max-age-seconds=N]
```

#### Options:
- `--dry-run`: Scans for expired photos and reports statistics without unlinking files from disk or mutating database records.
- `--max-age-seconds`: Overrides the default TTL logic and purges photos created more than `N` seconds ago (e.g. `--max-age-seconds=86400` for 24-hour cleanup).

#### Fault-Tolerant Behavior:
- Catches `OSError` (e.g., file in use, permission locked) per-file so a single stuck file does not abort cleanup for remaining photos.
- If unlinking fails on disk, the database record is **NOT** marked deleted, ensuring the next scheduled run retries cleanup.
- If a file is already gone from disk, the database record is cleanly marked `is_deleted=True` and accounted for under `missing_count`.
- Emits structured output: `scanned=N, purged=N, missing=N, failed=N`.

### 4.2 Documented Scheduling Mechanisms

In production, run `cleanup_expired_photos` on a recurring schedule using one of the following mechanisms:

#### Option A: Linux Crontab (Recommended for standard VM / EC2 deployments)
Run every 15 minutes:
```cron
# /etc/cron.d/roomgenie-photo-cleanup
*/15 * * * * roomgenie /path/to/venv/bin/python /path/to/roomgenie-ai/backend/manage.py cleanup_expired_photos >> /var/log/roomgenie/photo_cleanup.log 2>&1
```

#### Option B: Systemd Timer (Modern Linux)
1. Service unit `/etc/systemd/system/roomgenie-photo-cleanup.service`:
```ini
[Unit]
Description=RoomGenie AI Expired Photo Cleanup
After=network.target postgresql.service

[Service]
Type=oneshot
User=roomgenie
WorkingDirectory=/var/www/roomgenie/backend
ExecStart=/var/www/roomgenie/venv/bin/python manage.py cleanup_expired_photos
StandardOutput=journal
StandardError=journal
```

2. Timer unit `/etc/systemd/system/roomgenie-photo-cleanup.timer`:
```ini
[Unit]
Description=Run RoomGenie Photo Cleanup Every 15 Minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Unit=roomgenie-photo-cleanup.service

[Install]
WantedBy=timers.target
```
Enable with: `systemctl enable --now roomgenie-photo-cleanup.timer`.

#### Option C: Celery Beat (If Celery is configured in deployment)
In Celery schedule configuration:
```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    'cleanup-expired-room-photos-every-15-mins': {
        'task': 'apps.rooms.tasks.cleanup_expired_photos_task',
        'schedule': crontab(minute='*/15'),
    },
}
```

#### Option D: Kubernetes CronJob (Containerized Deployments)
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: roomgenie-photo-cleanup
spec:
  schedule: "*/15 * * * *"
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: photo-cleanup
            image: roomgenie-backend:latest
            command: ["python", "manage.py", "cleanup_expired_photos"]
            envFrom:
            - secretRef:
                name: roomgenie-secrets
            volumeMounts:
            - name: media-storage
              mountPath: /app/media
```

#### Option E: Windows Task Scheduler (Local Development on Windows)
```powershell
$Action = New-ScheduledTaskAction -Execute "python.exe" -Argument "manage.py cleanup_expired_photos" -WorkingDirectory "C:\Gourav Sharma\VR Project\roomgenie-ai\backend"
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "RoomGeniePhotoCleanup" -Action $Action -Trigger $Trigger -Description "Purges expired room photos every 15 minutes."
```

---

## 5. Automated Regression Test Suite

All four security and reliability requirements are covered by automated tests in `backend/apps/rooms/tests.py`:

| Test Name | Coverage |
| :--- | :--- |
| `test_cleanup_management_command_execution_and_dry_run` | Verifies `--dry-run` vs live execution of `cleanup_expired_photos`. |
| `test_cleanup_handles_unlink_failures_safely` | Verifies disk unlinking `OSError` is handled gracefully without crashing, preserving record for retry. |
| `test_cleanup_handles_already_missing_disk_files_gracefully` | Verifies photos missing from disk are marked deleted and counted under `missing`. |
| `test_early_content_length_rejection_413` | Verifies early `CONTENT_LENGTH` rejection returns HTTP 413 without spooling file. |
| `test_max_total_pixels_limit_rejected_400` | Verifies rejection when total pixels exceed `ROOM_PHOTO_MAX_PIXELS`. |
| `test_pillow_decompression_bomb_warning_and_error_rejected` | Verifies both `DecompressionBombWarning` and `DecompressionBombError` return HTTP 400. |
| `test_failed_database_operation_leaves_no_orphaned_file` | Verifies disk file is deleted if DB transaction raises `DatabaseError`. |
| `test_failed_disk_write_leaves_no_orphaned_file` | Verifies partial disk writes are deleted if streaming raises `IOError`. |
| `test_unauthenticated_upload_rejected_401` | Preserves existing authentication enforcement. |
| `test_upload_with_cross_user_room_id_rejected` | Preserves room ownership validation across users. |
| `test_unsupported_format_gif_rejected` | Preserves format whitelist enforcement. |
| `test_spoofed_extension_with_html_or_script_rejected` | Preserves real binary content validation. |
| `test_malformed_corrupted_image_rejected` | Preserves corrupted image detection. |
