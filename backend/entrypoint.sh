#!/bin/sh
set -e

echo "=== RoomGenie AI Production Entrypoint ==="

# Wait for PostgreSQL database if DATABASE_URL or DB_HOST is configured and not sqlite
if [ -n "$DATABASE_URL" ]; then
    echo "Waiting for PostgreSQL database from DATABASE_URL..."
    while ! python -c "import urllib.parse, socket, os; u = urllib.parse.urlparse(os.environ['DATABASE_URL']); s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(2); s.connect((u.hostname, u.port or 5432))" 2>/dev/null; do
        sleep 1
    done
    echo "Database is ready and accepting connections."
elif [ -n "$DB_HOST" ] && [ "$DB_ENGINE" != "django.db.backends.sqlite3" ]; then
    echo "Waiting for database on ${DB_HOST}:${DB_PORT:-5432}..."
    while ! python -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(2); s.connect(('${DB_HOST}', int('${DB_PORT:-5432}')))" 2>/dev/null; do
        sleep 1
    done
    echo "Database is ready and accepting connections."
fi

# Run database migrations
echo "Applying database migrations..."
python manage.py migrate --noinput

# Collect static files
echo "Collecting static assets..."
python manage.py collectstatic --noinput --clear

# Seed architectural furniture catalogue if not already populated
echo "Seeding architectural furniture catalogue..."
python manage.py seed_furniture

# Start Gunicorn production WSGI server
echo "Starting Gunicorn server on 0.0.0.0:8000..."
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-3}" \
    --threads "${GUNICORN_THREADS:-2}" \
    --timeout "${GUNICORN_TIMEOUT:-120}" \
    --access-logfile - \
    --error-logfile -
