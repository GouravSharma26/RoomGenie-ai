"""
Django settings for RoomGenie AI backend.
"""
from pathlib import Path
import os
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from .env file (check repo root then backend dir)
REPO_ROOT = BASE_DIR.parent
if (REPO_ROOT / '.env').exists():
    load_dotenv(REPO_ROOT / '.env')
elif (BASE_DIR / '.env').exists():
    load_dotenv(BASE_DIR / '.env')
else:
    load_dotenv()

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv(
    'DJANGO_SECRET_KEY',
    'django-insecure-default-roomgenie-dev-key-change-in-production'
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.getenv('DJANGO_DEBUG', 'True').strip().lower() in ('true', '1', 'yes')

# Demo authentication gating (Strict development-only setting; strictly disabled in production)
ALLOW_DEMO_AUTH = DEBUG and os.getenv('ALLOW_DEMO_AUTH', 'True').strip().lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = [
    host.strip() 
    for host in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') 
    if host.strip()
]
if DEBUG:
    ALLOWED_HOSTS = list(set(ALLOWED_HOSTS + ['*']))

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party apps
    'corsheaders',
    'rest_framework',
    'rest_framework.authtoken',
    # RoomGenie modular monolith apps
    'apps.accounts',
    'apps.rooms',
    'apps.furniture',
    'apps.designs',
    'apps.ai_agent',
    'apps.evaluation',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
]
try:
    import whitenoise  # noqa: F401
    MIDDLEWARE.append('whitenoise.middleware.WhiteNoiseMiddleware')
except ImportError:
    pass

MIDDLEWARE.extend([
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
])

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Database configuration (PostgreSQL baseline)
DB_ENGINE = os.getenv('DB_ENGINE', 'django.db.backends.postgresql')
DB_NAME = os.getenv('DB_NAME', 'roomgenie_db')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', 'postgres')
DB_HOST = os.getenv('DB_HOST', '127.0.0.1')
DB_PORT = os.getenv('DB_PORT', '5432')

DATABASE_URL = os.getenv('DATABASE_URL')
if DATABASE_URL:
    import urllib.parse
    url = urllib.parse.urlparse(DATABASE_URL)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': url.path.lstrip('/'),
            'USER': urllib.parse.unquote(url.username or ''),
            'PASSWORD': urllib.parse.unquote(url.password or ''),
            'HOST': url.hostname or '',
            'PORT': str(url.port or '5432'),
        }
    }
    DB_PASSWORD = DATABASES['default']['PASSWORD']
elif DB_ENGINE == 'django.db.backends.sqlite3':
    sqlite_name = os.getenv('DB_NAME', 'db.sqlite3')
    if not sqlite_name.endswith('.sqlite3') and not sqlite_name.endswith('.db'):
        sqlite_name = f"{sqlite_name}.sqlite3"
    DATABASES = {
        'default': {
            'ENGINE': DB_ENGINE,
            'NAME': BASE_DIR / sqlite_name,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': DB_ENGINE,
            'NAME': DB_NAME,
            'USER': DB_USER,
            'PASSWORD': DB_PASSWORD,
            'HOST': DB_HOST,
            'PORT': DB_PORT,
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Media files (Local private media for development)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Django REST Framework default configuration
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}

# Production safety validations (ensure dev defaults cannot silently run in production)
if not DEBUG:
    INSECURE_KEYS = {
        'django-insecure-default-roomgenie-dev-key-change-in-production',
        'django-insecure-change-me-in-production-roomgenie-local-dev-key',
        'roomgenie-production-secret-key-change-me',
        'change-this-to-a-very-long-and-secure-random-string-in-prod',
        '',
    }
    if SECRET_KEY in INSECURE_KEYS or len(SECRET_KEY) < 32:
        raise ValueError("DJANGO_SECRET_KEY must be securely configured (at least 32 characters, non-default) when DJANGO_DEBUG=False.")

    WEAK_PASSWORDS = {'postgres', 'roomgenie_secure_pass', 'password', 'admin', 'root', ''}
    if DB_PASSWORD in WEAK_PASSWORDS or len(DB_PASSWORD) < 8:
        raise ValueError("DB_PASSWORD must be explicitly configured with a strong, non-default password (at least 8 characters) when DJANGO_DEBUG=False.")

# CORS Configuration
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        'CORS_ALLOWED_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173'
    ).split(',')
    if origin.strip()
]
if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True

# AI and Model Provider Baseline Settings
AI_PROVIDER_MODE = os.getenv('AI_PROVIDER_MODE', 'mock').lower()
ROOM_VISION_PROVIDER_MODE = os.getenv('ROOM_VISION_PROVIDER_MODE', 'mock').lower()
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')

IMAGE_TO_3D_PROVIDER_MODE = os.getenv('IMAGE_TO_3D_PROVIDER_MODE', 'mock').lower()
TRIPO_API_KEY = os.getenv('TRIPO_API_KEY', '')
TRIPO_MODEL = os.getenv('TRIPO_MODEL', 'v3.1-20260211')
IMAGE_TO_3D_ALLOW_PAID_REQUESTS = os.getenv('IMAGE_TO_3D_ALLOW_PAID_REQUESTS', 'false').lower() in ('true', '1', 'yes')
IMAGE_TO_3D_MAX_OUTPUT_SIZE = int(os.getenv('IMAGE_TO_3D_MAX_OUTPUT_SIZE', str(15 * 1024 * 1024)))  # 15 MB default
IMAGE_TO_3D_TIMEOUT_SECONDS = int(os.getenv('IMAGE_TO_3D_TIMEOUT_SECONDS', '60'))
IMAGE_TO_3D_ALLOWED_HOSTS = [
    h.strip().lower()
    for h in os.getenv(
        'IMAGE_TO_3D_ALLOWED_HOSTS',
        'tripo3d.ai,.tripo3d.ai,amazonaws.com,.amazonaws.com,cloudfront.net,.cloudfront.net'
    ).split(',')
    if h.strip()
]

# Media and Ephemeral Upload Storage
MEDIA_ROOT = os.getenv('MEDIA_ROOT', str(BASE_DIR / 'media'))
MEDIA_URL = '/media/'

# Room Photo Upload Security Limits
ROOM_PHOTO_MAX_UPLOAD_SIZE = int(os.getenv('ROOM_PHOTO_MAX_UPLOAD_SIZE', str(10 * 1024 * 1024)))  # 10 MB default
ROOM_PHOTO_MIN_DIMENSION = int(os.getenv('ROOM_PHOTO_MIN_DIMENSION', '100'))  # 100px minimum width/height
ROOM_PHOTO_MAX_DIMENSION = int(os.getenv('ROOM_PHOTO_MAX_DIMENSION', '8192'))  # 8192px maximum width/height
ROOM_PHOTO_MAX_PIXELS = int(os.getenv('ROOM_PHOTO_MAX_PIXELS', '25000000'))  # 25 MP default (e.g. 5000x5000)
ROOM_PHOTO_ALLOWED_FORMATS = ('JPEG', 'PNG', 'WEBP')
ROOM_PHOTO_ALLOWED_MIME_TYPES = ('image/jpeg', 'image/png', 'image/webp')
ROOM_PHOTO_EXPIRY_SECONDS = int(os.getenv('ROOM_PHOTO_EXPIRY_SECONDS', '3600'))  # 1 hour ephemeral retention

# Request body and upload memory limits before consuming excessive resources
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv('DATA_UPLOAD_MAX_MEMORY_SIZE', str(12 * 1024 * 1024)))  # 12 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv('FILE_UPLOAD_MAX_MEMORY_SIZE', str(10 * 1024 * 1024)))  # 10 MB

# Evaluation Telemetry Persistence Settings (Phase 8)
# Evaluation logging is strictly disabled by default and enabled explicitly in study environment.
ENABLE_EVALUATION_TELEMETRY = os.getenv('ENABLE_EVALUATION_TELEMETRY', 'False').lower() in ('true', '1', 'yes')

