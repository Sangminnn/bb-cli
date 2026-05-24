import React from 'react';
import ReactDOM from 'react-dom/client';
import { HotkeysProvider } from 'react-hotkeys-hook';

import App from './App';
import { storageService } from './services/StorageService';
import './styles/global.css';

const STORAGE_RETENTION_DAYS = 7;
storageService.cleanupOldData(STORAGE_RETENTION_DAYS);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <App />
    </HotkeysProvider>
  </React.StrictMode>,
);
