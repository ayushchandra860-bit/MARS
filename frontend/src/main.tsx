import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installAudioAlerts } from './audio/alerts';
import './styles/control-center.css';
import './styles/performance.css';

const removeAudioAlerts = installAudioAlerts();
window.addEventListener('beforeunload', removeAudioAlerts, { once: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
