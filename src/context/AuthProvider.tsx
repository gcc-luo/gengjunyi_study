import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, AUTH_UNAUTHORIZED_EVENT, PARENT_LOCKED_EVENT, setCsrfToken } from '../lib/api-client';
import { queryClient } from '../lib/query-client';

export type AuthSession =
  | { authenticated: false; activeChildId: null; csrfToken: string }
  | {
      authenticated: true;
      admin: { id: string; email: string };
      activeChildId: string | null;
      activeChild: { id: string; name: string } | null;
      csrfToken: string;
      parentUnlocked?: boolean;
    };

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
type AuthState = { status: AuthStatus; session: AuthSession | null; error: string | null };
type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  error: string | null;
  refreshSession: () => Promise<void>;
  setActiveChild: (childId: string) => Promise<void>;
  unlockParent: (password: string) => Promise<void>;
  lockParent: () => Promise<void>;
  logout: () => Promise<void>;
  parentUnlocked: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function stateFromSession(session: AuthSession): AuthState {
  setCsrfToken(session.csrfToken);
  return { status: session.authenticated ? 'authenticated' as const : 'unauthenticated' as const, session, error: null };
}

export function AuthProvider({ children, initialSession }: { children: ReactNode; initialSession?: AuthSession }) {
  const [state, setState] = useState<AuthState>(() => initialSession
    ? stateFromSession(initialSession)
    : { status: 'loading' as const, session: null, error: null });

  const refreshSession = useCallback(async () => {
    setState((current) => ({ ...current, status: current.session ? current.status : 'loading', error: null }));
    try {
      const session = await apiRequest<AuthSession>('/api/auth/session');
      setState(stateFromSession(session));
    } catch (cause) {
      setCsrfToken(null);
      queryClient.clear();
      setState({ status: 'error', session: null, error: cause instanceof Error ? cause.message : '无法检查登录状态' });
    }
  }, []);

  useEffect(() => {
    if (!initialSession) void refreshSession();
  }, [initialSession, refreshSession]);

  useEffect(() => {
    const onUnauthorized = () => {
      setCsrfToken(null);
      queryClient.clear();
      setState({ status: 'unauthenticated', session: null, error: null });
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    const onParentLocked = () => {
      queryClient.removeQueries({ queryKey: ['parent'] });
      setState((current) => current.session?.authenticated
        ? { ...current, session: { ...current.session, parentUnlocked: false } }
        : current);
    };
    window.addEventListener(PARENT_LOCKED_EVENT, onParentLocked);
    return () => window.removeEventListener(PARENT_LOCKED_EVENT, onParentLocked);
  }, []);

  const setActiveChild = useCallback(async (childId: string) => {
    const result = await apiRequest<{ activeChildId: string; activeChild: { id: string; name: string }; parentUnlocked?: boolean }>(
      '/api/auth/active-child', { method: 'PUT', body: JSON.stringify({ childId }) },
    );
    setState((current) => current.session?.authenticated
      ? { ...current, session: { ...current.session, activeChildId: result.activeChildId, activeChild: result.activeChild, parentUnlocked: result.parentUnlocked ?? false } }
      : current);
    queryClient.removeQueries({ queryKey: ['child'] });
  }, []);

  const unlockParent = useCallback(async (password: string) => {
    const result = await apiRequest<{ parentUnlocked: boolean; activeChildId: null; activeChild: null }>(
      '/api/auth/unlock-parent', { method: 'POST', body: JSON.stringify({ password }) },
    );
    setState((current) => current.session?.authenticated
      ? { ...current, session: { ...current.session, activeChildId: result.activeChildId, activeChild: result.activeChild, parentUnlocked: result.parentUnlocked } }
      : current);
    queryClient.removeQueries({ queryKey: ['child'] });
    await queryClient.invalidateQueries({ queryKey: ['parent'] });
  }, []);

  const lockParent = useCallback(async () => {
    await apiRequest('/api/auth/lock-parent', { method: 'POST' });
    queryClient.removeQueries({ queryKey: ['parent'] });
    setState((current) => current.session?.authenticated
      ? { ...current, session: { ...current.session, parentUnlocked: false } }
      : current);
  }, []);

  const logout = useCallback(async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    queryClient.clear();
    setState({ status: 'unauthenticated', session: null, error: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    refreshSession,
    setActiveChild,
    unlockParent,
    lockParent,
    logout,
    parentUnlocked: state.session?.authenticated ? state.session.parentUnlocked !== false : false,
  }), [state, refreshSession, setActiveChild, unlockParent, lockParent, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

export function useAuthOptional() {
  return useContext(AuthContext);
}
