import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhotoTo3DModal } from './PhotoTo3DModal';
import * as photoTo3dApi from '../../services/photoTo3dApi';
import * as visionApi from '../../services/visionApi';
import { useEditorStore } from '../../editor3d/store/editorStore';

// Mock ModelPreviewCanvas to prevent WebGL/jsdom issues in test runner
vi.mock('./ModelPreviewCanvas', () => ({
  ModelPreviewCanvas: ({ dimensions, color }: any) => (
    <div data-testid="model-preview-canvas" data-dimensions={dimensions.join(',')} data-color={color}>
      3D Model Preview
    </div>
  ),
}));

vi.mock('../../services/photoTo3dApi', () => ({
  createReconstructionJob: vi.fn(),
  pollReconstructionJob: vi.fn(),
  fetchReconstructedModelBlobUrl: vi.fn(),
  deleteReconstructionJob: vi.fn(),
  listReconstructionJobs: vi.fn(),
}));

vi.mock('../../services/visionApi', () => ({
  uploadRoomPhoto: vi.fn(),
}));

describe('PhotoTo3DModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [],
      },
    });
  });

  it('renders Photo-to-3D configuration step with category options and dimensions inputs', () => {
    render(<PhotoTo3DModal isOpen={true} onClose={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: /Photo-to-3D Furniture Reconstruction/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Approximate 3D/i)).toBeInTheDocument();
    expect(screen.getByText(/1. Source Photo/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Reconstruction Specifications/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate 3D Model/i })).toBeInTheDocument();
  });

  it('updates dimensions when category is switched', () => {
    render(<PhotoTo3DModal isOpen={true} onClose={vi.fn()} />);

    // Switch to 'tables'
    const tablesButton = screen.getByRole('button', { name: /^tables$/i });
    fireEvent.click(tablesButton);

    const widthInput = screen.getByDisplayValue('1.2') as HTMLInputElement;
    expect(widthInput).toBeInTheDocument();
  });

  it('validates photo file format before processing', () => {
    render(<PhotoTo3DModal isOpen={true} onClose={vi.fn()} />);

    const invalidFile = new File(['text'], 'model.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(screen.getByText(/Please select a valid image file/i)).toBeInTheDocument();
  });

  it('executes full reconstruction lifecycle and displays approximate label in review step', async () => {
    vi.mocked(visionApi.uploadRoomPhoto).mockResolvedValue({
      upload_id: 'photo-uuid-123',
      file_path: '/media/photo.jpg',
      original_filename: 'chair.jpg',
      file_size_bytes: 10240,
      content_type: 'image/jpeg',
      image_format: 'JPEG',
      width: 800,
      height: 600,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      message: 'Uploaded',
    });

    vi.mocked(photoTo3dApi.createReconstructionJob).mockResolvedValue({
      id: 'job-123',
      owner_id: 1,
      photo_upload_id: 'photo-uuid-123',
      target_category: 'seating',
      prompt_label: 'Modern Armchair',
      status: 'queued',
      provider: 'mock',
      model_name: 'mock-model-v1',
      file_size_bytes: 45000,
      approximate_dimensions: { width_m: 0.9, height_m: 0.85, depth_m: 0.85 },
      suggested_catalogue_fallback_id: 'chair-accent-armchair',
      error_category: '',
      error_message: '',
      latency_ms: 150,
      model_download_url: '/api/v1/furniture/reconstruction/jobs/job-123/model/',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    });

    vi.mocked(photoTo3dApi.pollReconstructionJob).mockResolvedValue({
      id: 'job-123',
      owner_id: 1,
      photo_upload_id: 'photo-uuid-123',
      target_category: 'seating',
      prompt_label: 'Modern Armchair',
      status: 'completed',
      provider: 'mock',
      model_name: 'mock-model-v1',
      file_size_bytes: 45000,
      approximate_dimensions: { width_m: 0.9, height_m: 0.85, depth_m: 0.85 },
      suggested_catalogue_fallback_id: 'chair-accent-armchair',
      error_category: '',
      error_message: '',
      latency_ms: 150,
      model_download_url: '/api/v1/furniture/reconstruction/jobs/job-123/model/',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockResolvedValue('blob:http://localhost/sample-glb');

    render(<PhotoTo3DModal isOpen={true} onClose={vi.fn()} />);

    // Select valid photo
    const imageFile = new File(['fake-image-bytes'], 'chair.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [imageFile] } });

    // Click Generate 3D Model
    const generateBtn = screen.getByRole('button', { name: /Generate 3D Model/i });
    fireEvent.click(generateBtn);

    // Wait for review step
    await waitFor(() => {
      expect(screen.getByText(/Approximate AI Reconstruction:/i)).toBeInTheDocument();
    });

    expect(screen.getByTestId('model-preview-canvas')).toBeInTheDocument();
    expect(screen.getByText(/Place in Room Canvas/i)).toBeInTheDocument();
    expect(screen.getByText(/Adjust Model Dimensions/i)).toBeInTheDocument();
  });

  it('places reconstructed model into active room canvas on explicit confirmation', async () => {
    vi.mocked(photoTo3dApi.createReconstructionJob).mockResolvedValue({
      id: 'job-456',
      owner_id: 1,
      photo_upload_id: null,
      target_category: 'seating',
      prompt_label: 'Modern Armchair',
      status: 'queued',
      provider: 'mock',
      model_name: 'mock-model-v1',
      file_size_bytes: 52000,
      approximate_dimensions: { width_m: 0.9, height_m: 0.85, depth_m: 0.85 },
      suggested_catalogue_fallback_id: 'chair-accent-armchair',
      error_category: '',
      error_message: '',
      latency_ms: 120,
      model_download_url: '/api/v1/furniture/reconstruction/jobs/job-456/model/',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    });

    vi.mocked(photoTo3dApi.pollReconstructionJob).mockResolvedValue({
      id: 'job-456',
      owner_id: 1,
      photo_upload_id: null,
      target_category: 'seating',
      prompt_label: 'Modern Armchair',
      status: 'completed',
      provider: 'mock',
      model_name: 'mock-model-v1',
      file_size_bytes: 52000,
      approximate_dimensions: { width_m: 0.9, height_m: 0.85, depth_m: 0.85 },
      suggested_catalogue_fallback_id: 'chair-accent-armchair',
      error_category: '',
      error_message: '',
      latency_ms: 120,
      model_download_url: '/api/v1/furniture/reconstruction/jobs/job-456/model/',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockResolvedValue('blob:http://localhost/armchair-glb');

    const onClose = vi.fn();
    render(<PhotoTo3DModal isOpen={true} onClose={onClose} />);

    // Click Generate 3D Model
    const generateBtn = screen.getByRole('button', { name: /Generate 3D Model/i });
    fireEvent.click(generateBtn);

    // Wait for review step
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Place in Room Canvas/i })).toBeInTheDocument();
    });

    // Click Place in Room Canvas
    const placeBtn = screen.getByRole('button', { name: /Place in Room Canvas/i });
    fireEvent.click(placeBtn);

    // Verify object added to editor store
    const objects = useEditorStore.getState().scene.objects;
    expect(objects.length).toBe(1);
    expect(objects[0].name).toContain('seating');
    expect(objects[0].isCustomReconstruction).toBe(true);
    expect(objects[0].modelUrl).toBe('blob:http://localhost/armchair-glb');
  });

  it('handles reconstruction failure and enables switching to catalogue fallback asset', async () => {
    vi.mocked(photoTo3dApi.createReconstructionJob).mockResolvedValue({
      id: 'job-err',
      owner_id: 1,
      photo_upload_id: null,
      target_category: 'seating',
      prompt_label: 'Broken Job',
      status: 'queued',
      provider: 'mock',
      model_name: 'mock-model',
      file_size_bytes: 0,
      approximate_dimensions: {},
      suggested_catalogue_fallback_id: 'sofa-modern-3seater',
      error_category: '',
      error_message: '',
      latency_ms: 0,
      model_download_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    });

    vi.mocked(photoTo3dApi.pollReconstructionJob).mockResolvedValue({
      id: 'job-err',
      owner_id: 1,
      photo_upload_id: null,
      target_category: 'seating',
      prompt_label: 'Broken Job',
      status: 'failed',
      provider: 'mock',
      model_name: 'mock-model',
      file_size_bytes: 0,
      approximate_dimensions: {},
      suggested_catalogue_fallback_id: 'sofa-modern-3seater',
      error_category: 'VALIDATION_ERROR',
      error_message: 'Simulated mesh generation failure',
      latency_ms: 100,
      model_download_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    render(<PhotoTo3DModal isOpen={true} onClose={vi.fn()} />);

    const generateBtn = screen.getByRole('button', { name: /Generate 3D Model/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Simulated mesh generation failure/i)).toBeInTheDocument();
    });

    // Check that catalogue fallback button is surfaced
    const fallbackBtn = screen.getByRole('button', { name: /Use Verified Catalogue Asset: Modern 3-Seater Sofa/i });
    expect(fallbackBtn).toBeInTheDocument();

    // Click catalogue fallback
    fireEvent.click(fallbackBtn);
    expect(screen.getByText(/Place in Room Canvas/i)).toBeInTheDocument();
  });
});
