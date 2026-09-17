import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, type AuthSession } from './AuthProvider';
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
  return <div>
    <output data-testid="state">{auth.status}</output>
    <button type="button" onClick={() => void auth.logout()}>sign out</button>
  </div>;
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

  it('clears cached private data and CSRF state after logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    queryClient.setQueryData(['private', 'children'], [{ id: 'child-1' }]);

    render(<AuthProvider initialSession={authenticatedSession}><Probe /></AuthProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'sign out' })); });

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unauthenticated'));
    expect(queryClient.getQueryData(['private', 'children'])).toBeUndefined();
  });

  it('supports an anonymous boot session without exposing private data', () => {
    render(<AuthProvider initialSession={anonymousSession}><Probe /></AuthProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('unauthenticated');
  });
});
