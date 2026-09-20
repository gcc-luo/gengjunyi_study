import { render, screen } from '@testing-library/react';
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

it('does not show a login form when a private route has no server session', () => {
  renderApp('/parent/courses?search=math', anonymousSession);

  expect(window.location.pathname).toBe('/parent/courses');
  expect(screen.getByRole('alert')).toHaveTextContent('请检查服务运行状态后重试');
  expect(screen.queryByRole('heading', { name: '家长登录' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '返回入口' })).toHaveAttribute('href', '/');
});

it('redirects the retired login address back to the two-entry landing page', () => {
  renderApp('/login?next=%2Fparent%2Foverview');

  expect(window.location.pathname).toBe('/');
  expect(screen.getByRole('navigation', { name: '选择学习空间' })).toBeInTheDocument();
});

it('opens the child selection page directly with an authenticated server session', () => {
  renderApp('/child/select');

  expect(screen.getByRole('heading', { name: '谁来学习？' })).toBeInTheDocument();
});

it('opens the parent workbench directly without a logout control', () => {
  renderApp('/parent/overview');

  expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
});
