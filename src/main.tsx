import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { PullProvider } from './context/PullContext';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';
import { isMicrosoftAuthResponse } from './lib/microsoft';

// A Microsoft sign-in popup lands back on this address (lib/microsoft.ts): hand Microsoft's answer to the window that
// opened it (the popup then closes) instead of starting the app in the popup.
if (isMicrosoftAuthResponse()) {
  void import('@azure/msal-browser/redirect-bridge').then((m) => m.broadcastResponseToMainFrame());
} else createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outermost boundary: last resort if a provider or the shell itself crashes. */}
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <LanguageProvider>
              <PullProvider>
                <App />
              </PullProvider>
            </LanguageProvider>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
