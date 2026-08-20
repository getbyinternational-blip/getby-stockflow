import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeBehaviorTracking } from './services/behaviorLogger';
import { installLongTaskObserver } from './services/perf';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

initializeBehaviorTracking();
installLongTaskObserver();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
