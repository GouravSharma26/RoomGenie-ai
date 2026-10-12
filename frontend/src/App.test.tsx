import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import * as api from './services/api';

vi.mock('./services/api');
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
    expect(screen.getByText('Phase 1 Active')).toBeInTheDocument();
    expect(screen.getByText('Furniture Catalogue')).toBeInTheDocument();
    expect(screen.getByTestId('mock-room-canvas')).toBeInTheDocument();
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
