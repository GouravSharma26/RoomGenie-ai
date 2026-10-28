import { create } from 'zustand';
import { API_BASE_URL } from './apiConfig';
import { getAuthToken, setAuthToken, removeAuthToken } from './designApi';
import { parseAuthApiError } from '../utils/passwordValidation';

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  date_joined?: string;
}

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  fieldErrors?: Record<string, string[]>;
  isAuthModalOpen: boolean;
  authModalMode: 'login' | 'register';
  authSuccessCallback: (() => void) | null;

  openAuthModal: (mode?: 'login' | 'register', onSuccess?: () => void) => void;
  closeAuthModal: () => void;
  setError: (error: string | null) => void;

  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string, passwordConfirm?: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getAuthToken(),
  user: null,
  isAuthenticated: Boolean(getAuthToken()),
  isLoading: false,
  error: null,
  fieldErrors: {},
  isAuthModalOpen: false,
  authModalMode: 'login',
  authSuccessCallback: null,

  openAuthModal: (mode = 'login', onSuccess) => {
    set({
      isAuthModalOpen: true,
      authModalMode: mode,
      error: null,
      fieldErrors: {},
      authSuccessCallback: onSuccess || null,
    });
  },

  closeAuthModal: () => {
    set({
      isAuthModalOpen: false,
      error: null,
      fieldErrors: {},
      authSuccessCallback: null,
    });
  },

  setError: (error: string | null) => set({ error, fieldErrors: {} }),

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null, fieldErrors: {} });
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const parsed = parseAuthApiError(data, 'Login failed. Please check your credentials.');
        set({ error: parsed.message, fieldErrors: parsed.fieldErrors, isLoading: false });
        return false;
      }

      const token = data.token;
      setAuthToken(token);

      const callback = get().authSuccessCallback;
      set({
        token,
        user: data.user || null,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        fieldErrors: {},
        isAuthModalOpen: false,
        authSuccessCallback: null,
      });

      if (callback) {
        callback();
      }
      return true;
    } catch (err: any) {
      set({
        error: err?.message || 'Network error occurred during login.',
        fieldErrors: {},
        isLoading: false,
      });
      return false;
    }
  },

  register: async (username: string, email: string, password: string, passwordConfirm?: string) => {
    set({ isLoading: true, error: null, fieldErrors: {} });
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/register/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username,
          email,
          password,
          password_confirm: passwordConfirm || password,
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const parsed = parseAuthApiError(data, 'Registration validation failed.');
        set({ error: parsed.message, fieldErrors: parsed.fieldErrors, isLoading: false });
        return false;
      }

      const token = data.token;
      setAuthToken(token);

      const callback = get().authSuccessCallback;
      set({
        token,
        user: data.user || null,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        fieldErrors: {},
        isAuthModalOpen: false,
        authSuccessCallback: null,
      });

      if (callback) {
        callback();
      }
      return true;
    } catch (err: any) {
      set({
        error: err?.message || 'Network error occurred during registration. Please check your connection and try again.',
        fieldErrors: {},
        isLoading: false,
      });
      return false;
    }
  },

  logout: () => {
    removeAuthToken();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      error: null,
      fieldErrors: {},
      isAuthModalOpen: false,
      authSuccessCallback: null,
    });
  },

  checkAuth: async () => {
    const token = getAuthToken();
    if (!token) {
      set({ token: null, user: null, isAuthenticated: false });
      return false;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/me/`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Token ${token}`,
        },
      });

      if (res.ok) {
        const user = await res.json();
        set({ token, user, isAuthenticated: true });
        return true;
      } else if (res.status === 401 || res.status === 403) {
        // Stale or invalid token
        removeAuthToken();
        set({ token: null, user: null, isAuthenticated: false });
        return false;
      }
      return false;
    } catch {
      // In case of offline/network hiccup, preserve token but don't clear
      return Boolean(getAuthToken());
    }
  },
}));
