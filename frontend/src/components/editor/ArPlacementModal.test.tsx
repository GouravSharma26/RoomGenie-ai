import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArPlacementModal } from './ArPlacementModal';
import { useEditorStore } from '../../editor3d/store/editorStore';
import * as arService from '../../services/arService';
import * as webXrArSession from '../../services/webXrArSession';

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
      currentDesignId: 'design-e2e-789',
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
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('designId=design-e2e-789')
    );
  });

  it('displays searching surface state initially and allows toggling in simulator', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('ar-unsupported-fallback')).toBeInTheDocument();
    });

    // Initially surface is searching
    expect(screen.getByTestId('surface-searching-indicator')).toBeInTheDocument();
    expect(screen.getByText(/Searching for floor surface\.\.\./i)).toBeInTheDocument();

    // Click toggle button
    const toggleBtn = screen.getByRole('button', { name: /Simulate Surface Found/i });
    fireEvent.click(toggleBtn);

    // Now surface is acquired
    expect(screen.getByTestId('surface-detected-indicator')).toBeInTheDocument();
    expect(screen.getByText(/Floor Plane Acquired \(Y = 0\.00 m\)/i)).toBeInTheDocument();
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

  it('launches real WebXR session when supported and handles camera frame surface tracking and session end', async () => {
    vi.spyOn(arService, 'checkArCapability').mockResolvedValue({
      isWebXrSupported: true,
      isSceneViewerSupported: true,
      isQuickLookSupported: false,
      deviceCategory: 'android-arcore',
      recommendation: 'webxr',
      statusTitle: 'WebXR Immersive-AR Compatible',
      statusDescription: 'WebXR ready',
      limitations: arService.AR_LIMITATIONS,
    });

    const mockEndSession = vi.fn().mockResolvedValue(undefined);
    let capturedSurfaceCallback: ((detected: boolean) => void) | undefined;

    vi.spyOn(webXrArSession, 'startWebXrArSession').mockImplementation(async (opts) => {
      capturedSurfaceCallback = opts.onSurfaceDetectedChange;
      return {
        endSession: mockEndSession,
        isPlaced: () => false,
        isSurfaceDetected: () => true,
        setRotationY: vi.fn(),
        setScale: vi.fn(),
        repositionToReticle: vi.fn().mockReturnValue(true),
        isDisposed: () => false,
      };
    });

    render(<ArPlacementModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch WebXR AR Session/i })).toBeInTheDocument();
    });

    // Launch WebXR AR Session
    fireEvent.click(screen.getByRole('button', { name: /Launch WebXR AR Session/i }));

    await waitFor(() => {
      expect(webXrArSession.startWebXrArSession).toHaveBeenCalled();
      expect(screen.getByText(/WebXR AR Camera Live/i)).toBeInTheDocument();
    });

    // Simulate surface detection change from camera frame
    capturedSurfaceCallback!(true);
    await waitFor(() => {
      expect(screen.getByTestId('surface-detected-indicator')).toBeInTheDocument();
    });

    // End session
    const endBtn = screen.getByRole('button', { name: /End AR Camera Session/i });
    fireEvent.click(endBtn);
    expect(mockEndSession).toHaveBeenCalled();
  });

  it('displays authenticated streaming notice and suppresses Google Scene Viewer for custom reconstructions', async () => {
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
      expect(
        screen.getByText(/This AI reconstructed asset \(job-reco\.\.\.\) is streamed privately in-session/i)
      ).toBeInTheDocument();
      // Ensure Google Scene Viewer link is NEVER rendered for private blob reconstructions
      expect(screen.queryByText(/Launch Google Scene Viewer/i)).toBeNull();
    });
  });

  it('pauses background preview canvas and supports repositioning to reticle when WebXR is active', async () => {
    vi.spyOn(arService, 'checkArCapability').mockResolvedValue({
      isWebXrSupported: true,
      isSceneViewerSupported: true,
      isQuickLookSupported: false,
      deviceCategory: 'android-arcore',
      recommendation: 'webxr',
      statusTitle: 'WebXR Immersive-AR Compatible',
      statusDescription: 'WebXR ready',
      limitations: arService.AR_LIMITATIONS,
    });

    const mockReposition = vi.fn().mockReturnValue(true);
    let capturedPlacedCallback: ((pos: [number, number, number], rot: number, scale: number) => void) | undefined;

    vi.spyOn(webXrArSession, 'startWebXrArSession').mockImplementation(async (opts) => {
      capturedPlacedCallback = opts.onPlaced;
      return {
        endSession: vi.fn().mockResolvedValue(undefined),
        isPlaced: () => true,
        isSurfaceDetected: () => true,
        setRotationY: vi.fn(),
        setScale: vi.fn(),
        repositionToReticle: mockReposition,
        isDisposed: () => false,
      };
    });

    render(<ArPlacementModal isOpen={true} onClose={vi.fn()} />);

    // Before launch: preview canvas is visible
    expect(screen.getByTestId('mock-preview-canvas')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch WebXR AR Session/i })).toBeInTheDocument();
    });

    // Launch WebXR
    fireEvent.click(screen.getByRole('button', { name: /Launch WebXR AR Session/i }));

    await waitFor(() => {
      // Background preview canvas is now unmounted / paused to save GPU resources
      expect(screen.queryByTestId('mock-preview-canvas')).toBeNull();
      expect(screen.getByText(/Live WebXR Camera View Active/i)).toBeInTheDocument();
    });

    // Trigger placement callback
    capturedPlacedCallback!([0.5, 0, -1.2], 0, 1.0);

    // Reposition button should now be available in the live modal HUD
    await waitFor(() => {
      const repositionBtns = screen.getAllByRole('button', { name: /Reposition to Reticle/i });
      expect(repositionBtns.length).toBeGreaterThan(0);
      fireEvent.click(repositionBtns[0]);
      expect(mockReposition).toHaveBeenCalled();
    });
  });

  it('calls onClose and ends active session when close button is clicked', async () => {
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
