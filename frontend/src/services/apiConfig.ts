/**
 * Authoritative base URL resolver for backend REST API requests.
 * In production builds (or when served by Nginx reverse proxy), defaults to empty string "" (same-origin relative URL).
 * In development mode (Vite dev server), defaults to "http://localhost:8000" unless overridden by VITE_API_URL.
 */
export function getApiBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    if (typeof import.meta.env.VITE_API_URL === 'string') {
      return import.meta.env.VITE_API_URL;
    }
    if (import.meta.env.PROD) {
      return '';
    }
  }
  return 'http://localhost:8000';
}

export const API_BASE_URL = getApiBaseUrl();
