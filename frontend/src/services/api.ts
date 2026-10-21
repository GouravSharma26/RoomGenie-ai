export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  database: 'connected' | 'disconnected' | 'unknown';
  timestamp?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
