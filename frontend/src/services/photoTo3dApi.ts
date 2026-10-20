import { ensureAuthenticated } from './designApi';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface ApproximateDimensions {
  width_m?: number | null;
  height_m?: number | null;
  depth_m?: number | null;
}

export type ReconstructionStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ReconstructionJob {
  id: string;
  owner_id: number;
  photo_upload_id: string | null;
  target_category: 'seating' | 'tables' | 'storage' | 'beds' | 'decor';
  prompt_label: string;
  status: ReconstructionStatus;
  provider: string;
  model_name: string;
  file_size_bytes: number;
  approximate_dimensions: ApproximateDimensions;
  suggested_catalogue_fallback_id: string;
  error_category: string;
  error_message: string;
  latency_ms: number;
  model_download_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateReconstructionJobPayload {
  photo_upload_id?: string | null;
  target_category: 'seating' | 'tables' | 'storage' | 'beds' | 'decor';
  prompt_label?: string;
  reference_dimensions?: {
    width_m?: number;
    height_m?: number;
    depth_m?: number;
  } | null;
  provider?: string;
  auto_process?: boolean;
  sync?: boolean;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await ensureAuthenticated();
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Token ${token}`,
  };
}

/**
 * Creates a new 3D reconstruction job.
 */
export async function createReconstructionJob(
  payload: CreateReconstructionJobPayload
): Promise<ReconstructionJob> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/v1/furniture/reconstruction/jobs/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg =
      data.detail ||
      data.error ||
      data.photo_upload_id?.[0] ||
      data.reference_dimensions?.[0] ||
      `Job creation failed (HTTP ${res.status})`;
    throw new Error(errorMsg);
  }

  return data as ReconstructionJob;
}

/**
 * Retrieves a single reconstruction job by ID (primary polling endpoint).
 */
export async function getReconstructionJob(id: string): Promise<ReconstructionJob> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/v1/furniture/reconstruction/jobs/${id}/`, {
    method: 'GET',
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Failed to fetch job ${id} (HTTP ${res.status})`);
  }

  return data as ReconstructionJob;
}

/**
 * Polls a reconstruction job until terminal status ('completed' or 'failed').
 */
export async function pollReconstructionJob(
  id: string,
  onUpdate?: (job: ReconstructionJob) => void,
  maxAttempts: number = 30,
  intervalMs: number = 1000
): Promise<ReconstructionJob> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await getReconstructionJob(id);
    if (onUpdate) onUpdate(job);

    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Job ${id} timed out while waiting for reconstruction to finish.`);
}

/**
 * Fetches the private, authenticated 3D GLB model binary and returns a local object URL (blob:).
 * Ensures private models are securely downloaded with Token authentication.
 */
export async function fetchReconstructedModelBlobUrl(jobId: string): Promise<string> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/furniture/reconstruction/jobs/${jobId}/model/`, {
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to download 3D model (HTTP ${res.status})`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Deletes a reconstruction job and cleans up associated model files on disk.
 */
export async function deleteReconstructionJob(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/v1/furniture/reconstruction/jobs/${id}/`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to delete job ${id}`);
  }
}

/**
 * Lists the authenticated user's reconstruction jobs with optional filtering.
 */
export async function listReconstructionJobs(
  status?: string,
  category?: string
): Promise<ReconstructionJob[]> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (category) params.append('category', category);

  const url = `${API_BASE_URL}/api/v1/furniture/reconstruction/jobs/${params.toString() ? '?' + params.toString() : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers,
  });

  const data = await res.json().catch(() => ([]));
  if (!res.ok) {
    throw new Error(data.detail || `Failed to list reconstruction jobs`);
  }

  return data as ReconstructionJob[];
}
