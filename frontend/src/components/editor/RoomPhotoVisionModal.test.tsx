import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomPhotoVisionModal } from './RoomPhotoVisionModal';
import * as visionApi from '../../services/visionApi';
import { useEditorStore } from '../../editor3d/store/editorStore';

vi.mock('../../services/visionApi', () => ({
  uploadRoomPhoto: vi.fn(),
  analyzeRoomPhoto: vi.fn(),
  getRoomAnalysis: vi.fn(),
  listRoomAnalyses: vi.fn(),
}));

describe('RoomPhotoVisionModal Component', () => {
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

  it('renders upload dropzone, room hint selector, and uncertainty advisory when open', () => {
    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /Room-Photo Vision Analysis/i })).toBeInTheDocument();
    expect(screen.getByText(/Click to select or drag & drop a room photo/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-Detect Room Type/i)).toBeInTheDocument();
    expect(screen.getByText(/Non-destructive Advisory Vision/i)).toBeInTheDocument();
  });

  it('rejects unsupported file formats before uploading', async () => {
    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    const badFile = new File(['hello'], 'document.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [badFile] } });

    expect(screen.getByText(/Please select a valid image file/i)).toBeInTheDocument();
    expect(visionApi.uploadRoomPhoto).not.toHaveBeenCalled();
  });

  it('handles successful upload and renders structured observations with uncertainty disclaimer', async () => {
    vi.mocked(visionApi.uploadRoomPhoto).mockResolvedValue({
      upload_id: 'test-upload-uuid-1',
      file_path: '/media/test.jpg',
      original_filename: 'living.jpg',
      file_size_bytes: 204800,
      content_type: 'image/jpeg',
      image_format: 'JPEG',
      width: 1920,
      height: 1080,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      message: 'Uploaded successfully',
    });

    vi.mocked(visionApi.analyzeRoomPhoto).mockResolvedValue({
      id: 'analysis-uuid-1',
      photo_upload_id: 'test-upload-uuid-1',
      room_id: null,
      status: 'completed',
      provider: 'mock',
      model_name: 'mock-room-vision-v1',
      fallback_used: false,
      latency_ms: 120,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      observations: {
        room_type: 'living_room',
        estimated_room_shape: 'rectangular',
        overall_confidence: 0.94,
        estimated_dimensions_approx_m: {
          width_m: 4.8,
          length_m: 5.2,
          height_m: 2.8,
        },
        architectural_features: {
          flooring: 'oak_hardwood',
          wall_finish: 'matte_white',
          lighting: 'natural_window',
          windows_count: 2,
          doors_count: 1,
        },
        color_palette: [
          { hex: '#F8FAFC', name: 'Warm White', role: 'walls' },
          { hex: '#334155', name: 'Slate Gray', role: 'upholstery' },
        ],
        detected_furniture: [
          {
            category: 'seating',
            label: '3-Seater Fabric Sofa',
            estimated_spatial_zone: 'center_seating_zone',
            confidence: 0.95,
            bounding_box: { ymin: 0.3, xmin: 0.2, ymax: 0.8, xmax: 0.8 },
            approximate_dimensions_m: { width_m: 2.1, length_m: 0.9, height_m: 0.85 },
            suggested_catalogue_asset_id: 'sofa-modern-3seater',
          },
          {
            category: 'tables',
            label: 'Round Coffee Table',
            estimated_spatial_zone: 'center_foreground',
            confidence: 0.88,
            suggested_catalogue_asset_id: 'table-oak-coffee',
          },
        ],
        style_description: 'Modern Minimalist',
        spatial_summary: 'Central conversational group',
        recommendations: ['Maintain 0.8m pathway clearance'],
        uncertainty_notes: 'Exact physical room dimensions cannot be determined from a single 2D photograph.',
        requires_user_confirmation: true,
      },
    });

    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    // Select valid image
    const validFile = new File(['mock-img-data'], 'living.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    // Click Upload & Analyze
    const analyzeBtn = screen.getByRole('button', { name: /Upload & Analyze/i });
    fireEvent.click(analyzeBtn);

    // Wait for review screen
    await waitFor(() => {
      expect(screen.getByText(/living room/i)).toBeInTheDocument();
      expect(screen.getByText('94% Match')).toBeInTheDocument();
      expect(screen.getByText(/Spatial Uncertainty Disclaimer/i)).toBeInTheDocument();
      expect(screen.getByText(/3-Seater Fabric Sofa/i)).toBeInTheDocument();
      expect(screen.getByText(/Round Coffee Table/i)).toBeInTheDocument();
      expect(screen.getByText('Warm White')).toBeInTheDocument();
      expect(screen.getByText('#F8FAFC')).toBeInTheDocument();
    });
  });

  it('allows deselecting and removing individual furniture suggestions', async () => {
    vi.mocked(visionApi.uploadRoomPhoto).mockResolvedValue({
      upload_id: 'u-1',
      file_path: '/path.jpg',
      original_filename: 'room.jpg',
      file_size_bytes: 1000,
      content_type: 'image/jpeg',
      image_format: 'JPEG',
      width: 800,
      height: 600,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      message: 'ok',
    });

    vi.mocked(visionApi.analyzeRoomPhoto).mockResolvedValue({
      id: 'a-1',
      photo_upload_id: 'u-1',
      room_id: null,
      status: 'completed',
      provider: 'mock',
      model_name: 'mock-v1',
      fallback_used: false,
      latency_ms: 50,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      observations: {
        room_type: 'living_room',
        overall_confidence: 0.9,
        detected_furniture: [
          {
            category: 'seating',
            label: 'Armchair to Keep',
            confidence: 0.9,
            suggested_catalogue_asset_id: 'chair-accent-armchair',
          },
          {
            category: 'tables',
            label: 'Table to Delete',
            confidence: 0.8,
            suggested_catalogue_asset_id: 'table-oak-coffee',
          },
        ],
        color_palette: [],
        recommendations: [],
        requires_user_confirmation: true,
      },
    });

    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    const file = new File(['data'], 'room.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload & Analyze/i }));

    await waitFor(() => {
      expect(screen.getByText('Armchair to Keep')).toBeInTheDocument();
      expect(screen.getByText('Table to Delete')).toBeInTheDocument();
    });

    // Delete table suggestion
    const deleteButtons = screen.getAllByTitle(/Reject and remove suggestion/i);
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[1]);

    expect(screen.queryByText('Table to Delete')).not.toBeInTheDocument();
    expect(screen.getByText('Armchair to Keep')).toBeInTheDocument();
  });

  it('requires explicit confirmation before applying changes and adds confirmed items to 3D scene', async () => {
    vi.mocked(visionApi.uploadRoomPhoto).mockResolvedValue({
      upload_id: 'u-2',
      file_path: '/path.jpg',
      original_filename: 'room.jpg',
      file_size_bytes: 1000,
      content_type: 'image/jpeg',
      image_format: 'JPEG',
      width: 800,
      height: 600,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      message: 'ok',
    });

    vi.mocked(visionApi.analyzeRoomPhoto).mockResolvedValue({
      id: 'a-2',
      photo_upload_id: 'u-2',
      room_id: null,
      status: 'completed',
      provider: 'mock',
      model_name: 'mock-v1',
      fallback_used: false,
      latency_ms: 50,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      observations: {
        room_type: 'living_room',
        overall_confidence: 0.9,
        estimated_dimensions_approx_m: {
          width_m: 6.0,
          length_m: 5.0,
          height_m: 3.0,
        },
        detected_furniture: [
          {
            category: 'seating',
            label: 'Approved Sofa',
            confidence: 0.92,
            suggested_catalogue_asset_id: 'sofa-modern-3seater',
          },
        ],
        color_palette: [],
        recommendations: [],
        requires_user_confirmation: true,
      },
    });

    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    const file = new File(['data'], 'room.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload & Analyze/i }));

    await waitFor(() => {
      expect(screen.getByText('Approved Sofa')).toBeInTheDocument();
    });

    // Check that scene has not been mutated yet
    expect(useEditorStore.getState().scene.objects).toHaveLength(0);
    expect(useEditorStore.getState().scene.room.width).toBe(5.0);

    // Click Apply Confirmed Items button (triggers confirmation prompt)
    const applyBtn = screen.getByRole('button', { name: /Apply Confirmed Items/i });
    fireEvent.click(applyBtn);

    // Confirmation prompt should now be visible
    expect(screen.getByText(/Confirm 3D Room Updates/i)).toBeInTheDocument();
    expect(screen.getByText(/You are about to add/i)).toBeInTheDocument();

    // Confirm application
    const confirmBtn = screen.getByRole('button', { name: /Yes, Apply to Scene/i });
    fireEvent.click(confirmBtn);

    // Verify scene updated
    await waitFor(() => {
      expect(screen.getByText(/Suggestions Applied to 3D Scene/i)).toBeInTheDocument();
    });

    // Room dimensions updated to 6.0m
    expect(useEditorStore.getState().scene.room.width).toBe(6.0);
    // Approved sofa added to objects
    expect(useEditorStore.getState().scene.objects).toHaveLength(1);
    expect(useEditorStore.getState().scene.objects[0].assetId).toBe('sofa-modern-3seater');
  });

  it('displays error banner when vision analysis fails or upload has expired', async () => {
    vi.mocked(visionApi.uploadRoomPhoto).mockRejectedValue(
      new Error('Uploaded photo has expired. Please upload a fresh room photo.')
    );

    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    const file = new File(['data'], 'expired.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload & Analyze/i }));

    await waitFor(() => {
      expect(screen.getByText(/Uploaded photo has expired/i)).toBeInTheDocument();
    });
  });

  it('renders fallback notice when live provider falls back to mock', async () => {
    vi.mocked(visionApi.uploadRoomPhoto).mockResolvedValue({
      upload_id: 'u-3',
      file_path: '/path.jpg',
      original_filename: 'room.jpg',
      file_size_bytes: 1000,
      content_type: 'image/jpeg',
      image_format: 'JPEG',
      width: 800,
      height: 600,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      message: 'ok',
    });

    vi.mocked(visionApi.analyzeRoomPhoto).mockResolvedValue({
      id: 'a-3',
      photo_upload_id: 'u-3',
      room_id: null,
      status: 'completed',
      provider: 'mock',
      model_name: 'mock-v1',
      fallback_used: true,
      fallback_reason: 'gemini_api_key_not_configured',
      latency_ms: 40,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      observations: {
        room_type: 'bedroom',
        overall_confidence: 0.9,
        detected_furniture: [],
        color_palette: [],
        recommendations: [],
        requires_user_confirmation: true,
      },
    });

    render(<RoomPhotoVisionModal isOpen={true} onClose={vi.fn()} />);

    const file = new File(['data'], 'room.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Upload & Analyze/i }));

    await waitFor(() => {
      expect(screen.getByText(/Fallback Vision Mode Active/i)).toBeInTheDocument();
      expect(screen.getByText(/gemini_api_key_not_configured/i)).toBeInTheDocument();
    });
  });
});
