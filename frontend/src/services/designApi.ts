import type { CanonicalScene } from '../types/scene';

export interface DesignRecord {
  id: string;
  owner_username: string;
  room_id: string | null;
  title: string;
  description: string;
  budget: number | null;
  style_preferences: string[];
  scene_json: CanonicalScene;
  object_count: number;
  created_at: string;
  updated_at: string;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const TOKEN_KEY = 'roomgenie_auth_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function ensureAuthenticated(): Promise<string> {
  const existing = getAuthToken();
  if (existing) return existing;

  // Seamlessly provision local development/demo engineer account
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/demo/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Authentication initialization failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  setAuthToken(data.token);
  return data.token;
}

function getAuthHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Token ${token}`,
  };
}

export async function listSavedDesigns(): Promise<DesignRecord[]> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/designs/`, {
    method: 'GET',
    headers: getAuthHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to load designs list: HTTP ${res.status}`);
  }

  return await res.json();
}

export async function getDesignById(id: string): Promise<DesignRecord> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/designs/${id}/`, {
    method: 'GET',
    headers: getAuthHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to retrieve design ${id}: HTTP ${res.status}`);
  }

  return await res.json();
}

export async function saveDesignToBackend(
  title: string,
  scene: CanonicalScene,
  existingId?: string | null
): Promise<DesignRecord> {
  const token = await ensureAuthenticated();
  const url = existingId
    ? `${API_BASE_URL}/api/v1/designs/${existingId}/`
    : `${API_BASE_URL}/api/v1/designs/`;
  const method = existingId ? 'PATCH' : 'POST';

  const res = await fetch(url, {
    method,
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      title,
      scene_json: scene,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData.detail ||
        (errData.scene_json ? JSON.stringify(errData.scene_json) : `Save error (HTTP ${res.status})`)
    );
  }

  return await res.json();
}

export async function deleteDesignFromBackend(id: string): Promise<void> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/designs/${id}/`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to delete design: HTTP ${res.status}`);
  }
}
