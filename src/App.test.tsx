import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import App from './App';
import { AuthProvider, type AuthSession } from './context/AuthProvider';
import { AppStoreProvider } from './context/AppStore';
import { createSeedSnapshot } from './data/seed';

const authenticatedSession: AuthSession = { authenticated: true, admin: { id: 'admin-1', email: 'parent@example.com' }, activeChildId: null, activeChild: null, csrfToken: 'session-csrf' };
const anonymousSession: AuthSession = { authenticated: false, activeChildId: null, csrfToken: 'anonymous-csrf' };

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

function renderApp(path = '/', session = authenticatedSession) {
  window.history.pushState({}, '', path);
  return render(<AuthProvider initialSession={session}><AppStoreProvider initialSnapshot={createSeedSnapshot()}><App /></AppStoreProvider></AuthProvider>);
}

it('renders two direct role-based entries without a login step', () => {
  renderApp('/');

  expect(screen.getByRole('heading', { name: /陪伴每一次\s*小小的进步/ })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '选择学习空间' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /儿童学习空间/ })).toHaveAttribute('href', '/child/select');
  expect(screen.getByRole('link', { name: /家长管理中心/ })).toHaveAttribute('href', '/parent/overview');
});

it('redirects an unauthenticated private route to the login form', () => {
  renderApp('/parent/courses?search=math', anonymousSession);

  expect(window.location.pathname).toBe('/login');
  expect(screen.getByRole('heading', { name: '家长登录' })).toBeInTheDocument();
  expect(screen.getByLabelText('登录邮箱')).toBeInTheDocument();
  expect(screen.getByLabelText('登录密码')).toBeInTheDocument();
});

it('logs in and returns to the requested private route', async () => {
  const session: AuthSession = { authenticated: true, admin: { id: 'admin-1', email: 'parent@example.com' }, activeChildId: null, activeChild: null, csrfToken: 'session-csrf' };
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 })));
  renderApp('/login?next=%2Fparent%2Foverview', anonymousSession);

  fireEvent.change(screen.getByLabelText('登录邮箱'), { target: { value: 'parent@example.com' } });
  fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'Password123!' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  await waitFor(() => {
    expect(window.location.pathname).toBe('/parent/overview');
    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
  });
});

it('opens the child selection page directly with an authenticated server session', () => {
  renderApp('/child/select');

  expect(screen.getByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
});

it('offers explicit parent locking and logout controls', () => {
  renderApp('/parent/overview');

  expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '锁定家长端' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
});
