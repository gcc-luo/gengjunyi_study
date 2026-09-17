import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppStoreProvider } from './context/AppStore';
import { AuthProvider } from './context/AuthProvider';
import './styles/tokens.css';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppStoreProvider><App /></AppStoreProvider>
    </AuthProvider>
  </StrictMode>,
);
