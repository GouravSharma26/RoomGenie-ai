import { ensureAuthenticated } from './designApi';
import { API_BASE_URL } from './apiConfig';

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ApproximateDimensions {
  width_m?: number | null;
  length_m?: number | null;
  height_m?: number | null;
}

export interface DetectedFurniture {
  category: string;
  label: string;
  estimated_spatial_zone?: string;
  color?: string | null;
  material?: string | null;
  confidence: number;
  bounding_box?: BoundingBox | null;
  approximate_dimensions_m?: ApproximateDimensions | null;
  suggested_catalogue_asset_id?: string | null;
  // Client state for review flow
  selected?: boolean;
}

export interface ArchitecturalFeatures {
  flooring?: string;
  wall_finish?: string;
  lighting?: string;
  windows_count?: number;
  doors_count?: number;
}

export interface ColorPaletteItem {
  hex: string;
  name: string;
  role?: string;
}

export interface RoomObservations {
  room_type: string;
  estimated_room_shape?: string;
  estimated_dimensions_approx_m?: ApproximateDimensions | null;
  overall_confidence: number;
  architectural_features?: ArchitecturalFeatures;
  detected_furniture: DetectedFurniture[];
  color_palette: ColorPaletteItem[];
  style_description?: string;
  spatial_summary?: string;
  recommendations: string[];
  uncertainty_notes?: string;
  requires_user_confirmation: boolean;
}

export interface RoomPhotoUploadResponse {
  upload_id: string;
  file_path: string;
  original_filename: string;
  file_size_bytes: number;
  content_type: string;
  image_format: string;
  width: number;
  height: number;
  expires_at: string;
  message: string;
}

export interface RoomPhotoAnalysisResponse {
  id: string;
  photo_upload_id: string;
  room_id: string | null;
  status: 'pending' | 'completed' | 'failed';
  provider: string;
  model_name: string;
  fallback_used: boolean;
  fallback_reason?: string | null;
  observations: RoomObservations | null;
  error_message?: string | null;
  latency_ms: number;
  created_at: string;
  completed_at: string | null;
  message?: string;
}

export async function uploadRoomPhoto(
  file: File,
  roomId?: string
): Promise<RoomPhotoUploadResponse> {
  const token = await ensureAuthenticated();

  const formData = new FormData();
  formData.append('photo', file);
  if (roomId) {
    formData.append('room_id', roomId);
  }

  const res = await fetch(`${API_BASE_URL}/api/v1/rooms/upload-photo/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      // Note: Content-Type omitted so browser sets multipart boundary automatically
    },
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg =
      data.detail ||
      data.error ||
      data.photo?.[0] ||
      (typeof data === 'string' ? data : `Photo upload failed (HTTP ${res.status})`);
    throw new Error(errorMsg);
  }

  return data as RoomPhotoUploadResponse;
}

export async function analyzeRoomPhoto(
  uploadId: string,
  roomId?: string,
  roomTypeHint?: string
): Promise<RoomPhotoAnalysisResponse> {
  const token = await ensureAuthenticated();

  const payload: Record<string, any> = {
    upload_id: uploadId,
  };
  if (roomId) {
    payload.room_id = roomId;
  }
  if (roomTypeHint) {
    payload.room_type_hint = roomTypeHint;
  }

  const res = await fetch(`${API_BASE_URL}/api/v1/rooms/analyze-photo/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg =
      data.detail ||
      data.error ||
      (typeof data === 'string' ? data : `Room vision analysis failed (HTTP ${res.status})`);
    throw new Error(errorMsg);
  }

  return data as RoomPhotoAnalysisResponse;
}

export async function getRoomAnalysis(
  analysisId: string
): Promise<RoomPhotoAnalysisResponse> {
  const token = await ensureAuthenticated();

  const res = await fetch(`${API_BASE_URL}/api/v1/rooms/analyses/${analysisId}/`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${token}`,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg =
      data.detail ||
      (typeof data === 'string' ? data : `Failed to load analysis record (HTTP ${res.status})`);
    throw new Error(errorMsg);
  }

  return data as RoomPhotoAnalysisResponse;
}

export async function listRoomAnalyses(
  roomId?: string
): Promise<RoomPhotoAnalysisResponse[]> {
  const token = await ensureAuthenticated();

  const url = roomId
    ? `${API_BASE_URL}/api/v1/rooms/analyses/?room_id=${encodeURIComponent(roomId)}`
    : `${API_BASE_URL}/api/v1/rooms/analyses/`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${token}`,
    },
  });

  const data = await res.json().catch(() => []);

  if (!res.ok) {
    throw new Error(`Failed to list analysis records (HTTP ${res.status})`);
  }

  return data as RoomPhotoAnalysisResponse[];
}
