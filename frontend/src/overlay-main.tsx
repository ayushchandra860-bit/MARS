import React from 'react';
import ReactDOM from 'react-dom/client';
import OverlayApp from './overlay/OverlayApp';
import './styles/overlay.css';

const urlParams = new URLSearchParams(window.location.search);
const panel = urlParams.get('panel');
const panelType: 'signal' | 'analysis' = (panel === 'intelligence' || panel === 'analysis') ? 'analysis' : 'signal';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayApp panelType={panelType} />
  </React.StrictMode>
);
