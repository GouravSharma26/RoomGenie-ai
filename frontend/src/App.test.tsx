import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

// Mock fetch for health check
vi.mock('./services/api', () => ({
  checkBackendHealth: vi.fn().mockResolvedValue({
    status: 'ok',
    service: 'RoomGenie AI Backend',
    version: '0.1.0',
    database: 'connected',
  }),
}));

describe('RoomGenie AI App Component', () => {
  it('renders the application brand and header', async () => {
    render(<App />);
    expect(screen.getByText('RoomGenie AI')).toBeInTheDocument();
    expect(screen.getByText('Phase 0 Scaffold')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/API Online/i)).toBeInTheDocument();
    });
  });

  it('renders the main heading and upcoming milestone', async () => {
    render(<App />);
    expect(
      screen.getByText('AI-Agent-Assisted 3D Interior Design System')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Phase 1 — Interactive 3D Room Editor/i)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/API Online/i)).toBeInTheDocument();
    });
  });

  it('renders the system status cards for Django, PostgreSQL, and AI modes', async () => {
    render(<App />);
    expect(screen.getByText('Django REST API')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL 17')).toBeInTheDocument();
    expect(screen.getByText('Model Providers & Cost Gate')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/API Online/i)).toBeInTheDocument();
    });
  });
});
