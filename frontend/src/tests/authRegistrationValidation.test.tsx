import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthModal } from '../components/auth/AuthModal';
import { useAuthStore } from '../services/authStore';
import {
  checkPasswordRequirements,
  checkPasswordConfirmation,
  parseAuthApiError,
} from '../utils/passwordValidation';

describe('Password Validation & Registration Experience Suite', () => {
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
      fieldErrors: {},
      isAuthModalOpen: true,
      authModalMode: 'register',
      authSuccessCallback: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  describe('1. Individual Password Requirements Unit Logic', () => {
    it('evaluates minLength (>= 8 characters)', () => {
      expect(checkPasswordRequirements('Short1!').requirements.find(r => r.id === 'minLength')?.isMet).toBe(false);
      expect(checkPasswordRequirements('Eight12!').requirements.find(r => r.id === 'minLength')?.isMet).toBe(true);
      expect(checkPasswordRequirements('MoreThanEight123!').requirements.find(r => r.id === 'minLength')?.isMet).toBe(true);
    });

    it('evaluates hasUppercase', () => {
      expect(checkPasswordRequirements('nouppercase123!').requirements.find(r => r.id === 'hasUppercase')?.isMet).toBe(false);
      expect(checkPasswordRequirements('WithUppercase123!').requirements.find(r => r.id === 'hasUppercase')?.isMet).toBe(true);
    });

    it('evaluates hasLowercase', () => {
      expect(checkPasswordRequirements('NOLOWERCASE123!').requirements.find(r => r.id === 'hasLowercase')?.isMet).toBe(false);
      expect(checkPasswordRequirements('WithLowercase123!').requirements.find(r => r.id === 'hasLowercase')?.isMet).toBe(true);
    });

    it('evaluates hasDigit', () => {
      expect(checkPasswordRequirements('NoDigitsHere!').requirements.find(r => r.id === 'hasDigit')?.isMet).toBe(false);
      expect(checkPasswordRequirements('WithDigit1!').requirements.find(r => r.id === 'hasDigit')?.isMet).toBe(true);
    });

    it('evaluates hasSpecial', () => {
      expect(checkPasswordRequirements('NoSpecialChar123').requirements.find(r => r.id === 'hasSpecial')?.isMet).toBe(false);
      expect(checkPasswordRequirements('HasSpecialChar123!').requirements.find(r => r.id === 'hasSpecial')?.isMet).toBe(true);
      expect(checkPasswordRequirements('HasHash123#').requirements.find(r => r.id === 'hasSpecial')?.isMet).toBe(true);
      expect(checkPasswordRequirements('HasAt123@').requirements.find(r => r.id === 'hasSpecial')?.isMet).toBe(true);
    });

    it('evaluates noWhitespace', () => {
      expect(checkPasswordRequirements('').requirements.find(r => r.id === 'noWhitespace')?.isMet).toBe(false);
      expect(checkPasswordRequirements('Has Space 123!').requirements.find(r => r.id === 'noWhitespace')?.isMet).toBe(false);
      expect(checkPasswordRequirements('HasTab\t123!').requirements.find(r => r.id === 'noWhitespace')?.isMet).toBe(false);
      expect(checkPasswordRequirements('NoSpace123!').requirements.find(r => r.id === 'noWhitespace')?.isMet).toBe(true);
    });

    it('validates all 6 criteria together', () => {
      const invalid = checkPasswordRequirements('weak');
      expect(invalid.isValid).toBe(false);
      expect(invalid.metCount).toBe(2); // lowercase + noWhitespace

      const valid = checkPasswordRequirements('StrongPass123!');
      expect(valid.isValid).toBe(true);
      expect(valid.metCount).toBe(6);
      expect(valid.totalCount).toBe(6);
    });

    it('evaluates checkPasswordConfirmation unit logic', () => {
      expect(checkPasswordConfirmation('Pass123!', '').isMatch).toBe(false);
      expect(checkPasswordConfirmation('Pass123!', 'Mismatch1!').isMatch).toBe(false);
      expect(checkPasswordConfirmation('Pass123!', 'Pass123!').isMatch).toBe(true);
      expect(checkPasswordConfirmation('Pass123!', 'Pass123!').message).toBe('Passwords match');
    });
  });

  describe('2. DRF Validation Error Parser Unit Logic', () => {
    it('parses specific password error "This password is too common."', () => {
      const responseBody = {
        detail: 'Registration validation failed.',
        errors: {
          password: ['This password is too common.'],
        },
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).toBe('This password is too common.');
      expect(result.fieldErrors.password).toEqual(['This password is too common.']);
    });

    it('parses duplicate username error "A user with that username already exists."', () => {
      const responseBody = {
        detail: 'Registration validation failed.',
        errors: {
          username: ['A user with that username already exists.'],
        },
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).toBe('A user with that username already exists.');
      expect(result.fieldErrors.username).toEqual(['A user with that username already exists.']);
    });

    it('parses invalid email error "Enter a valid email address."', () => {
      const responseBody = {
        detail: 'Registration validation failed.',
        errors: {
          email: ['Enter a valid email address.'],
        },
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).toBe('Enter a valid email address.');
      expect(result.fieldErrors.email).toEqual(['Enter a valid email address.']);
    });

    it('parses multiple validation errors in one response', () => {
      const responseBody = {
        detail: 'Registration validation failed.',
        errors: {
          username: ['A user with that username already exists.'],
          password: ['This password is too common.', 'This password is too short.'],
          email: ['Enter a valid email address.'],
        },
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).toContain('A user with that username already exists.');
      expect(result.message).toContain('This password is too common.');
      expect(result.message).toContain('Enter a valid email address.');
    });

    it('handles flat DRF serializer error maps without "errors" wrapper', () => {
      const responseBody = {
        password: ['This password is entirely numeric.'],
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).toBe('This password is entirely numeric.');
    });

    it('falls back to detail when no field errors exist', () => {
      const responseBody = {
        detail: 'Service temporarily unavailable.',
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).toBe('Service temporarily unavailable.');
    });

    it('falls back to default fallback when payload is empty or invalid', () => {
      expect(parseAuthApiError(null).message).toBe('Registration validation failed.');
      expect(parseAuthApiError({}).message).toBe('Registration validation failed.');
    });

    it('never contains passwords in formatted error messages', () => {
      const sensitivePassword = 'MySecretPassword123!';
      const responseBody = {
        detail: 'Registration validation failed.',
        errors: {
          password: ['This password is too common.'],
        },
      };
      const result = parseAuthApiError(responseBody);
      expect(result.message).not.toContain(sensitivePassword);
    });
  });

  describe('3. AuthModal UI: Live Requirements Checklist and Typing Transitions', () => {
    it('renders the 6 requirements and server-side note in registration mode', () => {
      render(<AuthModal />);

      expect(screen.getByText('Password Requirements')).toBeInTheDocument();
      expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
      expect(screen.getByText('At least one uppercase letter (A-Z)')).toBeInTheDocument();
      expect(screen.getByText('At least one lowercase letter (a-z)')).toBeInTheDocument();
      expect(screen.getByText('At least one digit (0-9)')).toBeInTheDocument();
      expect(screen.getByText('At least one special character (!@#$%^&* etc.)')).toBeInTheDocument();
      expect(screen.getByText('No whitespace')).toBeInTheDocument();
      expect(screen.getByText(/Common-password security and similarity validation is performed securely by the server/i)).toBeInTheDocument();
    });

    it('shows red cross icons (unmet) initially for all password requirements', () => {
      render(<AuthModal />);

      // Query elements with aria-label containing 'Requirement not met'
      const unmet = screen.getAllByLabelText(/Requirement not met/i);
      // 6 requirements + 1 password confirmation
      expect(unmet.length).toBeGreaterThanOrEqual(6);
    });

    it('transitions requirements from red to green immediately as user types', () => {
      render(<AuthModal />);

      const passwordInput = screen.getByLabelText(/^Password$/i);

      // Initially 0 of 6 met
      expect(screen.getByText('0 of 6 met')).toBeInTheDocument();

      // Type lowercase 'a'
      fireEvent.change(passwordInput, { target: { value: 'a' } });
      expect(screen.getByText('2 of 6 met')).toBeInTheDocument(); // lowercase + noWhitespace
      expect(screen.getByLabelText(/At least one lowercase letter.*Requirement met/i)).toBeInTheDocument();

      // Type uppercase 'A' -> 'aA'
      fireEvent.change(passwordInput, { target: { value: 'aA' } });
      expect(screen.getByText('3 of 6 met')).toBeInTheDocument(); // lower + upper + noWhitespace
      expect(screen.getByLabelText(/At least one uppercase letter.*Requirement met/i)).toBeInTheDocument();

      // Type digit '1' -> 'aA1'
      fireEvent.change(passwordInput, { target: { value: 'aA1' } });
      expect(screen.getByText('4 of 6 met')).toBeInTheDocument();
      expect(screen.getByLabelText(/At least one digit.*Requirement met/i)).toBeInTheDocument();

      // Type special char '!' -> 'aA1!'
      fireEvent.change(passwordInput, { target: { value: 'aA1!' } });
      expect(screen.getByText('5 of 6 met')).toBeInTheDocument();
      expect(screen.getByLabelText(/At least one special character.*Requirement met/i)).toBeInTheDocument();

      // Lengthen to >= 8 characters -> 'aA1!5678'
      fireEvent.change(passwordInput, { target: { value: 'aA1!5678' } });
      expect(screen.getByText('6 of 6 met')).toBeInTheDocument();
      expect(screen.getByLabelText(/At least 8 characters.*Requirement met/i)).toBeInTheDocument();

      // Now add whitespace -> 'aA1! 5678' -> noWhitespace fails immediately
      fireEvent.change(passwordInput, { target: { value: 'aA1! 5678' } });
      expect(screen.getByText('5 of 6 met')).toBeInTheDocument();
      expect(screen.getByLabelText(/No whitespace.*Requirement not met/i)).toBeInTheDocument();
    });
  });

  describe('4. Live Password Confirmation Feedback', () => {
    it('shows red cross when passwords do not match and green check when they do', () => {
      render(<AuthModal />);

      const passwordInput = screen.getByLabelText(/^Password$/i);
      const confirmInput = screen.getByLabelText(/^Confirm Password$/i);

      fireEvent.change(passwordInput, { target: { value: 'SuperSecret123!' } });
      fireEvent.change(confirmInput, { target: { value: 'DifferentPass123!' } });

      // Confirmation shows mismatch
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();

      // Change confirm to match
      fireEvent.change(confirmInput, { target: { value: 'SuperSecret123!' } });
      expect(screen.getByText('Passwords match')).toBeInTheDocument();

      // Change password field -> recalculates immediately
      fireEvent.change(passwordInput, { target: { value: 'SuperSecret123!EXTRA' } });
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  describe('5. Submit Button States and Validation Enforcement', () => {
    it('disables submit button until all client-side requirements and confirmation pass', () => {
      const { container } = render(<AuthModal />);

      const getSubmitButton = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(getSubmitButton()).toBeDisabled();

      const usernameInput = screen.getByLabelText(/^Username$/i);
      const passwordInput = screen.getByLabelText(/^Password$/i);
      const confirmInput = screen.getByLabelText(/^Confirm Password$/i);

      // Only username
      fireEvent.change(usernameInput, { target: { value: 'valid_user' } });
      expect(getSubmitButton()).toBeDisabled();

      // Valid password, but no confirm
      fireEvent.change(passwordInput, { target: { value: 'ValidPass2026!' } });
      expect(getSubmitButton()).toBeDisabled();

      // Confirm mismatch
      fireEvent.change(confirmInput, { target: { value: 'WrongPass2026!' } });
      expect(getSubmitButton()).toBeDisabled();

      // Matching confirm -> enabled
      fireEvent.change(confirmInput, { target: { value: 'ValidPass2026!' } });
      expect(getSubmitButton()).not.toBeDisabled();
    });
  });

  describe('6. Show / Hide Password Controls & Accessibility', () => {
    it('toggles password input between password and text types with accessible labels', () => {
      render(<AuthModal />);

      const passwordInput = screen.getByLabelText(/^Password$/i) as HTMLInputElement;
      const toggleButton = screen.getByLabelText('Show password');

      expect(passwordInput.type).toBe('password');

      // Click toggle
      fireEvent.click(toggleButton);
      expect(passwordInput.type).toBe('text');
      expect(screen.getByLabelText('Hide password')).toBeInTheDocument();

      // Click again
      fireEvent.click(screen.getByLabelText('Hide password'));
      expect(passwordInput.type).toBe('password');
      expect(screen.getByLabelText('Show password')).toBeInTheDocument();
    });

    it('toggles confirm password input independently', () => {
      render(<AuthModal />);

      const confirmInput = screen.getByLabelText(/^Confirm Password$/i) as HTMLInputElement;
      const toggleConfirmButton = screen.getByLabelText('Show confirm password');

      expect(confirmInput.type).toBe('password');

      fireEvent.click(toggleConfirmButton);
      expect(confirmInput.type).toBe('text');
      expect(screen.getByLabelText('Hide confirm password')).toBeInTheDocument();
    });
  });

  describe('7. Backend Error Handling & Server Password Validation', () => {
    it('displays specific password error "This password is too common." from server', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          detail: 'Registration validation failed.',
          errors: {
            password: ['This password is too common.'],
          },
        }),
      } as Response);

      const { container } = render(<AuthModal />);

      fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'test_common' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Password123!' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'Password123!' } });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText('This password is too common.')).toBeInTheDocument();
      expect(screen.queryByText(/^Registration validation failed\.$/i)).not.toBeInTheDocument();
    });

    it('displays duplicate username error from server', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          detail: 'Registration validation failed.',
          errors: {
            username: ['A user with that username already exists.'],
          },
        }),
      } as Response);

      const { container } = render(<AuthModal />);

      fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'duplicate_user' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'ValidPass2026!' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'ValidPass2026!' } });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('A user with that username already exists.')).toBeInTheDocument();
      });
    });

    it('displays multiple server validation errors clearly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          detail: 'Registration validation failed.',
          errors: {
            username: ['A user with that username already exists.'],
            password: ['This password is too common.'],
          },
        }),
      } as Response);

      const { container } = render(<AuthModal />);

      fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'duplicate_user' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'Password123!' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'Password123!' } });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('A user with that username already exists.');
        expect(alert.textContent).toContain('This password is too common.');
      });
    });

    it('handles network failure gracefully without crashing', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const { container } = render(<AuthModal />);

      fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'net_user' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'ValidPass2026!' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'ValidPass2026!' } });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText(/Failed to fetch|Network error/i)).toBeInTheDocument();
    });
  });

  describe('8. Loading State & Duplicate Submission Prevention', () => {
    it('shows loading spinner and disables submit button during request', async () => {
      let resolvePromise: (value: any) => void = () => {};
      const networkPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      globalThis.fetch = vi.fn().mockReturnValueOnce(networkPromise);

      const { container } = render(<AuthModal />);

      fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'busy_user' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'ValidPass2026!' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'ValidPass2026!' } });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      fireEvent.click(submitButton);

      // In flight
      expect(screen.getByText('Creating Account...')).toBeInTheDocument();
      expect(submitButton).toBeDisabled();

      // Subsequent clicks should not invoke fetch again
      fireEvent.click(submitButton);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Resolve request
      resolvePromise({
        ok: true,
        json: async () => ({
          token: 'token-abc',
          user: { id: 10, username: 'busy_user', email: '' },
        }),
      });

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
      });
    });
  });

  describe('9. Existing Sign-In and Mode Switch Behavior', () => {
    it('switches between Sign In and Create Account tabs without preserving errors', () => {
      const { container } = render(<AuthModal />);

      // Initially in Register
      const getSubmitButton = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(getSubmitButton().textContent).toContain('Create Account');
      expect(screen.getByText('Password Requirements')).toBeInTheDocument();

      // Switch to Sign In
      const signInTab = screen.getByRole('button', { name: 'Sign In' });
      fireEvent.click(signInTab);

      // Now in Login mode
      expect(getSubmitButton().textContent).toContain('Sign In');
      expect(screen.queryByText('Password Requirements')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^Confirm Password$/i)).not.toBeInTheDocument();

      // Switch back
      const createAccountTab = screen.getByRole('button', { name: 'Create Account' });
      fireEvent.click(createAccountTab);

      expect(screen.getByText('Password Requirements')).toBeInTheDocument();
    });

    it('executes login flow successfully in Sign In mode', async () => {
      useAuthStore.setState({ authModalMode: 'login' });

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'logged-in-token-xyz',
          user: { id: 7, username: 'existing_user', email: 'existing@example.com' },
        }),
      } as Response);

      const { container } = render(<AuthModal />);

      fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: 'existing_user' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'SecretPassword2026!' } });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitButton).not.toBeDisabled();
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
      });
      expect(useAuthStore.getState().token).toBe('logged-in-token-xyz');
    });
  });
});
