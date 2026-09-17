import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, AUTH_UNAUTHORIZED_EVENT, setCsrfToken } from '../lib/api-client';
import { queryClient } from '../lib/query-client';

export type AuthSession =
  | { authenticated: false; activeChildId: null; csrfToken: string }
  | {
      authenticated: true;
      admin: { id: string; email: string };
      activeChildId: string | null;
      activeChild: { id: string; name: string } | null;
      csrfToken: string;
    };

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
type AuthState = { status: AuthStatus; session: AuthSession | null; error: string | null };
type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  error: string | null;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setActiveChild: (childId: string) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    const session = await apiRequest<AuthSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    queryClient.clear();
    setState(stateFromSession(session));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      queryClient.clear();
      setState({ status: 'unauthenticated', session: null, error: null });
    }
  }, []);

  const setActiveChild = useCallback(async (childId: string) => {
    const result = await apiRequest<{ activeChildId: string; activeChild: { id: string; name: string } }>(
      '/api/auth/active-child', { method: 'PUT', body: JSON.stringify({ childId }) },
    );
    setState((current) => current.session?.authenticated
      ? { ...current, session: { ...current.session, activeChildId: result.activeChildId, activeChild: result.activeChild } }
      : current);
    queryClient.clear();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    refreshSession,
    login,
    logout,
    setActiveChild,
  }), [state, refreshSession, login, logout, setActiveChild]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
