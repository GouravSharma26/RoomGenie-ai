import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import * as api from './services/api';

vi.mock('./services/api');
vi.mock('./services/designApi', () => ({
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
vi.mock('./editor3d/components/RoomCanvas', () => ({
  RoomCanvas: () => <div data-testid="mock-room-canvas">3D Viewport Active</div>,
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
    expect(screen.getByText('Phase 3 Active')).toBeInTheDocument();
    expect(screen.getByText('Furniture Catalogue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Load/i })).toBeInTheDocument();
    expect(screen.getByTestId('mock-room-canvas')).toBeInTheDocument();
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
