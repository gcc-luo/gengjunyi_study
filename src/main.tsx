import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppStoreProvider } from './context/AppStore';
import { AuthProvider } from './context/AuthProvider';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import './styles/tokens.css';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppStoreProvider><App /></AppStoreProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
