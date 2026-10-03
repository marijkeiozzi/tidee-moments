import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FileReadySheet from './components/FileReadySheet';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Above every screen — exports and backups can finish on any of them. */}
    <FileReadySheet />
  </React.StrictMode>,
);
