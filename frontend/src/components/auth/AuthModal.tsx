import React, { useState } from 'react';
import {
  X,
  Check,
  LogIn,
  UserPlus,
  Lock,
  User,
  Mail,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react';
import { useAuthStore } from '../../services/authStore';
import {
  checkPasswordRequirements,
  checkPasswordConfirmation,
} from '../../utils/passwordValidation';

export const AuthModal: React.FC = () => {
  const {
    isAuthModalOpen,
    authModalMode,
    closeAuthModal,
    openAuthModal,
    login,
    register,
    isLoading,
    error,
    setError,
  } = useAuthStore();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const isLogin = authModalMode === 'login';

  const resetForm = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setPasswordConfirm('');
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setValidationError(null);
    setError(null);
  };

  const handleModeSwitch = (newMode: 'login' | 'register') => {
    resetForm();
    openAuthModal(newMode);
  };

  // Live password validation
  const passwordValidation = checkPasswordRequirements(password);
  const confirmationResult = checkPasswordConfirmation(password, passwordConfirm);

  const isRegisterValid =
    username.trim().length > 0 &&
    passwordValidation.isValid &&
    confirmationResult.isMatch;

  const isLoginValid = username.trim().length > 0 && password.length > 0;
  const isSubmitDisabled = isLoading || (isLogin ? !isLoginValid : !isRegisterValid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return; // Prevent duplicate submissions

    setValidationError(null);
    setError(null);

    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setValidationError('Username is required.');
      return;
    }

    if (!password) {
      setValidationError('Password is required.');
      return;
    }

    if (!isLogin) {
      if (!passwordValidation.isValid) {
        setValidationError('Please meet all password requirements before submitting.');
        return;
      }
      if (!confirmationResult.isMatch) {
        setValidationError('Passwords do not match.');
        return;
      }

      const success = await register(trimmedUser, email.trim(), password, passwordConfirm);
      if (success) {
        resetForm();
      }
    } else {
      const success = await login(trimmedUser, password);
      if (success) {
        resetForm();
      }
    }
  };

  const displayError = validationError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md max-h-[92vh] bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              {isLogin ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            </div>
            <div>
              <h2 id="auth-modal-title" className="text-base font-bold text-white tracking-tight">
                {isLogin ? 'Sign In to RoomGenie AI' : 'Create RoomGenie Account'}
              </h2>
              <p className="text-xs text-slate-400">
                {isLogin
                  ? 'Access your saved designs and AI assistant'
                  : 'Get started with cloud scene synchronization'}
              </p>
            </div>
          </div>
          <button
            onClick={closeAuthModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-label="Close authentication modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switchers */}
        <div className="flex border-b border-slate-800/80 px-6 pt-2 bg-slate-950/40 shrink-0">
          <button
            type="button"
            onClick={() => handleModeSwitch('login')}
            className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isLogin
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('register')}
            className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              !isLogin
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {displayError && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1 leading-relaxed font-medium">{displayError}</div>
            </div>
          )}

          {/* Username */}
          <div className="space-y-1.5">
            <label htmlFor="auth-username" className="block text-xs font-medium text-slate-300">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                id="auth-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="designer_user"
                required
                autoFocus
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
            </div>
          </div>

          {/* Email (Registration only) */}
          {!isLogin && (
            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300">
                Email <span className="text-slate-500 text-[10px]">(Optional)</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="designer@example.com"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
                />
              </div>
            </div>
          )}

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? 'Enter your password' : 'Min. 8 characters with upper, lower, digit, symbol'}
                required
                aria-describedby={!isLogin ? 'password-requirements-checklist' : undefined}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-10 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded p-0.5 transition"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Live Password Requirements Checklist (Registration only) */}
          {!isLogin && (
            <div
              id="password-requirements-checklist"
              className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2 text-xs"
              role="region"
              aria-label="Password Requirements"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300 text-[11px] uppercase tracking-wider">
                  Password Requirements
                </span>
                <span className="text-[10px] text-slate-400">
                  {passwordValidation.metCount} of {passwordValidation.totalCount} met
                </span>
              </div>

              <ul className="space-y-1.5" role="list" aria-label="Password requirements checklist">
                {passwordValidation.requirements.map((req) => (
                  <li
                    key={req.id}
                    className={`flex items-center gap-2 text-[11px] transition-colors ${
                      req.isMet ? 'text-emerald-400 font-medium' : 'text-slate-400'
                    }`}
                    aria-label={`${req.label}: ${req.isMet ? 'Requirement met' : 'Requirement not met'}`}
                  >
                    {req.isMet ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-label="Requirement met" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-label="Requirement not met" />
                    )}
                    <span>{req.label}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2 border-t border-slate-800/80 flex items-start gap-1.5 text-[11px] text-slate-400 leading-normal">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  Common-password security and similarity validation is performed securely by the server upon submission.
                </span>
              </div>
            </div>
          )}

          {/* Password Confirm (Registration only) */}
          {!isLogin && (
            <div className="space-y-1.5">
              <label htmlFor="auth-password-confirm" className="block text-xs font-medium text-slate-300">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  id="auth-password-confirm"
                  type={showPasswordConfirm ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  aria-describedby="password-confirmation-feedback"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-10 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded p-0.5 transition"
                  aria-label={showPasswordConfirm ? 'Hide confirm password' : 'Show confirm password'}
                  title={showPasswordConfirm ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showPasswordConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Live Password Confirmation Feedback */}
              <div
                id="password-confirmation-feedback"
                role="status"
                aria-live="polite"
                className={`flex items-center gap-1.5 text-[11px] pt-1 transition-colors ${
                  confirmationResult.isMatch ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {confirmationResult.isMatch ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-label="Requirement met" />
                    <span className="font-medium">Passwords match</span>
                  </>
                ) : (
                  <>
                    <X className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-label="Requirement not met" />
                    <span>{confirmationResult.message}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-indigo-600/30 flex items-center justify-center gap-2 transition"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>{isLogin ? 'Signing In...' : 'Creating Account...'}</span>
                </>
              ) : (
                <>
                  {isLogin ? <LogIn className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800/80 text-center text-[11px] text-slate-400 shrink-0">
          {isLogin ? (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => handleModeSwitch('register')}
                className="text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
              >
                Create one now
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => handleModeSwitch('login')}
                className="text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
              >
                Sign in here
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
