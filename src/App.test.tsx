import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the product shell', () => {
  render(<App />);
  expect(screen.getByText('小小学习星球')).toBeInTheDocument();
});
