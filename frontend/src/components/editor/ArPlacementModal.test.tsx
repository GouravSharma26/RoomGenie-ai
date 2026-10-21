import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArPlacementModal } from './ArPlacementModal';
import { useEditorStore } from '../../editor3d/store/editorStore';
import * as arService from '../../services/arService';

// Mock Three.js / Canvas preview
vi.mock('./ModelPreviewCanvas', () => ({
  ModelPreviewCanvas: ({ dimensions }: { dimensions: [number, number, number] }) => (
    <div data-testid="mock-preview-canvas">
      Preview: {dimensions[0]}x{dimensions[1]}x{dimensions[2]}
    </div>
  ),
}));

describe('ArPlacementModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'placement-test-chair',
            assetId: 'chair-modern-wood',
            name: 'Modern Wooden Chair',
            dimensions: [0.6, 0.85, 0.6],
            position: [0, 0.425, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            modelUrl: 'https://roomgenie.example.com/chair.glb',
          },
        ],
      },
      selectedId: 'placement-test-chair',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<ArPlacementModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('ar-placement-modal')).toBeNull();
  });

  it('renders modal, loads capabilities, and shows fallback on desktop browsers', async () => {
    vi.spyOn(arService, 'checkArCapability').mockResolvedValue({
      isWebXrSupported: false,
      isSceneViewerSupported: false,
      isQuickLookSupported: false,
      deviceCategory: 'desktop',
      recommendation: 'mobile-handoff',
      statusTitle: 'Desktop Browser (Non-AR Hardware)',
      statusDescription: 'This desktop browser lacks camera-based optical SLAM hardware.',
      limitations: arService.AR_LIMITATIONS,
    });

    render(<ArPlacementModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Augmented Reality \(AR\) Furniture Placement/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('ar-unsupported-fallback')).toBeInTheDocument();
      expect(screen.getByText(/Desktop Browser \(Non-AR Hardware\)/i)).toBeInTheDocument();
    });

    // Check limitations section
    expect(screen.getByText(/Physical & Environmental Limitations/i)).toBeInTheDocument();
    expect(screen.getByText(/1. Tracking:/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Scale:/i)).toBeInTheDocument();
    expect(screen.getByText(/3. Lighting:/i)).toBeInTheDocument();

    // Check QR mobile handoff link copy button
    const copyButton = screen.getByRole('button', { name: /Copy Mobile AR Link/i });
    expect(copyButton).toBeInTheDocument();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    fireEvent.click(copyButton);
    expect(writeTextMock).toHaveBeenCalled();
  });

  it('allows manual adjustment of scale and updates dimensions in the HUD', async () => {
    vi.spyOn(arService, 'checkArCapability').mockResolvedValue({
      isWebXrSupported: false,
      isSceneViewerSupported: false,
      isQuickLookSupported: false,
      deviceCategory: 'desktop',
      recommendation: 'mobile-handoff',
      statusTitle: 'Desktop Browser',
      statusDescription: 'Desktop mode',
      limitations: arService.AR_LIMITATIONS,
    });

    render(<ArPlacementModal isOpen={true} onClose={vi.fn()} />);

    // Initially scale is 1.0 -> chair is 0.6 x 0.85 x 0.6
    expect(screen.getByText(/Size: 0.6m × 0.85m × 0.6m/i)).toBeInTheDocument();

    // Find the scale range slider and change it to 1.5x
    const scaleSlider = screen.getByRole('slider', { name: /Scale Multiplier/i });
    fireEvent.change(scaleSlider, { target: { value: '1.5' } });

    // 0.6 * 1.5 = 0.9, 0.85 * 1.5 = 1.275 -> 1.27
    await waitFor(() => {
      expect(screen.getByText(/Size: 0.9m × 1.27m × 0.9m/i)).toBeInTheDocument();
    });
  });

  it('displays authenticated streaming notice when a custom reconstructed item is selected', async () => {
    useEditorStore.setState({
      scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [
          {
            id: 'custom-recon-obj',
            assetId: 'custom-recon',
            name: 'Reconstructed Heritage Desk',
            dimensions: [1.2, 0.75, 0.7],
            position: [0, 0.375, 0],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
            reconstructionJobId: 'job-recon-12345678-abcd',
            isCustomReconstruction: true,
            modelUrl: 'blob:http://localhost/recon-blob',
          },
        ],
      },
      selectedId: 'custom-recon-obj',
    });

    render(<ArPlacementModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Reconstructed Heritage Desk/i)).toBeInTheDocument();
      expect(screen.getByText(/This AI reconstructed asset \(job-reco\.\.\.\) is streamed privately in-session/i)).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const handleClose = vi.fn();
    render(<ArPlacementModal isOpen={true} onClose={handleClose} />);

    const closeBtn = screen.getByRole('button', { name: /Close AR Modal/i });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByTestId('ar-placement-modal')).toBeInTheDocument();
    });
  });
});
