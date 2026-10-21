import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import * as api from './services/api';
import * as agentApi from './services/agentApi';
import * as designApi from './services/designApi';
import { useEditorStore } from './editor3d/store/editorStore';

vi.mock('./services/api');
vi.mock('./services/designApi', () => ({
  ensureAuthenticated: vi.fn().mockResolvedValue('mock-token'),
  getDesignById: vi.fn(),
  listSavedDesigns: vi.fn().mockResolvedValue([]),
  saveDesignToBackend: vi.fn().mockResolvedValue({ id: 'test-id', title: 'Test' }),
  deleteDesignFromBackend: vi.fn().mockResolvedValue(undefined),
  fetchFurnitureCatalog: vi.fn().mockResolvedValue([]),
  estimateBudget: vi.fn().mockResolvedValue({
    design_title: null,
    currency: 'INR',
    total_paise: 2999900,
    total_inr: '29999.00',
    total_items: 1,
    priced_items_count: 1,
    unpriced_items_count: 0,
    has_unknown_prices: false,
    category_breakdown: {
      seating: {
        category: 'seating',
        item_count: 1,
        subtotal_paise: 2999900,
        subtotal_inr: '29999.00',
        currency: 'INR',
        has_unpriced: false,
      },
    },
    items: [],
    room_constraints: {
      is_valid: true,
      violations_count: 0,
      violations: [],
    },
  }),
}));

vi.mock('./services/agentApi', () => ({
  createAgentSession: vi.fn().mockResolvedValue({
    id: 'session-uuid-1',
    owner_username: 'demo_engineer',
    design: null,
    title: 'AI Interior Design Assistant',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  listAgentSessions: vi.fn().mockResolvedValue([]),
  sendAgentPrompt: vi.fn().mockResolvedValue({
    run: {
      id: 'run-uuid-1',
      session: 'session-uuid-1',
      user_prompt: 'Add an armchair and cozy reading nook',
      status: 'proposed',
      ai_response_text: 'I have placed a modern armchair next to your sofa for a reading corner.',
      proposed_actions: [
        {
          name: 'add_furniture',
          parameters: {
            asset_id: 'armchair-modern',
            position: [1.2, 0.45, 0.5],
            rotation: [0, 0, 0],
          },
        },
      ],
      validation_results: {
        is_valid: true,
        errors: [],
        warnings: [],
        budget_diff: {
          before_paise: 2999900,
          after_paise: 4499800,
          diff_paise: 1499900,
        },
      },
      provider_metadata: {
        provider: 'mock',
        model: 'deterministic-mock-v1',
      },
      created_at: new Date().toISOString(),
    },
    candidate_scene: {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'initial-sofa',
          assetId: 'sofa-3seater',
          name: '3-Seater Fabric Sofa',
          dimensions: [2.0, 0.85, 0.9],
          position: [0, 0.425, 0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'ai-armchair-modern',
          assetId: 'armchair-modern',
          name: 'Modern Fabric Armchair',
          dimensions: [0.9, 0.85, 0.85],
          position: [1.2, 0.425, 0.5],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    },
    budget_diff: {
      before_paise: 2999900,
      after_paise: 4499800,
      diff_paise: 1499900,
    },
    requires_approval: true,
  }),
  applyAgentRun: vi.fn().mockResolvedValue({
    detail: 'Proposal successfully approved and applied to design.',
    run: {
      id: 'run-uuid-1',
      status: 'approved',
    },
    applied_scene: {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'initial-sofa',
          assetId: 'sofa-3seater',
          name: '3-Seater Fabric Sofa',
          dimensions: [2.0, 0.85, 0.9],
          position: [0, 0.425, 0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'ai-armchair-modern',
          assetId: 'armchair-modern',
          name: 'Modern Fabric Armchair',
          dimensions: [0.9, 0.85, 0.85],
          position: [1.2, 0.425, 0.5],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    },
    budget_diff: {
      before_paise: 2999900,
      after_paise: 4499800,
      diff_paise: 1499900,
    },
  }),
  rejectAgentRun: vi.fn().mockResolvedValue({
    detail: 'Proposal rejected by user.',
    run: {
      id: 'run-uuid-1',
      status: 'rejected',
    },
  }),
}));

vi.mock('./editor3d/components/RoomCanvas', () => ({
  RoomCanvas: () => <div data-testid="mock-room-canvas">3D Viewport Active</div>,
}));

vi.mock('./components/editor/ModelPreviewCanvas', () => ({
  ModelPreviewCanvas: () => <div data-testid="mock-preview-canvas">3D Preview</div>,
}));

describe('RoomGenie AI App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders application brand and 3D Room Editor by default', () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    expect(screen.getByText('RoomGenie AI')).toBeInTheDocument();
    expect(screen.getByText('Phase 7 Active')).toBeInTheDocument();
    expect(screen.getByText('Furniture Catalogue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Room Photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Photo to 3D/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AR View/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Designer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Load/i })).toBeInTheDocument();
    expect(screen.getByTestId('mock-room-canvas')).toBeInTheDocument();
  });

  it('opens AR Placement modal when AR View button is clicked', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /AR View/i }));
    expect(screen.getByRole('heading', { name: /Augmented Reality \(AR\) Furniture Placement/i })).toBeInTheDocument();
  });

  it('restores design, authenticates, and auto-opens AR flow when ar=true handoff URL is loaded', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    const mockDesignRecord = {
      id: 'design-handoff-xyz',
      owner_username: 'engineer',
      room_id: null,
      title: 'Handoff Penthouse',
      description: '',
      budget: null,
      style_preferences: [],
      scene_json: {
        schemaVersion: 1,
        unit: 'm' as const,
        room: { width: 6.0, length: 5.0, height: 2.8 },
        objects: [
          {
            id: 'handoff-chair-1',
            assetId: 'chair-modern-wood',
            name: 'Handoff Chair',
            dimensions: [0.6, 0.85, 0.6] as [number, number, number],
            position: [0, 0.425, 0] as [number, number, number],
            rotationEuler: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
        ],
      },
      object_count: 1,
      created_at: '2026-10-21T00:00:00Z',
      updated_at: '2026-10-21T00:00:00Z',
    };

    vi.mocked(designApi.getDesignById).mockResolvedValue(mockDesignRecord);

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        search: '?ar=true&designId=design-handoff-xyz&assetId=handoff-chair-1',
      },
      writable: true,
      configurable: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(designApi.ensureAuthenticated).toHaveBeenCalled();
      expect(designApi.getDesignById).toHaveBeenCalledWith('design-handoff-xyz');
      expect(screen.getByRole('heading', { name: /Augmented Reality \(AR\) Furniture Placement/i })).toBeInTheDocument();
      expect(useEditorStore.getState().currentDesignId).toBe('design-handoff-xyz');
      expect(useEditorStore.getState().scene.room.width).toBe(6.0);
    });

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('opens Photo-to-3D Reconstruction modal when button is clicked', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Photo to 3D/i }));
    expect(screen.getByRole('heading', { name: /Photo-to-3D Furniture Reconstruction/i })).toBeInTheDocument();
    expect(screen.getByText(/Approximate 3D/i)).toBeInTheDocument();
  });

  it('opens Room Photo Vision Analysis modal when button is clicked', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Room Photo/i }));
    expect(screen.getByRole('heading', { name: /Room-Photo Vision Analysis/i })).toBeInTheDocument();
    expect(screen.getByText(/Click to select or drag & drop a room photo/i)).toBeInTheDocument();
  });

  it('opens Save & Load persistence modal when button is clicked', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Save & Load/i }));
    expect(screen.getByText('Save & Load Room Designs')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL Cloud Persistence (Phase 2)')).toBeInTheDocument();
  });

  it('opens Budget Breakdown modal when Breakdown button is clicked', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    const breakdownBtn = screen.getByRole('button', { name: /Breakdown/i });
    expect(breakdownBtn).toBeInTheDocument();
    fireEvent.click(breakdownBtn);

    expect(screen.getByText('Deterministic Budget & Cost Estimate')).toBeInTheDocument();
    expect(screen.getByText(/Authoritative backend calculation in integer paise/i)).toBeInTheDocument();
  });

  it('opens AI Design Assistant drawer, displays session, and supports 2-phase approval workflow', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    const aiBtn = screen.getByRole('button', { name: /AI Designer/i });
    expect(aiBtn).toBeInTheDocument();
    fireEvent.click(aiBtn);

    // AI Drawer opens and initializes session
    expect(screen.getByText('AI Design Assistant')).toBeInTheDocument();
    await waitFor(() => {
      expect(agentApi.createAgentSession).toHaveBeenCalled();
      expect(screen.getByText(/Hello! I am your AI Interior Design Assistant/i)).toBeInTheDocument();
    });

    // Submit quick prompt
    const quickPromptBtn = screen.getByText('Add an armchair and create a cozy reading corner');
    fireEvent.click(quickPromptBtn);

    // Verify model response & proposed modifications card
    await waitFor(() => {
      expect(agentApi.sendAgentPrompt).toHaveBeenCalled();
      expect(screen.getByText('Proposed Modifications')).toBeInTheDocument();
      expect(screen.getByText('Approval Required')).toBeInTheDocument();
      expect(screen.getByText('add_furniture')).toBeInTheDocument();
      expect(screen.getByText(/Budget Impact:/i)).toBeInTheDocument();
    });

    // Check 2-phase approval buttons
    const approveBtn = screen.getByRole('button', { name: /Approve & Apply to 3D Scene/i });
    const discardBtn = screen.getByRole('button', { name: /Discard/i });
    expect(approveBtn).toBeInTheDocument();
    expect(discardBtn).toBeInTheDocument();

    // Click Approve
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(agentApi.applyAgentRun).toHaveBeenCalledWith('run-uuid-1', expect.anything());
      expect(screen.getByText('Approved')).toBeInTheDocument();
    });
  });

  it('switches to System Status dashboard and renders connected database state', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'connected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /System Status/i }));

    expect(screen.getByText('Django REST API')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL 17')).toBeInTheDocument();
    expect(screen.getByText('Model Providers & Cost Gate')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/API Online/i)).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });
  });

  it('renders disconnected database state when DB is down', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'ok',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'disconnected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /System Status/i }));

    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });

  it('renders unreachable backend state when backend is down', async () => {
    vi.mocked(api.checkBackendHealth).mockResolvedValue({
      status: 'unreachable',
      service: 'RoomGenie AI Backend',
      version: '0.1.0',
      database: 'disconnected',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /System Status/i }));

    await waitFor(() => {
      expect(screen.getByText('Backend Unreachable')).toBeInTheDocument();
      expect(screen.getByText(/Django offline or starting/i)).toBeInTheDocument();
    });
  });
});
