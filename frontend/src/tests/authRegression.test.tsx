import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuthStore } from '../services/authStore';
import { ensureAuthenticated, AuthenticationRequiredError } from '../services/designApi';
import { DesignPersistenceModal } from '../components/editor/DesignPersistenceModal';
import { AiAgentDrawer } from '../components/editor/AiAgentDrawer';
import * as designApi from '../services/designApi';
import * as agentApi from '../services/agentApi';

vi.mock('../services/designApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/designApi')>();
  return {
    ...actual,
    listSavedDesigns: vi.fn().mockResolvedValue([
      {
        id: 'saved-design-1',
        title: 'Cozy Scandi Studio',
        object_count: 3,
        updated_at: '2026-10-28T00:00:00Z',
        scene_json: {
          schemaVersion: 1,
          unit: 'm',
          room: { width: 5, length: 4, height: 2.8 },
          objects: [],
        },
      },
    ]),
    saveDesignToBackend: vi.fn(),
    deleteDesignFromBackend: vi.fn(),
  };
});

vi.mock('../services/agentApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agentApi')>();
  return {
    ...actual,
    createAgentSession: vi.fn().mockResolvedValue({
      id: 'session-auth-test-1',
      owner_username: 'auth_user',
      title: 'AI Interior Design Assistant',
      created_at: '2026-10-28T00:00:00Z',
      updated_at: '2026-10-28T00:00:00Z',
    }),
  };
});

describe('Production Authentication & Regression Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isAuthModalOpen: false,
      authModalMode: 'login',
      authSuccessCallback: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  describe('Unauthenticated Behavior', () => {
    it('initializes authStore as unauthenticated when localStorage is empty', () => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('ensureAuthenticated() throws AuthenticationRequiredError without calling /auth/demo/ in production', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      await expect(ensureAuthenticated()).rejects.toThrow(AuthenticationRequiredError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('DesignPersistenceModal displays "Sign In Required" and does not call listSavedDesigns', () => {
      render(<DesignPersistenceModal isOpen={true} onClose={() => {}} />);

      expect(screen.getByText('Sign In Required')).toBeInTheDocument();
      expect(screen.getByText(/sign in or create an account to access your saved cloud designs/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in \/ register/i })).toBeInTheDocument();
      expect(designApi.listSavedDesigns).not.toHaveBeenCalled();
    });

    it('clicking "Sign In / Register" in DesignPersistenceModal opens AuthModal', () => {
      render(<DesignPersistenceModal isOpen={true} onClose={() => {}} />);

      const button = screen.getByRole('button', { name: /sign in \/ register/i });
      fireEvent.click(button);

      expect(useAuthStore.getState().isAuthModalOpen).toBe(true);
      expect(useAuthStore.getState().authModalMode).toBe('login');
    });

    it('AiAgentDrawer displays "Sign In to use AI Designer" and does not call createAgentSession', () => {
      render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

      expect(screen.getByText('Sign In to use AI Designer')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in \/ create account/i })).toBeInTheDocument();
      expect(agentApi.createAgentSession).not.toHaveBeenCalled();
    });

    it('clicking "Sign In / Create Account" in AiAgentDrawer opens AuthModal', () => {
      render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

      const button = screen.getByRole('button', { name: /sign in \/ create account/i });
      fireEvent.click(button);

      expect(useAuthStore.getState().isAuthModalOpen).toBe(true);
      expect(useAuthStore.getState().authModalMode).toBe('login');
    });
  });

  describe('Authentication Lifecycle', () => {
    it('login flow updates token, user, localStorage, and isAuthenticated', async () => {
      const mockUser = { id: 42, username: 'architect_alice', email: 'alice@example.com' };
      const mockToken = 'mock-auth-token-abc-123';

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken, user: mockUser }),
      } as Response);

      const success = await useAuthStore.getState().login('architect_alice', 'SecurePass2026!');
      expect(success).toBe(true);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe(mockToken);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(localStorage.getItem('roomgenie_auth_token')).toBe(mockToken);
    });

    it('registration flow creates account and updates auth state', async () => {
      const mockUser = { id: 43, username: 'new_designer', email: 'new@example.com' };
      const mockToken = 'mock-auth-token-new-456';

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken, user: mockUser }),
      } as Response);

      const success = await useAuthStore.getState().register(
        'new_designer',
        'new@example.com',
        'Password123!',
        'Password123!'
      );
      expect(success).toBe(true);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe(mockToken);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('logout clears state and removes token from localStorage', () => {
      localStorage.setItem('roomgenie_auth_token', 'token-to-be-removed');
      useAuthStore.setState({
        token: 'token-to-be-removed',
        user: { id: 1, username: 'test', email: 'test@example.com' },
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('roomgenie_auth_token')).toBeNull();
    });

    it('checkAuth clears invalid/expired token on 401 response', async () => {
      localStorage.setItem('roomgenie_auth_token', 'stale-expired-token');
      useAuthStore.setState({ token: 'stale-expired-token', isAuthenticated: true });

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Invalid token.' }),
      } as Response);

      const isValid = await useAuthStore.getState().checkAuth();
      expect(isValid).toBe(false);

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(localStorage.getItem('roomgenie_auth_token')).toBeNull();
    });
  });

  describe('Authenticated Panels Integration', () => {
    beforeEach(() => {
      localStorage.setItem('roomgenie_auth_token', 'valid-active-token');
      useAuthStore.setState({
        token: 'valid-active-token',
        user: { id: 1, username: 'active_designer', email: 'active@example.com' },
        isAuthenticated: true,
      });
    });

    it('ensureAuthenticated() returns existing token without network calls', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const token = await ensureAuthenticated();
      expect(token).toBe('valid-active-token');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('DesignPersistenceModal loads and renders saved designs when authenticated', async () => {
      render(<DesignPersistenceModal isOpen={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(designApi.listSavedDesigns).toHaveBeenCalled();
      });

      expect(screen.getByText('Cozy Scandi Studio')).toBeInTheDocument();
      expect(screen.getByText('Save Active Scene')).toBeInTheDocument();
    });

    it('AiAgentDrawer initializes session when authenticated', async () => {
      render(<AiAgentDrawer isOpen={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(agentApi.createAgentSession).toHaveBeenCalledWith('AI Interior Design Assistant');
      });

      expect(screen.getByText(/I am your AI Interior Design Assistant/i)).toBeInTheDocument();
    });
  });
});
