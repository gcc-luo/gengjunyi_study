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

it('renders the two role-based landing entries with their existing destinations', () => {
  renderApp('/');

  expect(screen.getByRole('heading', { name: /陪伴每一次\s*小小的进步/ })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '选择学习空间' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /儿童学习空间/ })).toHaveAttribute('href', '/login?next=%2Fchild%2Fselect');
  expect(screen.getByRole('link', { name: /家长管理中心/ })).toHaveAttribute('href', '/login?next=%2Fparent%2Foverview');
});

it('redirects private pages to login while preserving a safe in-app return target', async () => {
  renderApp('/parent/courses?search=math', anonymousSession);

  await waitFor(() => expect(window.location.pathname).toBe('/login'));
  expect(screen.getByRole('heading', { name: '家长登录' })).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('next')).toBe('/parent/courses?search=math');
});

it('returns the parent to the selected destination after successful login', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(authenticatedSession), { status: 200 })));
  renderApp('/login?next=%2Fparent%2Foverview', anonymousSession);

  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'parent@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  await waitFor(() => expect(window.location.pathname).toBe('/parent/overview'));
  expect(await screen.findByRole('heading', { name: '概览' })).toBeInTheDocument();
});

it('rejects an external post-login redirect target', async () => {
  renderApp('/login?next=https%3A%2F%2Fevil.example%2Fsteal', anonymousSession);

  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'parent@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(authenticatedSession), { status: 200 })));
  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  await waitFor(() => expect(window.location.pathname).toBe('/parent/overview'));
  expect(window.location.origin).toBe('http://localhost:3000');
});

it('returns the child entry to child selection after successful login', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(authenticatedSession), { status: 200 })));
  renderApp('/login?next=%2Fchild%2Fselect', anonymousSession);

  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'parent@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  await waitFor(() => expect(window.location.pathname).toBe('/child/select'));
  expect(await screen.findByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
});
