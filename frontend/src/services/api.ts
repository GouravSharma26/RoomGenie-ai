export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  database: 'connected' | 'disconnected' | 'unknown';
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
  timestamp?: string;
  request_id?: string;
}
import { API_BASE_URL } from './apiConfig';

export async function checkBackendHealth(): Promise<HealthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/health/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
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

export * from './evaluationTelemetry';
