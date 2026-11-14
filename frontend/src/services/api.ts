export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  database: 'connected' | 'disconnected' | 'unknown';
  timestamp?: string;
  request_id?: string;
  // Optional operational diagnostics populated exclusively for authenticated staff
  db_latency_ms?: number;
  db_engine?: string;
  uptime_seconds?: number;
  migrations_synced?: boolean;
  unapplied_migrations_count?: number;
  ai_provider_mode?: string;
  has_gemini_key?: boolean;
  gemini_model?: string;
  gemini_fallback_models?: string[];
  gemini_ready?: boolean;
}

import { API_BASE_URL } from './apiConfig';
import { getAuthToken } from './designApi';

export async function checkBackendHealth(): Promise<HealthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/health/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // 503 from backend when DB is disconnected
      try {
        const errorData = await response.json();
        if (errorData && typeof errorData === 'object') {
          return errorData as HealthResponse;
        }
      } catch {
        // Fallback below
      }
      throw new Error(`Health check returned status HTTP ${response.status}`);
    }

    return await response.json();
  } catch {
    return {
      status: 'unreachable',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'disconnected',
    };
  }
}

export async function fetchHealthDiagnostics(): Promise<Partial<HealthResponse> | null> {
  const token = getAuthToken();
  if (!token) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/health/diagnostics/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Token ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

export * from './evaluationTelemetry';
