import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, type AuthSession } from './AuthProvider';
import { AUTH_UNAUTHORIZED_EVENT } from '../lib/api-client';
import { queryClient } from '../lib/query-client';

const authenticatedSession: AuthSession = {
  authenticated: true,
  admin: { id: 'admin-1', email: 'parent@example.com' },
  activeChildId: null,
  activeChild: null,
  csrfToken: 'session-csrf',
};
const anonymousSession: AuthSession = { authenticated: false, activeChildId: null, csrfToken: 'anonymous-csrf' };

function Probe() {
  const auth = useAuth();
  return <output data-testid="state">{auth.status}</output>;
}

describe('AuthProvider', () => {
  beforeEach(() => queryClient.clear());
  afterEach(() => { vi.unstubAllGlobals(); queryClient.clear(); });

  it('loads the server session and exposes authentication state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(authenticatedSession), { status: 200 })));

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authenticated'));
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('clears cached private data and CSRF state after an unauthorized response', async () => {
    queryClient.setQueryData(['private', 'children'], [{ id: 'child-1' }]);

    render(<AuthProvider initialSession={authenticatedSession}><Probe /></AuthProvider>);
    await act(async () => { window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT)); });

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unauthenticated'));
    expect(queryClient.getQueryData(['private', 'children'])).toBeUndefined();
  });

  it('supports an anonymous boot session without exposing private data', () => {
    render(<AuthProvider initialSession={anonymousSession}><Probe /></AuthProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('unauthenticated');
  });
});
