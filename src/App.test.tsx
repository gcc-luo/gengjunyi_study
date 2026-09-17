import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the two role-based landing entries with their existing destinations', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /陪伴每一次\s*小小的进步/ })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '选择学习空间' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /儿童学习空间/ })).toHaveAttribute('href', '/child/select');
  expect(screen.getByRole('link', { name: /家长管理中心/ })).toHaveAttribute('href', '/parent/overview');
});
