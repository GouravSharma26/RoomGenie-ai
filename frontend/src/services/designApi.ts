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

export interface FurnitureAssetBackend {
  id: string;
  name: string;
  category: string;
  style_tags: string[];
  width: string;
  height: string;
  depth: string;
  dimensions: [number, number, number];
  price_paise: number | null;
  price_inr: string | null;
  is_priced: boolean;
  currency: string;
  model_url: string | null;
  thumbnail_url: string | null;
  license: string;
  source: string;
  description: string;
  is_active: boolean;
  created_at: string;
}

export interface CatalogueFilterParams {
  category?: string;
  style?: string;
  search?: string;
  min_price?: number;
  max_price?: number;
  has_price?: boolean;
  ordering?: string;
}

export interface BudgetEstimateItem {
  index: number;
  placement_id: string;
  asset_id: string | null;
  name: string;
  category: string;
  status: 'priced' | 'unpriced' | 'unregistered';
  price_paise: number | null;
  price_inr: string | null;
  currency: string;
  is_known_price: boolean;
  dimensions: number[];
  position: number[];
  scale: number[];
  rotationEuler: number[];
}

export interface CategorySubtotal {
  category: string;
  item_count: number;
  subtotal_paise: number;
  subtotal_inr: string;
  currency: string;
  has_unpriced: boolean;
}

export interface BoundaryViolation {
  placement_id: string;
  name: string;
  axis: string;
  message: string;
}

export interface BudgetEstimateResponse {
  design_title: string | null;
  currency: string;
  total_paise: number;
  total_inr: string;
  total_items: number;
  priced_items_count: number;
  unpriced_items_count: number;
  has_unknown_prices: boolean;
  category_breakdown: Record<string, CategorySubtotal>;
  items: BudgetEstimateItem[];
  room_constraints: {
    is_valid: boolean;
    violations_count: number;
    violations: BoundaryViolation[];
  };
}

export async function fetchFurnitureCatalog(params?: CatalogueFilterParams): Promise<FurnitureAssetBackend[]> {
  const query = new URLSearchParams();
  if (params?.category && params.category !== 'all') {
    query.set('category', params.category);
  }
  if (params?.style && params.style !== 'all') {
    query.set('style', params.style);
  }
  if (params?.search) {
    query.set('search', params.search.trim());
  }
  if (params?.min_price !== undefined) {
    query.set('min_price', String(params.min_price));
  }
  if (params?.max_price !== undefined) {
    query.set('max_price', String(params.max_price));
  }
  if (params?.has_price !== undefined) {
    query.set('has_price', String(params.has_price));
  }
  if (params?.ordering) {
    query.set('ordering', params.ordering);
  }

  const queryString = query.toString();
  const url = `${API_BASE_URL}/api/v1/furniture/${queryString ? `?${queryString}` : ''}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch furniture catalogue (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function estimateBudget(payload: {
  scene_json?: CanonicalScene;
  design_id?: string;
  items?: any[];
}): Promise<BudgetEstimateResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (payload.design_id) {
    const token = await ensureAuthenticated();
    headers['Authorization'] = `Token ${token}`;
  } else {
    const existing = getAuthToken();
    if (existing) {
      headers['Authorization'] = `Token ${existing}`;
    }
  }

  const res = await fetch(`${API_BASE_URL}/api/v1/budgets/estimate/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Budget calculation failed (HTTP ${res.status})`);
  }
  return await res.json();
}

