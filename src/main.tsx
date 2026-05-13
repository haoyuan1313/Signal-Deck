import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const _origFetch = window.fetch.bind(window);
window.fetch = ((input: any, init?: any) => {
  const url = typeof input === 'string' ? input : (input?.url || '');
  if (url.startsWith('/api/')) {
    const token = localStorage.getItem('sd_session');
    if (token) {
      init = init || {};
      init.headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` };
    }
  }
  return _origFetch(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
