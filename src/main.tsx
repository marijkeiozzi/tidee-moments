import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FileReadySheet from './components/FileReadySheet';
import { AccountProvider } from './lib/account';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AccountProvider>
      <App />
      {/* Above every screen — exports and backups can finish on any of them. */}
      <FileReadySheet />
    </AccountProvider>
  </React.StrictMode>,
);
